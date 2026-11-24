package security

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

const (
	MaxVaultSizeBytes = 8 * 1024 * 1024
	mv2Magic          = "MV2\x01"
	mv2AADLen         = 4 + 32
	mv2NonceLen       = 12
	mv2HeaderLen      = mv2AADLen + mv2NonceLen
)

var (
	ErrStaleV2Vault       = errors.New("v2 vault is stale relative to legacy model-connections.enc")
	ErrInvalidVaultFormat = errors.New("invalid vault format")
	ErrInvalidVaultSchema = errors.New("invalid vault schema")
)

type VaultPaths struct {
	LegacyEncPath string
	BackupEncPath string
	V2VaultPath   string
}

func DefaultVaultPaths(secretsDir string) VaultPaths {
	legacy := filepath.Join(secretsDir, "model-connections.enc")
	return VaultPaths{
		LegacyEncPath: legacy,
		BackupEncPath: legacy + ".bak",
		V2VaultPath:   filepath.Join(secretsDir, "model-connections.v2.enc"),
	}
}

type VaultDocument struct {
	SchemaVersion  int               `json:"schemaVersion"`
	InstallationID string            `json:"installationId,omitempty"`
	Entries        []json.RawMessage `json:"entries"`
	Image          json.RawMessage   `json:"image,omitempty"`
	LegacyImages   []json.RawMessage `json:"legacyImages,omitempty"`
	MCP            []json.RawMessage `json:"mcp,omitempty"`
}

type VaultMigrationResult struct {
	Document        VaultDocument
	PlainJSON       []byte
	Migrated        bool
	BackupCreated   bool
	SourceEncSHA256 [32]byte
}

type MasterKeyProvider interface {
	LoadOrCreateMasterKey() ([]byte, error)
}

type KeychainMasterKeyProvider struct {
	Service string
	Account string
	Options KeychainOptions
}

func (p KeychainMasterKeyProvider) LoadOrCreateMasterKey() ([]byte, error) {
	existing, err := ReadKeychainGenericPassword(p.Service, p.Account, p.Options)
	if err == nil {
		if len(existing) != 32 {
			return nil, fmt.Errorf("vault master key length %d, want 32", len(existing))
		}
		return existing, nil
	}
	if !errors.Is(err, ErrSecretNotFound) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, randErr := io.ReadFull(rand.Reader, key); randErr != nil {
		return nil, randErr
	}
	if setErr := SetKeychainGenericPassword(p.Service, p.Account, key, p.Options); setErr != nil {
		return nil, setErr
	}
	return key, nil
}

func UnwrapChromiumLocalStateKey(localStateJSON []byte, unprotect func([]byte) ([]byte, error)) ([]byte, error) {
	if unprotect == nil {
		unprotect = UnprotectDPAPI
	}
	var state struct {
		OSCrypt struct {
			EncryptedKey string `json:"encrypted_key"`
		} `json:"os_crypt"`
	}
	if err := json.Unmarshal(localStateJSON, &state); err != nil {
		return nil, fmt.Errorf("parse Local State JSON: %w", err)
	}
	if strings.TrimSpace(state.OSCrypt.EncryptedKey) == "" {
		return nil, errors.New("missing os_crypt.encrypted_key in Local State")
	}
	raw, err := base64.StdEncoding.DecodeString(state.OSCrypt.EncryptedKey)
	if err != nil {
		return nil, fmt.Errorf("decode encrypted_key base64: %w", err)
	}
	if !bytes.HasPrefix(raw, []byte("DPAPI")) {
		return nil, errors.New("encrypted_key missing DPAPI prefix")
	}
	key, err := unprotect(raw[len("DPAPI"):])
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("unwrapped DPAPI key length %d, want 32", len(key))
	}
	return key, nil
}

func SealMV2Vault(masterKey32 []byte, sourceEncSHA256 [32]byte, plaintextJSON []byte) ([]byte, error) {
	if len(masterKey32) != 32 {
		return nil, fmt.Errorf("expected 32-byte master key, got %d", len(masterKey32))
	}
	if len(plaintextJSON) > MaxVaultSizeBytes {
		return nil, errors.New("vault plaintext exceeds size limit")
	}
	block, err := aes.NewCipher(masterKey32)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	header := make([]byte, mv2HeaderLen)
	copy(header[0:4], mv2Magic)
	copy(header[4:36], sourceEncSHA256[:])
	if _, err := io.ReadFull(rand.Reader, header[36:48]); err != nil {
		return nil, err
	}
	aad := header[0:mv2AADLen]
	nonce := header[mv2AADLen:mv2HeaderLen]
	ciphertext := gcm.Seal(nil, nonce, plaintextJSON, aad)
	out := make([]byte, 0, len(header)+len(ciphertext))
	out = append(out, header...)
	out = append(out, ciphertext...)
	return out, nil
}

