package shell

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
	"github.com/google/uuid"
)

type settingsObject = map[string]any

const settingsVault = "model-connections.v2.enc"

type ModelConnectionsService struct {
	mu        sync.Mutex
	root      *os.Root
	workspace string
	keys      security.MasterKeyProvider
	transport http.RoundTripper
	changed   func()
}

func NewModelConnectionsService(dir, workspace string, keys security.MasterKeyProvider, transport http.RoundTripper, onVaultChanged func()) (*ModelConnectionsService, error) {
	if e := ValidateIsolatedShellPaths(dir); e != nil {
		return nil, e
	}
	root, _, e := security.OpenPathRoot(security.PathRoot{Dir: dir, RejectSymlinkRoot: true})
	if e != nil {
		return nil, e
	}
	defer root.Close()
	marker, e := root.Lstat(experimentalMarker)
	if e != nil || !marker.Mode().IsRegular() {
		return nil, errors.New("refusing_non_experimental_data_dir")
	}
	if e = root.Mkdir("secrets", 0700); e != nil && !errors.Is(e, os.ErrExist) {
		return nil, e
	}
	i, e := root.Lstat("secrets")
	if e != nil || !i.IsDir() {
		return nil, os.ErrInvalid
	}
	secrets, e := root.OpenRoot("secrets")
	if e != nil {
		return nil, e
	}
	j, e := secrets.Stat(".")
	if e != nil || !os.SameFile(i, j) {
		secrets.Close()
		return nil, os.ErrInvalid
	}
	return &ModelConnectionsService{root: secrets, workspace: workspace, keys: keys, transport: transport, changed: onVaultChanged}, nil
}

func (s *ModelConnectionsService) Close() error { return s.root.Close() }
func (s *ModelConnectionsService) key(create bool) ([]byte, error) {
	if s.keys != nil {
		return s.keys.LoadOrCreateMasterKey()
	}
	if runtime.GOOS != "windows" {
		if !create {
			return security.ReadKeychainGenericPassword("Molly Experimental Safe Storage", "Master Key", security.KeychainOptions{})
		}
		return (security.KeychainMasterKeyProvider{Service: "Molly Experimental Safe Storage", Account: "Master Key"}).LoadOrCreateMasterKey()
	}
	const path = "model-connections.master-key.dpapi"
	blob, e := security.ReadBoundedFileFromRoot(s.root, path, 8192)
	if e == nil {
		return security.UnprotectDPAPI(blob)
	}
	if !create || !errors.Is(e, os.ErrNotExist) {
		return nil, e
	}
	key := make([]byte, 32)
	rand.Read(key)
	blob, e = security.ProtectDPAPI(key)
	if e == nil {
		e = s.publish(path, blob)
	}
	return key, e
}

