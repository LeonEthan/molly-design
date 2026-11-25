package shell

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"reflect"
	"runtime"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
)

func coordinatorMethod(method string) bool {
	switch method {
	case "harness/host", "design/canvas-host", "design/render-host", "mcp/catalog-entry", "browser/host", "browser/pause-all":
		return true
	}
	return false
}

func (b *MollyBridge) coordinatorRPC(ctx context.Context, s *CLISupervisor, machine, workspace, method string, params, result any) error {
	if !s.OwnsPrivateDaemon() || !coordinatorMethod(method) {
		return errors.New("private_daemon_required")
	}
	body, err := json.Marshal(map[string]any{"machineId": machine, "workspaceId": workspace, "method": method, "params": params})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", "http://localhost/machine-rpc", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-lody-local-control", "1")
	req.Header.Set("X-Molly-Coordinator-Token", s.coordinator)
	client := s.privateClient(b.cfg.ControlSocketPath)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return errors.New("coordinator_request_failed")
	}
	var envelope struct {
		Ok     bool
		Result json.RawMessage
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&envelope); err != nil {
		return err
	}
	if !envelope.Ok {
		return errors.New("coordinator_request_failed")
	}
	return json.Unmarshal(envelope.Result, result)
}

type harnessEntry struct {
	Connection map[string]any
	APIKey     *string
	OAuth      *struct {
		AccessToken, AccountID string
		AccessTokenExpiresAt   int64
		Denied                 bool
	}
}
type harnessRequest struct {
	RequestID string
	Snapshot  struct {
		RunID, RuntimeEpoch string
		Connection          map[string]any
		ImageConnection     map[string]any
	}
	ImageConnection map[string]any
}

type harnessVault struct {
	Entries []harnessEntry
	Image   *harnessEntry
	MCP     []struct {
		Connection map[string]any
		Values     map[string]string
	}
}
type mcpGrantRequest struct {
	RequestID  string
	Connection map[string]any
	Session    struct {
		SessionID, RuntimeEpoch, WorkspaceID string
		MCPConnections                       []map[string]any
	}
}

func experimentalMasterKey(root *os.Root) ([]byte, error) {
	if runtime.GOOS == "windows" {
		protected, err := security.ReadBoundedFileFromRoot(root, "secrets/model-connections.master-key.dpapi", 8192)
		if err != nil {
			return nil, err
		}
		return security.UnprotectDPAPI(protected)
	}
	return security.ReadKeychainGenericPassword("Molly Experimental Safe Storage", "Master Key", security.KeychainOptions{})
}

func readHarnessVault(root *os.Root) (harnessVault, error) {
	var vault harnessVault
	blob, err := security.ReadBoundedFileFromRoot(root, "secrets/model-connections.v2.enc", security.MaxVaultSizeBytes)
	if errors.Is(err, os.ErrNotExist) {
		return vault, nil
	}
	if err != nil {
		return vault, err
	}
	key, err := experimentalMasterKey(root)
	if err != nil {
		return vault, err
	}
	defer clear(key)
	raw, _, err := security.OpenMV2Vault(key, blob)
	if err != nil {
		return vault, err
	}
	defer clear(raw)
	_, normalized, err := security.ParseAndNormalizeVaultJSON(raw)
	if err != nil {
		return vault, err
	}
	defer clear(normalized)
	err = json.Unmarshal(normalized, &vault)
	return vault, err
}

func unavailableGrant() map[string]any {
	return map[string]any{"ok": false, "error": "credential_unavailable"}
}