func OpenMV2Vault(masterKey32 []byte, blob []byte) (plaintext []byte, sourceEncSHA256 [32]byte, err error) {
	if len(masterKey32) != 32 {
		return nil, sourceEncSHA256, fmt.Errorf("expected 32-byte master key, got %d", len(masterKey32))
	}
	if len(blob) < mv2HeaderLen+16 || !bytes.HasPrefix(blob, []byte(mv2Magic)) {
		return nil, sourceEncSHA256, ErrInvalidVaultFormat
	}
	copy(sourceEncSHA256[:], blob[4:36])
	aad := blob[0:mv2AADLen]
	nonce := blob[mv2AADLen:mv2HeaderLen]
	ciphertext := blob[mv2HeaderLen:]

	block, err := aes.NewCipher(masterKey32)
	if err != nil {
		return nil, sourceEncSHA256, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, sourceEncSHA256, err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, sourceEncSHA256, fmt.Errorf("%w: %v", ErrInvalidVaultFormat, err)
	}
	return plain, sourceEncSHA256, nil
}

func ParseAndNormalizeVaultJSON(raw []byte) (VaultDocument, []byte, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return VaultDocument{}, nil, fmt.Errorf("%w: invalid JSON", ErrInvalidVaultSchema)
	}
	allowedTop := map[string]bool{
		"schemaVersion":  true,
		"installationId": true,
		"entries":        true,
		"image":          true,
		"legacyImages":   true,
		"mcp":            true,
	}
	for k := range top {
		if !allowedTop[k] {
			return VaultDocument{}, nil, fmt.Errorf("%w: unexpected top-level key %q", ErrInvalidVaultSchema, k)
		}
	}

	var doc VaultDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		return VaultDocument{}, nil, fmt.Errorf("%w: decode vault", ErrInvalidVaultSchema)
	}
	if doc.SchemaVersion != 1 {
		return VaultDocument{}, nil, fmt.Errorf("%w: unsupported schemaVersion %d", ErrInvalidVaultSchema, doc.SchemaVersion)
	}
	if doc.Entries == nil {
		return VaultDocument{}, nil, fmt.Errorf("%w: entries array is required", ErrInvalidVaultSchema)
	}
	if len(doc.Entries) > 256 {
		return VaultDocument{}, nil, fmt.Errorf("%w: entries exceed limit 256", ErrInvalidVaultSchema)
	}

	seenConnIDs := make(map[string]struct{}, len(doc.Entries))
	normalizedEntries := make([]json.RawMessage, len(doc.Entries))
	allowedEntryKeys := map[string]bool{
		"connection":   true,
		"apiKey":       true,
		"oauth":        true,
		"registration": true,
	}
	allowedOAuthKeys := map[string]bool{
		"accessToken":          true,
		"refreshToken":         true,
		"accessTokenExpiresAt": true,
		"denied":               true,
		"accountId":            true,
		"clientId":             true,
		"idToken":              true,
		"subject":              true,
		"scopes":               true,
		"grantSeq":             true,
	}
	for i, rawEntry := range doc.Entries {
		var entryMap map[string]json.RawMessage
		if err := json.Unmarshal(rawEntry, &entryMap); err != nil {
			return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] invalid", ErrInvalidVaultSchema, i)
		}
		for k := range entryMap {
			if !allowedEntryKeys[k] {
				return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] unexpected key %q", ErrInvalidVaultSchema, i, k)
			}
		}
		var connMeta struct {
			ID               string `json:"id"`
			ProviderPresetID string `json:"providerPresetId"`
			AuthType         string `json:"authType"`
			Enabled          bool   `json:"enabled"`
		}
		if err := json.Unmarshal(entryMap["connection"], &connMeta); err != nil || strings.TrimSpace(connMeta.ID) == "" {
			return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] missing connection.id", ErrInvalidVaultSchema, i)
		}
		if _, dup := seenConnIDs[connMeta.ID]; dup {
			return VaultDocument{}, nil, fmt.Errorf("%w: duplicate connection id", ErrInvalidVaultSchema)
		}
		seenConnIDs[connMeta.ID] = struct{}{}

		credKinds := 0
		for _, field := range []string{"apiKey", "oauth", "registration"} {
			if rawVal, ok := entryMap[field]; ok && len(bytes.TrimSpace(rawVal)) > 0 && string(bytes.TrimSpace(rawVal)) != "null" {
				credKinds++
			}
		}
		if credKinds != 1 {
			return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] must contain exactly one credential kind", ErrInvalidVaultSchema, i)
		}

		if apiKeyRaw, hasAPIKey := entryMap["apiKey"]; hasAPIKey && string(bytes.TrimSpace(apiKeyRaw)) != "null" {
			var apiKey string
			if err := json.Unmarshal(apiKeyRaw, &apiKey); err != nil {
				return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] apiKey must be string", ErrInvalidVaultSchema, i)
			}
			if len(apiKey) > 16384 || (apiKey == "" && connMeta.ProviderPresetID != "openai-compatible") {
				return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] invalid apiKey", ErrInvalidVaultSchema, i)
			}
		}

		if regRaw, hasReg := entryMap["registration"]; hasReg && string(bytes.TrimSpace(regRaw)) != "null" {
			var regMap map[string]any
			if err := json.Unmarshal(regRaw, &regMap); err != nil {
				return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] invalid registration", ErrInvalidVaultSchema, i)
			}
			for k, v := range regMap {
				if k != "clientId" && k != "subject" {
					return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] unexpected registration key %q", ErrInvalidVaultSchema, i, k)
				}
				if _, ok := v.(string); !ok {
					return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] registration.%s must be string", ErrInvalidVaultSchema, i, k)
				}
			}
			if connMeta.ProviderPresetID != "openai" || connMeta.AuthType != "openai_oauth" || connMeta.Enabled {
				return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] registration requires disabled openai_oauth", ErrInvalidVaultSchema, i)
			}
		}

		if oauthRaw, hasOAuth := entryMap["oauth"]; hasOAuth && string(bytes.TrimSpace(oauthRaw)) != "null" {
			var oauthMap map[string]any
			if err := json.Unmarshal(oauthRaw, &oauthMap); err != nil {
				return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] invalid oauth object", ErrInvalidVaultSchema, i)
			}
			for k := range oauthMap {
				if !allowedOAuthKeys[k] {
					return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] unexpected oauth key %q", ErrInvalidVaultSchema, i, k)
				}
			}
			accessTok, okA := oauthMap["accessToken"].(string)
			refreshTok, okR := oauthMap["refreshToken"].(string)
			expNum, okE := oauthMap["accessTokenExpiresAt"].(float64)
			if !okA || len(accessTok) == 0 || len(accessTok) > 16384 ||
				!okR || len(refreshTok) == 0 || len(refreshTok) > 16384 ||
				!okE || expNum <= 0 || expNum != float64(int64(expNum)) {
				return VaultDocument{}, nil, fmt.Errorf("%w: entry[%d] invalid oauth token set", ErrInvalidVaultSchema, i)
			}
			modified := false
			if _, hasGrantSeq := oauthMap["grantSeq"]; hasGrantSeq {
				delete(oauthMap, "grantSeq")
				modified = true
			}
			if connMeta.ProviderPresetID == "openai" {
				if _, ok := oauthMap["clientId"].(string); !ok {
					oauthMap["denied"] = true
					modified = true
				}
			}
			if modified {
				reencodedOAuth, err := json.Marshal(oauthMap)
				if err != nil {
					return VaultDocument{}, nil, err
				}
				entryMap["oauth"] = reencodedOAuth
				reencodedEntry, err := json.Marshal(entryMap)
				if err != nil {
					return VaultDocument{}, nil, err
				}
				normalizedEntries[i] = reencodedEntry
				continue
			}
		}
		normalizedEntries[i] = rawEntry
	}
	doc.Entries = normalizedEntries

	if len(bytes.TrimSpace(doc.Image)) > 0 && string(bytes.TrimSpace(doc.Image)) != "null" {
		if err := validateStoredImageEntry(doc.Image); err != nil {
			return VaultDocument{}, nil, err
		}
	}

	if len(doc.LegacyImages) > 16 {
		return VaultDocument{}, nil, fmt.Errorf("%w: legacyImages exceed limit 16", ErrInvalidVaultSchema)
	}
	for i, rawLegacy := range doc.LegacyImages {
		if err := validateLegacyImageCredential(rawLegacy, i); err != nil {
			return VaultDocument{}, nil, err
		}
	}
	if len(doc.MCP) > 256 {
		return VaultDocument{}, nil, fmt.Errorf("%w: mcp entries exceed limit 256", ErrInvalidVaultSchema)
	}
	seenMCPPair := make(map[string]struct{}, len(doc.MCP))
	seenMCPRef := make(map[string]struct{}, len(doc.MCP))
	for i, rawMCP := range doc.MCP {
		pairKey, credRef, err := validateStoredMcpCredential(rawMCP, i)
		if err != nil {
			return VaultDocument{}, nil, err
		}
		if _, dup := seenMCPPair[pairKey]; dup {
			return VaultDocument{}, nil, fmt.Errorf("%w: duplicate mcp server credential", ErrInvalidVaultSchema)
		}
		seenMCPPair[pairKey] = struct{}{}
		if _, dup := seenMCPRef[credRef]; dup {
			return VaultDocument{}, nil, fmt.Errorf("%w: duplicate mcp credentialRef", ErrInvalidVaultSchema)
		}
		seenMCPRef[credRef] = struct{}{}
	}

	normalizedBytes, err := json.Marshal(doc)
	if err != nil {
		return VaultDocument{}, nil, err
	}
	return doc, normalizedBytes, nil
}