func (s *ModelConnectionsService) publish(path string, b []byte) error {
	tmp := ".tmp-" + randomHex(12)
	f, e := s.root.OpenFile(tmp, os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer s.root.Remove(tmp)
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	c := f.Close()
	if e != nil {
		return e
	}
	if c != nil {
		return c
	}
	return s.root.Rename(tmp, path)
}

type settingsVaultState struct {
	security.VaultDocument
	digest [32]byte
}

func (s *ModelConnectionsService) load() (settingsVaultState, error) {
	var v settingsVaultState
	b, e := security.ReadBoundedFileFromRoot(s.root, settingsVault, security.MaxVaultSizeBytes)
	if errors.Is(e, os.ErrNotExist) {
		v.SchemaVersion = 1
		v.Entries = []json.RawMessage{}
		return v, nil
	}
	if e != nil {
		return v, e
	}
	key, e := s.key(false)
	if e != nil {
		return v, errors.New("credential_storage_unreadable")
	}
	defer clear(key)
	raw, d, e := security.OpenMV2Vault(key, b)
	if e != nil {
		return v, errors.New("credential_storage_unreadable")
	}
	defer clear(raw)
	v.digest = d
	v.VaultDocument, _, e = security.ParseAndNormalizeVaultJSON(raw)
	if e != nil {
		return v, errors.New("credential_storage_unreadable")
	}
	return v, nil
}

func (s *ModelConnectionsService) transaction(change func(*settingsVaultState) (settingsObject, error)) (settingsObject, error) {
	s.mu.Lock()
	result, e := s.writeLocked(change)
	s.mu.Unlock()
	if e == nil && s.changed != nil {
		s.changed()
	}
	return result, e
}

func (s *ModelConnectionsService) writeLocked(change func(*settingsVaultState) (settingsObject, error)) (output settingsObject, err error) {
	const lock = settingsVault + ".lock"
	f, e := s.root.OpenFile(lock, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	if e = lockVault(f); e != nil {
		return nil, e
	}
	writer, e := security.AcquireVaultWriter(s.root)
	if e != nil {
		return nil, e
	}
	defer func() { err = errors.Join(err, writer.Release()) }()
	v, e := s.load()
	if e == nil {
		legacy, readErr := security.ReadBoundedFileFromRoot(s.root, "model-connections.enc", security.MaxVaultSizeBytes)
		var digest [32]byte
		if readErr == nil {
			digest = sha256.Sum256(legacy)
		} else if !errors.Is(readErr, os.ErrNotExist) {
			return nil, readErr
		}
		if digest != v.digest {
			return nil, security.ErrStaleV2Vault
		}
		if readErr == nil {
			_, backupErr := s.root.Lstat("model-connections.enc.bak")
			if errors.Is(backupErr, os.ErrNotExist) {
				backupErr = s.publish("model-connections.enc.bak", legacy)
			}
			if backupErr != nil {
				return nil, backupErr
			}
		}
	}
	if e != nil {
		return nil, e
	}
	result, e := change(&v)
	if e != nil {
		return nil, e
	}
	raw, e := json.Marshal(v.VaultDocument)
	if e != nil {
		return nil, e
	}
	defer clear(raw)
	_, _, e = security.ParseAndNormalizeVaultJSON(raw)
	if e != nil {
		return nil, e
	}
	key, e := s.key(true)
	if e != nil {
		return nil, e
	}
	defer clear(key)
	blob, e := security.SealMV2Vault(key, v.digest, raw)
	if e != nil {
		return nil, e
	}
	if len(blob) > security.MaxVaultSizeBytes {
		return nil, os.ErrInvalid
	}
	return result, s.publish(settingsVault, blob)
}

type credentialRow struct {
	Connection   settingsObject    `json:"connection"`
	APIKey       *string           `json:"apiKey,omitempty"`
	Values       map[string]string `json:"values,omitempty"`
	OAuth        json.RawMessage   `json:"oauth,omitempty"`
	Registration json.RawMessage   `json:"registration,omitempty"`
}

func decodeRow(raw json.RawMessage) credentialRow {
	var row credentialRow
	json.Unmarshal(raw, &row)
	return row
}

func (s *ModelConnectionsService) snapshot(kind string) (settingsObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, e := s.load()
	if e != nil {
		return nil, e
	}
	if kind == "image" {
		return settingsObject{"connection": decodeRow(v.Image).Connection}, nil
	}
	rows := v.Entries
	if kind == "mcp" {
		rows = v.MCP
	}
	connections := []settingsObject{}
	for _, raw := range rows {
		r := decodeRow(raw)
		if kind != "mcp" || r.Connection["workspaceId"] == s.workspace {
			if kind == "model" {
				var grant struct{ Denied bool }
				json.Unmarshal(r.OAuth, &grant)
				if grant.Denied || len(r.Registration) > 0 {
					metadata, _ := r.Connection["oauth"].(settingsObject)
					if metadata == nil {
						metadata = settingsObject{}
					}
					if len(r.Registration) > 0 {
						metadata["signedOut"] = true
					} else {
						metadata["denied"] = true
					}
					r.Connection["oauth"] = metadata
				}
			}
			connections = append(connections, r.Connection)
		}
	}
	return settingsObject{"connections": connections}, nil
}

func (s *ModelConnectionsService) GetSnapshot() (settingsObject, error) { return s.snapshot("model") }
func (s *ModelConnectionsService) GetImageSnapshot() (settingsObject, error) {
	return s.snapshot("image")
}

func (s *ModelConnectionsService) GetMcpSnapshot() (settingsObject, error) { return s.snapshot("mcp") }
func settingsRevision(v any) float64 {
	switch n := v.(type) {
	case int:
		return float64(n)
	case float64:
		return n
	}
	return -1
}

var settingsIdentifier = regexp.MustCompile("^[A-Za-z0-9._:-]{1,200}$")

func settingsFields(q settingsObject, allowed string) bool {
	fields := strings.Fields(allowed)
	for k, v := range q {
		if v == nil || !slices.Contains(fields, k) {
			return false
		}
	}
	return true
}

func validateSettingsRequest(kind string, remove bool, q settingsObject) bool {
	fields := "expectedRevision"
	switch kind {
	case "model":
		fields += " id"
		if !remove {
			fields += " enabled authType baseUrl providerPresetId displayName customModels compatibleApi models apiKey"
		}
	case "image":
		if !remove {
			fields += " enabled protocol model baseUrl apiKey clearApiKey"
		}
	case "mcp":
		fields += " serverId"
		if !remove {
			fields += " values destination"
		}
	}
	if !settingsFields(q, fields) {
		return false
	}
	if r, ok := q["expectedRevision"]; ok {
		n := settingsRevision(r)
		if !positiveNumber(n, 1<<53-1) {
			return false
		}
	}
	if id, ok := q["id"]; ok {
		str, _ := id.(string)
		if uuid.Validate(str) != nil {
			return false
		}
	}
	if v, ok := q["clearApiKey"]; ok {
		if _, ok = v.(bool); !ok {
			return false
		}
	}
	if v, ok := q["apiKey"]; ok {
		k, valid := v.(string)
		if !valid || len(k) > 16384 || kind == "image" && strings.TrimSpace(k) == "" {
			return false
		}
	}
	return true
}

func (s *ModelConnectionsService) mutate(kind string, remove bool, q settingsObject) (settingsObject, error) {
	if !validateSettingsRequest(kind, remove, q) {
		return nil, os.ErrInvalid
	}
	return s.transaction(func(v *settingsVaultState) (settingsObject, error) {
		rows := &v.Entries
		if kind == "mcp" {
			serverID, _ := q["serverId"].(string)
			if !settingsIdentifier.MatchString(s.workspace) || !settingsIdentifier.MatchString(serverID) {
				return nil, os.ErrInvalid
			}
			rows = &v.MCP
		}
		var old credentialRow
		idx := -1
		if kind == "image" {
			old = decodeRow(v.Image)
		} else {
			for i, raw := range *rows {
				r := decodeRow(raw)
				if kind == "model" && reflect.DeepEqual(r.Connection["id"], q["id"]) || kind == "mcp" && r.Connection["workspaceId"] == s.workspace && reflect.DeepEqual(r.Connection["serverId"], q["serverId"]) {
					old = r
					idx = i
					break
				}
			}
		}
		c := old.Connection
		expected, supplied := q["expectedRevision"]
		rev := settingsRevision(c["revision"])
		if c == nil && (supplied || remove || kind == "model" && q["id"] != nil) || c != nil && (!supplied || rev < 1 || settingsRevision(expected) != rev) {
			return nil, errors.New(map[string]string{"model": "model_connection_revision_conflict", "image": "image_connection_revision_conflict", "mcp": "mcp_credential_revision_conflict"}[kind])
		}
		if remove {
			if kind == "image" {
				v.Image = nil
			} else {
				*rows = slices.Delete(*rows, idx, idx+1)
			}
			return nil, nil
		}
		next, e := s.updatedRow(kind, q, old, len(v.LegacyImages) > 0)
		if e != nil {
			return nil, e
		}
		if c == nil {
			rev = 0
		}
		next.Connection["revision"] = rev + 1
		raw, e := json.Marshal(next)
		if e != nil {
			return nil, e
		}
		if kind == "image" {
			v.Image = raw
		} else if idx < 0 {
			*rows = append(*rows, raw)
		} else {
			(*rows)[idx] = raw
		}
		return next.Connection, nil
	})
}

func (s *ModelConnectionsService) updatedRow(kind string, q settingsObject, old credentialRow, legacy bool) (credentialRow, error) {
	c := settingsObject{}
	row := credentialRow{Connection: c}
	previous := old.Connection
	identity := func(k string) any {
		if previous[k] != nil {
			return previous[k]
		}
		return uuid.NewString()
	}
	if kind == "mcp" {
		values := old.Values
		if raw, ok := q["values"]; ok {
			b, e := json.Marshal(raw)
			values = nil
			if e != nil || json.Unmarshal(b, &values) != nil {
				return row, os.ErrInvalid
			}
		} else if !reflect.DeepEqual(previous["destination"], q["destination"]) {
			return row, errors.New("mcp_credential_destination_requires_credential")
		}
		row.Values = values
		c["workspaceId"] = s.workspace
		c["serverId"] = q["serverId"]
		c["destination"] = q["destination"]
		c["credentialRef"] = identity("credentialRef")
		c["fieldNames"] = slices.Sorted(maps.Keys(values))
		return row, nil
	}
	base, _ := q["baseUrl"].(string)
	enabled, ok := q["enabled"].(bool)
	if !ok {
		return row, os.ErrInvalid
	}
	c["enabled"] = enabled
	c["baseUrl"] = base
	c["id"] = identity("id")
	key := old.APIKey
	if raw, exists := q["apiKey"]; exists {
		k, ok := raw.(string)
		if !ok {
			return row, os.ErrInvalid
		}
		k = strings.TrimSpace(k)
		key = &k
	} else if previous != nil && (previous["baseUrl"] != base || kind == "model" && !reflect.DeepEqual(previous["providerPresetId"], q["providerPresetId"])) && !(kind == "image" && q["clearApiKey"] == true) {
		return row, errors.New("destination_requires_credential")
	}
	if kind == "image" {
		if _, e := security.ValidateImageEndpointURL(base); e != nil {
			return row, e
		}
		if q["clearApiKey"] == true {
			if q["apiKey"] != nil {
				return row, os.ErrInvalid
			}
			key = nil
		}
		if key == nil {
			k := ""
			key = &k
		}
		model, _ := q["model"].(string)
		c["model"] = strings.TrimSpace(model)
		if p, ok := q["protocol"]; ok {
			c["protocol"] = p
		}
		c["hasApiKey"] = *key != ""
		c["legacyHistoryMayContainKey"] = legacy
		if previous != nil {
			c["legacyHistoryMayContainKey"] = previous["legacyHistoryMayContainKey"]
		}
	} else {
		u, e := url.Parse(base)
		if e != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !(u.Scheme == "https" || u.Scheme == "http" && enumString(u.Hostname(), "localhost", "::1", "127.0.0.1")) || len(base) > 2048 {
			return row, os.ErrInvalid
		}
		if api, ok := q["compatibleApi"]; ok && !enumString(api, "anthropic-messages", "openai-completions", "openai-responses", "google-generative-ai") {
			return row, os.ErrInvalid
		}
		if !providerPreset(q["providerPresetId"]) || !boundedString(q["displayName"], 120) || key == nil || q["authType"] != nil && q["authType"] != "api_key" || len(old.OAuth) > 0 || len(old.Registration) > 0 {
			return row, os.ErrInvalid
		}
		normalizedPath := strings.TrimRight(u.Path, "/")
		if enabled && u.Hostname() == "api.kimi.com" && (q["providerPresetId"] == "moonshot" && (normalizedPath == "/coding" || strings.HasPrefix(normalizedPath, "/coding/")) || q["providerPresetId"] == "kimi-coding" && normalizedPath != "/coding/v1") {
			return row, os.ErrInvalid
		}
		if q["providerPresetId"] == "kimi-coding" && (base == "https://api.kimi.com/coding" || base == "https://api.kimi.com/coding/") {
			c["baseUrl"] = "https://api.kimi.com/coding/v1"
		}
		c["schemaVersion"] = 1
		c["credentialRef"] = identity("credentialRef")
		for _, k := range []string{"displayName", "providerPresetId", "authType", "customModels", "models", "compatibleApi"} {
			if x, ok := q[k]; ok {
				c[k] = x
			}
		}
		name, _ := c["displayName"].(string)
		c["displayName"] = strings.TrimSpace(name)
		if c["displayName"] == "" {
			return row, os.ErrInvalid
		}
		if e := validateSettingsModels(c, *key); e != nil {
			return row, e
		}
	}
	row.APIKey = key
	return row, nil
}

func (s *ModelConnectionsService) Save(q settingsObject) (settingsObject, error) {
	return s.mutate("model", false, q)
}

func (s *ModelConnectionsService) Delete(q settingsObject) error {
	_, e := s.mutate("model", true, q)
	return e
}

func (s *ModelConnectionsService) SaveImage(q settingsObject) (settingsObject, error) {
	return s.mutate("image", false, q)
}

func (s *ModelConnectionsService) DeleteImage(q settingsObject) error {
	_, e := s.mutate("image", true, q)
	return e
}

func (s *ModelConnectionsService) SaveMcp(q settingsObject) (settingsObject, error) {
	return s.mutate("mcp", false, q)
}

func (s *ModelConnectionsService) DeleteMcp(q settingsObject) error {
	_, e := s.mutate("mcp", true, q)
	return e
}

func settingsFailure(reason string) settingsObject {
	return settingsObject{"ok": false, "reason": reason}
}

func (s *ModelConnectionsService) CheckImage(q settingsObject) (settingsObject, error) {
	if !settingsFields(q, "baseUrl apiKey expectedRevision protocol") {
		return nil, os.ErrInvalid
	}
	if v, ok := q["apiKey"]; ok && !boundedString(v, 16384) {
		return nil, os.ErrInvalid
	}
	if v, ok := q["expectedRevision"]; ok && !positiveNumber(settingsRevision(v), 1<<53-1) {
		return nil, os.ErrInvalid
	}
	if q["apiKey"] == nil && q["expectedRevision"] == nil {
		return nil, os.ErrInvalid
	}
	base, _ := q["baseUrl"].(string)
	if _, e := security.ValidateImageEndpointURL(base); e != nil {
		return nil, e
	}
	if q["protocol"] == "dashscope" {
		return settingsFailure("unsupported"), nil
	}
	if q["protocol"] != nil && q["protocol"] != "openai-images" {
		return nil, os.ErrInvalid
	}
	key, _ := q["apiKey"].(string)
	key = strings.TrimSpace(key)
	if q["apiKey"] != nil && key == "" {
		return nil, os.ErrInvalid
	}
	if key == "" {
		s.mu.Lock()
		v, e := s.load()
		s.mu.Unlock()
		if e != nil {
			return nil, e
		}
		r := decodeRow(v.Image)
		if r.Connection == nil || settingsRevision(q["expectedRevision"]) != settingsRevision(r.Connection["revision"]) {
			return settingsFailure("changed"), nil
		}
		if r.Connection["baseUrl"] != base || r.Connection["protocol"] == "dashscope" || r.APIKey == nil || *r.APIKey == "" {
			return settingsFailure("needs_key"), nil
		}
		key = *r.APIKey
	}
	req, e := http.NewRequest("GET", strings.TrimRight(base, "/")+"/models", nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	client := http.Client{Timeout: 15 * time.Second, Transport: s.transport, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect") }}
	resp, e := client.Do(req)
	if e != nil {
		return settingsFailure("unreachable"), nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		reason := "http_error"
		switch resp.StatusCode {
		case 401, 403:
			reason = "key_rejected"
		case 404, 405, 501:
			reason = "unsupported"
		case 429:
			reason = "rate_limited"
		}
		f := settingsFailure(reason)
		f["status"] = resp.StatusCode
		return f, nil
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	var data any
	if e != nil || len(b) > 2<<20 || json.Unmarshal(b, &data) != nil {
		return settingsFailure("invalid_response"), nil
	}
	if obj, ok := data.(settingsObject); ok {
		data = obj["data"]
	}
	entries, ok := data.([]any)
	if !ok {
		return settingsFailure("invalid_response"), nil
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, v := range entries {
		m, _ := v.(settingsObject)
		id, _ := m["id"].(string)
		id = strings.TrimPrefix(id, "models/")
		if boundedString(id, 200) && !seen[id] {
			ids = append(ids, id)
			seen[id] = true
			if len(ids) == 2000 {
				break
			}
		}
	}
	return settingsObject{"ok": true, "models": ids}, nil
}

func (s *ModelConnectionsService) Discover(settingsObject) settingsObject {
	return settingsFailure("unsupported")
}

func (s *ModelConnectionsService) Check(settingsObject) settingsObject {
	return settingsFailure("unsupported")
}

func (s *ModelConnectionsService) ListMcpTools(settingsObject) settingsObject {
	return settingsFailure("unavailable")
}

func (s *ModelConnectionsService) BeginOpenAiAuth(settingsObject) settingsObject {
	return settingsFailure("unavailable")
}

func (s *ModelConnectionsService) CompleteOpenAiAuth(settingsObject) settingsObject {
	return settingsFailure("unreachable")
}

func (s *ModelConnectionsService) CancelOpenAiAuth(settingsObject) {}
func (s *ModelConnectionsService) SignOutOpenAiAuth(settingsObject) (settingsObject, error) {
	return nil, errors.New("oauth_unavailable")
}

func (s *ModelConnectionsService) PrepareStorageRecovery() (settingsObject, error) {
	return nil, errors.New("credential_storage_recovery_unavailable")
}

func (s *ModelConnectionsService) RecoverUnreadableStorage(settingsObject) (settingsObject, error) {
	return nil, errors.New("credential_storage_recovery_unavailable")
}

func validStringList(v any, limit int, valid func(string) bool) bool {
	items, ok := v.([]any)
	if !ok || len(items) == 0 || len(items) > limit {
		return false
	}
	seen := map[string]bool{}
	for _, v := range items {
		s, ok := v.(string)
		if !ok || seen[s] || !valid(s) {
			return false
		}
		seen[s] = true
	}
	return true
}

func validateSettingsModels(c settingsObject, key string) error {
	provider := c["providerPresetId"]
	if provider != "openai-compatible" {
		delete(c, "compatibleApi")
		if c["customModels"] != nil || key == "" {
			return os.ErrInvalid
		}
		if v, ok := c["models"]; ok && !validStringList(v, 1000, func(id string) bool { return boundedString(id, 200) }) {
			return os.ErrInvalid
		}
		return nil
	}
	if c["models"] != nil {
		return os.ErrInvalid
	}
	if c["compatibleApi"] == nil {
		c["compatibleApi"] = "openai-completions"
	}
	if !enumString(c["compatibleApi"], "anthropic-messages", "openai-completions", "openai-responses", "google-generative-ai") || key == "" && enumString(c["compatibleApi"], "openai-responses", "google-generative-ai") {
		return os.ErrInvalid
	}
	models, ok := c["customModels"].([]any)
	if c["customModels"] == nil && c["enabled"] == false {
		return nil
	}
	if !ok || len(models) == 0 || len(models) > 32 {
		return os.ErrInvalid
	}
	seen := map[string]bool{}
	for _, v := range models {
		m, ok := v.(settingsObject)
		if !ok {
			return os.ErrInvalid
		}
		id, _ := m["modelId"].(string)
		_, tools := m["toolCalls"].(bool)
		_, usage := m["usageInStreaming"].(bool)
		if !settingsFields(m, "modelId name input contextWindow maxTokens thinking toolCalls maxTokensField usageInStreaming") || len(m) != 8 && len(m) != 9 || len(m) == 9 && !usage || !boundedString(id, 200) || seen[id] || !boundedString(m["name"], 300) || !tools || !positiveNumber(m["contextWindow"], 16777216) || !positiveNumber(m["maxTokens"], 16777216) || m["maxTokens"].(float64) > m["contextWindow"].(float64) || !enumString(m["maxTokensField"], "max_tokens", "max_completion_tokens") {
			return os.ErrInvalid
		}
		seen[id] = true
		hasText := false
		if !validStringList(m["input"], 2, func(x string) bool {
			if x == "text" {
				hasText = true
			}
			return enumString(x, "text", "image")
		}) || !hasText || !validStringList(m["thinking"], 7, func(x string) bool { return enumString(x, "off", "minimal", "low", "medium", "high", "xhigh", "max") }) {
			return os.ErrInvalid
		}
	}
	return nil
}