func (v harnessVault) modelReport(r harnessRequest, now time.Time) map[string]any {
	conn := r.Snapshot.Connection
	result := unavailableGrant()
	report := map[string]any{"requestId": r.RequestID, "runId": r.Snapshot.RunID, "runtimeEpoch": r.Snapshot.RuntimeEpoch, "connectionId": conn["id"], "connectionRevision": conn["revision"]}
	if r.ImageConnection != nil {
		report["imageConnectionId"] = r.ImageConnection["id"]
		report["imageConnectionRevision"] = r.ImageConnection["revision"]
		if v.Image != nil && v.Image.APIKey != nil && v.Image.Connection["enabled"] == true && reflect.DeepEqual(v.Image.Connection, r.ImageConnection) && reflect.DeepEqual(r.Snapshot.ImageConnection, r.ImageConnection) {
			result = map[string]any{"ok": true, "apiKey": *v.Image.APIKey}
		}
	} else {
		for _, e := range v.Entries {
			if e.Connection["enabled"] != true || !reflect.DeepEqual(e.Connection, conn) {
				continue
			}
			if e.APIKey != nil {
				result = map[string]any{"ok": true, "apiKey": *e.APIKey}
			} else if oauth := e.OAuth; oauth != nil && !oauth.Denied && oauth.AccessToken != "" && oauth.AccessTokenExpiresAt > now.UnixMilli() {
				result = map[string]any{"ok": true, "apiKey": oauth.AccessToken, "oauthConnectionId": conn["id"]}
				if oauth.AccountID != "" {
					result["oauthAccountId"] = oauth.AccountID
				}
			}
			break
		}
	}
	report["result"] = result
	return report
}

func (v harnessVault) mcpReport(ws string, r mcpGrantRequest) map[string]any {
	result := unavailableGrant()
	if ws == r.Session.WorkspaceID && r.Connection["workspaceId"] == ws {
		for _, binding := range r.Session.MCPConnections {
			if !reflect.DeepEqual(binding, r.Connection) {
				continue
			}
			for _, stored := range v.MCP {
				if reflect.DeepEqual(stored.Connection, binding) {
					result = map[string]any{"ok": true, "values": stored.Values}
					break
				}
			}
			break
		}
	}
	return map[string]any{"requestId": r.RequestID, "sessionId": r.Session.SessionID, "runtimeEpoch": r.Session.RuntimeEpoch, "credentialRef": r.Connection["credentialRef"], "credentialRevision": r.Connection["revision"], "result": result}
}

func (b *MollyBridge) runHarnessHost(ctx context.Context, s *CLISupervisor) {
	var pending harnessExchangeResult
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	for s.OwnsPrivateDaemon() {
		select {
		case <-ctx.Done():
			return
		case <-s.done:
			return
		case <-b.vaultWake:
		case <-timer.C:
		}
		workspace, err := readLocalPlatformSnapshot(b.cfg.DataDir)
		if err != nil || workspace == nil {
			continue
		}
		w, _ := workspace["workspace"].(map[string]any)
		ws, _ := w["workspaceId"].(string)
		machine := b.getLocalMachineID(ctx)
		if machine == "" || ws == "" {
			continue
		}
		v, err := readHarnessVault(s.root)
		if err != nil {
			continue
		}
		catalog := make([]map[string]any, 0, len(v.Entries))
		for _, e := range v.Entries {
			catalog = append(catalog, e.Connection)
		}
		bindings := make([]map[string]any, 0, len(v.MCP))
		for _, e := range v.MCP {
			if e.Connection["workspaceId"] == ws {
				bindings = append(bindings, e.Connection)
			}
		}
		reports := make([]map[string]any, 0, len(pending.Requests))
		for _, r := range pending.Requests {
			reports = append(reports, v.modelReport(r, time.Now()))
		}
		mcpReports := make([]map[string]any, 0, len(pending.MCPRequests))
		for _, r := range pending.MCPRequests {
			mcpReports = append(mcpReports, v.mcpReport(ws, r))
		}
		params := map[string]any{"version": 1, "connections": catalog, "reports": reports, "mcpConnections": bindings, "mcpReports": mcpReports, "imageConnection": nil}
		if v.Image != nil {
			params["imageConnection"] = v.Image.Connection
		}
		var reply harnessExchangeResult
		if err = b.coordinatorRPC(ctx, s, machine, ws, "harness/host", params, &reply); err == nil && reply.Type == "harness/host" && reply.Version == 1 && len(reply.Requests) <= 8 && len(reply.MCPRequests) <= 8 {
			pending = reply
		}
	}
}

type harnessExchangeResult struct {
	Type        string
	Version     int
	Requests    []harnessRequest
	MCPRequests []mcpGrantRequest
}

func (s *CLISupervisor) privateClient(endpoint string) *http.Client {
	return &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return dialOwnedCLI(ctx, endpoint, s.process.Pid)
	}}}
}