var (
	uuidPattern          = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	mcpFieldNamePattern  = regexp.MustCompile(`^[A-Za-z0-9!#$%&'*+.^_` + "`" + `|~-]+$`)
	mcpEnvIdentPattern   = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	mcpEnvBlockedPrefix  = regexp.MustCompile(`^(PI_|MOLLY_|LODY_|NODE_|ELECTRON_|LD_|DYLD_|XDG_|BASH_FUNC_)`)
	reservedMcpHeaderSet = map[string]bool{
		"host": true, "connection": true, "content-length": true, "content-type": true,
		"accept": true, "accept-encoding": true, "transfer-encoding": true, "upgrade": true,
		"trailer": true, "te": true, "expect": true, "keep-alive": true,
		"proxy-authorization": true, "proxy-connection": true, "mcp-session-id": true,
		"mcp-protocol-version": true, "last-event-id": true,
	}
	reservedMcpEnvSet = map[string]bool{
		"PATH": true, "HOME": true, "USER": true, "LOGNAME": true, "LANG": true,
		"LC_ALL": true, "LC_CTYPE": true, "SHELL": true, "SYSTEMROOT": true, "WINDIR": true,
		"COMSPEC": true, "PATHEXT": true, "USERPROFILE": true, "HOMEDRIVE": true, "HOMEPATH": true,
		"APPDATA": true, "LOCALAPPDATA": true, "PROGRAMDATA": true, "TMPDIR": true, "TMP": true,
		"TEMP": true, "ENV": true, "BASH_ENV": true, "BASHOPTS": true, "SHELLOPTS": true,
		"CDPATH": true, "GLOBIGNORE": true, "IFS": true, "DO_NOT_TRACK": true,
		"HTTP_PROXY": true, "HTTPS_PROXY": true, "ALL_PROXY": true, "NO_PROXY": true,
	}
)

func isPositiveJSONInt(v any) bool {
	n, ok := v.(float64)
	return ok && !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 1 && n == float64(int64(n))
}

func isValidModelEndpointURL(raw string) bool {
	if len(raw) == 0 || len(raw) > 2048 {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		strings.Contains(raw, "?") || strings.Contains(raw, "#") {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	if parsed.Scheme == "http" {
		h := StripIPv6Brackets(parsed.Hostname())
		return h == "localhost" || h == "127.0.0.1" || h == "::1"
	}
	return false
}

func isRawJSONString(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"'
}

func isRawJSONArray(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) >= 2 && trimmed[0] == '[' && trimmed[len(trimmed)-1] == ']'
}

func isRawJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) >= 2 && trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}'
}

func unmarshalStrictString(raw json.RawMessage) (string, bool) {
	if !isRawJSONString(raw) {
		return "", false
	}
	var out string
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", false
	}
	return out, true
}

func unmarshalStrictStringSlice(raw json.RawMessage) ([]string, bool) {
	if !isRawJSONArray(raw) {
		return nil, false
	}
	var elems []json.RawMessage
	if err := json.Unmarshal(raw, &elems); err != nil {
		return nil, false
	}
	out := make([]string, len(elems))
	for i, elem := range elems {
		s, ok := unmarshalStrictString(elem)
		if !ok {
			return nil, false
		}
		out[i] = s
	}
	return out, true
}

func validateStoredImageEntry(raw json.RawMessage) error {
	var imgMap map[string]json.RawMessage
	if err := json.Unmarshal(raw, &imgMap); err != nil {
		return fmt.Errorf("%w: image must be object", ErrInvalidVaultSchema)
	}
	if len(imgMap) != 2 {
		return fmt.Errorf("%w: image must contain connection and apiKey", ErrInvalidVaultSchema)
	}
	for k := range imgMap {
		if k != "connection" && k != "apiKey" {
			return fmt.Errorf("%w: unexpected image key %q", ErrInvalidVaultSchema, k)
		}
	}
	imgKey, okKey := unmarshalStrictString(imgMap["apiKey"])
	if !okKey || len(imgKey) > 16384 {
		return fmt.Errorf("%w: image.apiKey must be valid string", ErrInvalidVaultSchema)
	}
	if !isRawJSONObject(imgMap["connection"]) {
		return fmt.Errorf("%w: image.connection must be object", ErrInvalidVaultSchema)
	}
	var connMap map[string]any
	if err := json.Unmarshal(imgMap["connection"], &connMap); err != nil {
		return fmt.Errorf("%w: image.connection must be object", ErrInvalidVaultSchema)
	}
	allowedConnKeys := map[string]bool{
		"id": true, "revision": true, "enabled": true, "protocol": true,
		"baseUrl": true, "model": true, "hasApiKey": true, "legacyHistoryMayContainKey": true,
	}
	for k := range connMap {
		if !allowedConnKeys[k] {
			return fmt.Errorf("%w: image.connection unexpected key %q", ErrInvalidVaultSchema, k)
		}
	}
	id, okID := connMap["id"].(string)
	if !okID || !uuidPattern.MatchString(id) {
		return fmt.Errorf("%w: image.connection.id must be UUID", ErrInvalidVaultSchema)
	}
	if !isPositiveJSONInt(connMap["revision"]) {
		return fmt.Errorf("%w: image.connection.revision must be positive integer", ErrInvalidVaultSchema)
	}
	if _, ok := connMap["enabled"].(bool); !ok {
		return fmt.Errorf("%w: image.connection.enabled must be boolean", ErrInvalidVaultSchema)
	}
	if protoRaw, exists := connMap["protocol"]; exists {
		proto, ok := protoRaw.(string)
		if !ok || (proto != "openai-images" && proto != "dashscope") {
			return fmt.Errorf("%w: image.connection.protocol invalid", ErrInvalidVaultSchema)
		}
	}
	baseURL, okURL := connMap["baseUrl"].(string)
	if !okURL {
		return fmt.Errorf("%w: image.connection.baseUrl must be string", ErrInvalidVaultSchema)
	}
	if _, err := ValidateImageEndpointURL(baseURL); err != nil {
		return fmt.Errorf("%w: image.connection.baseUrl invalid", ErrInvalidVaultSchema)
	}
	model, okModel := connMap["model"].(string)
	if !okModel || len(strings.TrimSpace(model)) == 0 || len(strings.TrimSpace(model)) > 200 {
		return fmt.Errorf("%w: image.connection.model invalid", ErrInvalidVaultSchema)
	}
	if _, ok := connMap["hasApiKey"].(bool); !ok {
		return fmt.Errorf("%w: image.connection.hasApiKey must be boolean", ErrInvalidVaultSchema)
	}
	if _, ok := connMap["legacyHistoryMayContainKey"].(bool); !ok {
		return fmt.Errorf("%w: image.connection.legacyHistoryMayContainKey must be boolean", ErrInvalidVaultSchema)
	}
	return nil
}

func validateLegacyImageCredential(raw json.RawMessage, idx int) error {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return fmt.Errorf("%w: legacyImages[%d] must be object", ErrInvalidVaultSchema, idx)
	}
	allowed := map[string]bool{
		"v": true, "enabled": true, "baseUrl": true, "model": true, "apiKey": true, "updatedAt": true,
	}
	if len(obj) != len(allowed) {
		return fmt.Errorf("%w: legacyImages[%d] missing or unexpected keys", ErrInvalidVaultSchema, idx)
	}
	for k := range obj {
		if !allowed[k] {
			return fmt.Errorf("%w: legacyImages[%d] unexpected key %q", ErrInvalidVaultSchema, idx, k)
		}
	}
	if v, ok := obj["v"].(float64); !ok || v != 1 {
		return fmt.Errorf("%w: legacyImages[%d].v must be 1", ErrInvalidVaultSchema, idx)
	}
	if _, ok := obj["enabled"].(bool); !ok {
		return fmt.Errorf("%w: legacyImages[%d].enabled must be boolean", ErrInvalidVaultSchema, idx)
	}
	if baseURL, ok := obj["baseUrl"].(string); !ok || len(baseURL) > 2048 {
		return fmt.Errorf("%w: legacyImages[%d].baseUrl invalid", ErrInvalidVaultSchema, idx)
	}
	if model, ok := obj["model"].(string); !ok || len(model) > 200 {
		return fmt.Errorf("%w: legacyImages[%d].model invalid", ErrInvalidVaultSchema, idx)
	}
	if apiKey, ok := obj["apiKey"].(string); !ok || len(apiKey) > 16384 {
		return fmt.Errorf("%w: legacyImages[%d].apiKey invalid", ErrInvalidVaultSchema, idx)
	}
	if updatedAt, ok := obj["updatedAt"].(float64); !ok || math.IsNaN(updatedAt) || math.IsInf(updatedAt, 0) {
		return fmt.Errorf("%w: legacyImages[%d].updatedAt must be finite number", ErrInvalidVaultSchema, idx)
	}
	return nil
}

func validateStoredMcpCredential(raw json.RawMessage, idx int) (string, string, error) {
	var row map[string]json.RawMessage
	if err := json.Unmarshal(raw, &row); err != nil {
		return "", "", fmt.Errorf("%w: mcp[%d] must be object", ErrInvalidVaultSchema, idx)
	}
	if len(row) != 2 {
		return "", "", fmt.Errorf("%w: mcp[%d] must contain only connection and values", ErrInvalidVaultSchema, idx)
	}
	for k := range row {
		if k != "connection" && k != "values" {
			return "", "", fmt.Errorf("%w: mcp[%d] unexpected key %q", ErrInvalidVaultSchema, idx, k)
		}
	}

	if !isRawJSONObject(row["connection"]) {
		return "", "", fmt.Errorf("%w: mcp[%d].connection must be object", ErrInvalidVaultSchema, idx)
	}
	var connMap map[string]json.RawMessage
	if err := json.Unmarshal(row["connection"], &connMap); err != nil {
		return "", "", fmt.Errorf("%w: mcp[%d].connection must be object", ErrInvalidVaultSchema, idx)
	}
	allowedConn := map[string]bool{
		"workspaceId": true, "serverId": true, "credentialRef": true,
		"revision": true, "destination": true, "fieldNames": true,
	}
	if len(connMap) != len(allowedConn) {
		return "", "", fmt.Errorf("%w: mcp[%d].connection missing or unexpected keys", ErrInvalidVaultSchema, idx)
	}
	for k := range connMap {
		if !allowedConn[k] {
			return "", "", fmt.Errorf("%w: mcp[%d].connection unexpected key %q", ErrInvalidVaultSchema, idx, k)
		}
	}

	workspaceID, okWS := unmarshalStrictString(connMap["workspaceId"])
	if !okWS || len(strings.TrimSpace(workspaceID)) == 0 || len(workspaceID) > 200 {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.workspaceId invalid", ErrInvalidVaultSchema, idx)
	}
	serverID, okSrv := unmarshalStrictString(connMap["serverId"])
	if !okSrv || len(strings.TrimSpace(serverID)) == 0 || len(serverID) > 200 {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.serverId invalid", ErrInvalidVaultSchema, idx)
	}
	credentialRef, okRef := unmarshalStrictString(connMap["credentialRef"])
	if !okRef || !uuidPattern.MatchString(credentialRef) {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.credentialRef must be UUID", ErrInvalidVaultSchema, idx)
	}
	var rev float64
	if err := json.Unmarshal(connMap["revision"], &rev); err != nil || !isPositiveJSONInt(rev) {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.revision must be positive integer", ErrInvalidVaultSchema, idx)
	}
	fieldNames, okFields := unmarshalStrictStringSlice(connMap["fieldNames"])
	if !okFields || len(fieldNames) == 0 || len(fieldNames) > 32 {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.fieldNames invalid", ErrInvalidVaultSchema, idx)
	}

	if !isRawJSONObject(connMap["destination"]) {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.destination must be object", ErrInvalidVaultSchema, idx)
	}
	var destMap map[string]json.RawMessage
	if err := json.Unmarshal(connMap["destination"], &destMap); err != nil {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.destination must be object", ErrInvalidVaultSchema, idx)
	}
	transport, okTransport := unmarshalStrictString(destMap["transport"])
	if !okTransport {
		return "", "", fmt.Errorf("%w: mcp[%d].connection.destination.transport invalid", ErrInvalidVaultSchema, idx)
	}
	switch transport {
	case "http":
		if len(destMap) != 2 {
			return "", "", fmt.Errorf("%w: mcp[%d] http destination unexpected keys", ErrInvalidVaultSchema, idx)
		}
		destURL, okDestURL := unmarshalStrictString(destMap["url"])
		if !okDestURL || !isValidModelEndpointURL(destURL) {
			return "", "", fmt.Errorf("%w: mcp[%d] http destination.url invalid", ErrInvalidVaultSchema, idx)
		}
	case "stdio":
		if len(destMap) != 3 {
			return "", "", fmt.Errorf("%w: mcp[%d] stdio destination unexpected keys", ErrInvalidVaultSchema, idx)
		}
		command, okCmd := unmarshalStrictString(destMap["command"])
		if !okCmd || len(command) == 0 || len(command) > 4096 || strings.ContainsAny(command, "\x00\r\n") {
			return "", "", fmt.Errorf("%w: mcp[%d] stdio destination.command invalid", ErrInvalidVaultSchema, idx)
		}
		args, okArgs := unmarshalStrictStringSlice(destMap["args"])
		if !okArgs || len(args) > 64 {
			return "", "", fmt.Errorf("%w: mcp[%d] stdio destination.args invalid", ErrInvalidVaultSchema, idx)
		}
		for _, arg := range args {
			if len(arg) > 4096 || strings.ContainsRune(arg, '\x00') {
				return "", "", fmt.Errorf("%w: mcp[%d] stdio destination arg invalid", ErrInvalidVaultSchema, idx)
			}
		}
	default:
		return "", "", fmt.Errorf("%w: mcp[%d] unsupported destination transport %q", ErrInvalidVaultSchema, idx, transport)
	}

	seenLower := make(map[string]struct{}, len(fieldNames))
	for _, name := range fieldNames {
		if len(name) == 0 || len(name) > 128 || !mcpFieldNamePattern.MatchString(name) {
			return "", "", fmt.Errorf("%w: mcp[%d] invalid field name %q", ErrInvalidVaultSchema, idx, name)
		}
		lower := strings.ToLower(name)
		if _, dup := seenLower[lower]; dup {
			return "", "", fmt.Errorf("%w: mcp[%d] duplicate field name %q", ErrInvalidVaultSchema, idx, name)
		}
		seenLower[lower] = struct{}{}
		if transport == "http" {
			if reservedMcpHeaderSet[lower] {
				return "", "", fmt.Errorf("%w: mcp[%d] reserved http header %q", ErrInvalidVaultSchema, idx, name)
			}
		} else {
			upper := strings.ToUpper(name)
			if !mcpEnvIdentPattern.MatchString(name) || reservedMcpEnvSet[upper] || mcpEnvBlockedPrefix.MatchString(upper) {
				return "", "", fmt.Errorf("%w: mcp[%d] reserved stdio env %q", ErrInvalidVaultSchema, idx, name)
			}
		}
	}

	if !isRawJSONObject(row["values"]) {
		return "", "", fmt.Errorf("%w: mcp[%d].values must be non-empty string map", ErrInvalidVaultSchema, idx)
	}
	var rawValues map[string]json.RawMessage
	if err := json.Unmarshal(row["values"], &rawValues); err != nil || len(rawValues) == 0 || len(rawValues) > 32 {
		return "", "", fmt.Errorf("%w: mcp[%d].values must be non-empty string map", ErrInvalidVaultSchema, idx)
	}
	values := make(map[string]string, len(rawValues))
	for k, rawV := range rawValues {
		v, okV := unmarshalStrictString(rawV)
		if !okV {
			return "", "", fmt.Errorf("%w: mcp[%d].values.%s must be string", ErrInvalidVaultSchema, idx, k)
		}
		values[k] = v
	}
	encodedValues, err := json.Marshal(values)
	if err != nil || len(encodedValues) > 65536 {
		return "", "", fmt.Errorf("%w: mcp[%d].values exceeds 65536 byte limit", ErrInvalidVaultSchema, idx)
	}
	valueKeys := make([]string, 0, len(values))
	for k, v := range values {
		if len(k) == 0 || len(k) > 128 || !mcpFieldNamePattern.MatchString(k) {
			return "", "", fmt.Errorf("%w: mcp[%d].values invalid key %q", ErrInvalidVaultSchema, idx, k)
		}
		if len(v) == 0 || len(v) > 16384 || strings.ContainsAny(v, "\x00\r\n") {
			return "", "", fmt.Errorf("%w: mcp[%d].values invalid value for %q", ErrInvalidVaultSchema, idx, k)
		}
		valueKeys = append(valueKeys, k)
	}
	sortedFields := append([]string(nil), fieldNames...)
	sort.Strings(sortedFields)
	sort.Strings(valueKeys)
	if len(sortedFields) != len(valueKeys) {
		return "", "", fmt.Errorf("%w: mcp[%d] fieldNames/values mismatch", ErrInvalidVaultSchema, idx)
	}
	for i := range sortedFields {
		if sortedFields[i] != valueKeys[i] {
			return "", "", fmt.Errorf("%w: mcp[%d] fieldNames/values mismatch", ErrInvalidVaultSchema, idx)
		}
	}

	return workspaceID + "\x00" + serverID, credentialRef, nil
}

func readRegularVaultFile(path string) ([]byte, bool, error) {
	f, err := openRegularNoFollow(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, false, nil
		}
		return nil, false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, false, err
	}
	if !info.Mode().IsRegular() || info.Size() > MaxVaultSizeBytes {
		return nil, false, ErrInvalidVaultFormat
	}
	data, err := io.ReadAll(io.LimitReader(f, MaxVaultSizeBytes+1))
	if err != nil {
		return nil, false, err
	}
	if len(data) > MaxVaultSizeBytes {
		return nil, false, ErrInvalidVaultFormat
	}
	return data, true, nil
}

func writeFileAtomic0600(targetPath string, content []byte) error {
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	suffix := make([]byte, 8)
	if _, err := io.ReadFull(rand.Reader, suffix); err != nil {
		return err
	}
	tmpPath := filepath.Join(dir, fmt.Sprintf(".%s.%s.tmp", filepath.Base(targetPath), hex.EncodeToString(suffix)))
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()
	if _, err := f.Write(content); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, targetPath); err != nil {
		return err
	}
	committed = true
	if runtime.GOOS != "windows" {
		if df, dirErr := os.Open(dir); dirErr == nil {
			_ = df.Sync()
			_ = df.Close()
		}
	}
	return nil
}

func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

func MigrateAndResealVault(
	paths VaultPaths,
	legacyDecrypt func(blob []byte) ([]byte, error),
	masterKeys MasterKeyProvider,
) (*VaultMigrationResult, error) {
	return migrateVault(paths, legacyDecrypt, masterKeys, false)
}

func RemigrateVaultFromLegacy(
	paths VaultPaths,
	legacyDecrypt func(blob []byte) ([]byte, error),
	masterKeys MasterKeyProvider,
) (*VaultMigrationResult, error) {
	return migrateVault(paths, legacyDecrypt, masterKeys, true)
}

func migrateVault(
	paths VaultPaths,
	legacyDecrypt func(blob []byte) ([]byte, error),
	masterKeys MasterKeyProvider,
	forceRemigrate bool,
) (*VaultMigrationResult, error) {
	if masterKeys == nil {
		return nil, errors.New("master key provider is required")
	}
	masterKey, err := masterKeys.LoadOrCreateMasterKey()
	if err != nil {
		return nil, err
	}
	defer zeroBytes(masterKey)

	legacyBytes, hasLegacy, err := readRegularVaultFile(paths.LegacyEncPath)
	if err != nil {
		return nil, fmt.Errorf("read legacy vault: %w", err)
	}
	var currentLegacySHA [32]byte
	if hasLegacy {
		currentLegacySHA = sha256.Sum256(legacyBytes)
	}

	if !forceRemigrate {
		v2Bytes, hasV2, v2ReadErr := readRegularVaultFile(paths.V2VaultPath)
		if v2ReadErr != nil {
			return nil, fmt.Errorf("read v2 vault: %w", v2ReadErr)
		}
		if hasV2 {
			plain, boundSHA, openErr := OpenMV2Vault(masterKey, v2Bytes)
			if openErr != nil {
				return nil, openErr
			}
			var zeroSHA [32]byte
			if boundSHA != zeroSHA && (!hasLegacy || boundSHA != currentLegacySHA) {
				zeroBytes(plain)
				return nil, ErrStaleV2Vault
			}
			if hasLegacy && boundSHA == zeroSHA {
				zeroBytes(plain)
				return nil, ErrStaleV2Vault
			}
			doc, norm, parseErr := ParseAndNormalizeVaultJSON(plain)
			zeroBytes(plain)
			if parseErr != nil {
				return nil, parseErr
			}
			return &VaultMigrationResult{
				Document:        doc,
				PlainJSON:       norm,
				Migrated:        false,
				BackupCreated:   false,
				SourceEncSHA256: boundSHA,
			}, nil
		}
	}

	if !hasLegacy {
		emptyDoc := VaultDocument{SchemaVersion: 1, Entries: []json.RawMessage{}}
		emptyJSON, err := json.Marshal(emptyDoc)
		if err != nil {
			return nil, err
		}
		return &VaultMigrationResult{
			Document:  emptyDoc,
			PlainJSON: emptyJSON,
			Migrated:  false,
		}, nil
	}

	if legacyDecrypt == nil {
		return nil, errors.New("legacy vault decryptor is required")
	}
	decrypted, err := legacyDecrypt(legacyBytes)
	if err != nil {
		return nil, fmt.Errorf("decrypt legacy vault: %w", err)
	}
	defer zeroBytes(decrypted)

	doc, normalizedJSON, err := ParseAndNormalizeVaultJSON(decrypted)
	if err != nil {
		return nil, err
	}

	backupCreated := false
	if paths.BackupEncPath != "" {
		_, hasBak, bakErr := readRegularVaultFile(paths.BackupEncPath)
		if bakErr != nil {
			return nil, fmt.Errorf("check legacy backup: %w", bakErr)
		}
		if !hasBak {
			if err := writeFileAtomic0600(paths.BackupEncPath, legacyBytes); err != nil {
				return nil, fmt.Errorf("write legacy backup: %w", err)
			}
			backupCreated = true
		}
	}

	sealed, err := SealMV2Vault(masterKey, currentLegacySHA, normalizedJSON)
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic0600(paths.V2VaultPath, sealed); err != nil {
		return nil, fmt.Errorf("write v2 vault: %w", err)
	}

	return &VaultMigrationResult{
		Document:        doc,
		PlainJSON:       normalizedJSON,
		Migrated:        true,
		BackupCreated:   backupCreated,
		SourceEncSHA256: currentLegacySHA,
	}, nil
}
