package shell

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/egoist/mygo"

	"github.com/LeonEthan/molly-design/internal/security"
)

const bentoStrictCSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self' data:; worker-src blob:; base-uri 'none'; form-action 'none'"

type DesignSaveRequest struct {
	BaseRevisionID string          `json:"baseRevisionId"`
	WritePermit    string          `json:"writePermit,omitempty"`
	Doc            json.RawMessage `json:"doc"`
	Assets         json.RawMessage `json:"assets"`
}

type DesignSaveResult struct {
	RevisionID string          `json:"revisionId"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

type SaveDesignFunc func(artworkID string, req DesignSaveRequest) (DesignSaveResult, error)

type DesignSurface struct {
	Host            string
	Origin          string
	URL             string
	ArtworkID       string
	CapabilityToken string
	Editable        bool

	mu          sync.RWMutex
	payload     json.RawMessage
	ownerPage   *mygo.Page
	navigations atomic.Int64
	revoked     atomic.Bool
}

func (s *DesignSurface) BindOwnerPage(page *mygo.Page) {
	s.mu.Lock()
	s.ownerPage = page
	s.mu.Unlock()
}

func (s *DesignSurface) Revoke() {
	s.revoked.Store(true)
}

func (s *DesignSurface) IsRevoked() bool {
	return s.revoked.Load()
}

func (s *DesignSurface) UpdatePayload(payload json.RawMessage) {
	s.mu.Lock()
	s.payload = append(json.RawMessage(nil), payload...)
	s.mu.Unlock()
}

type DesignProtocolHost struct {
	mu               sync.RWMutex
	editorHTML       []byte
	shellSHA256      string
	gate             *CanvasAccessGate
	saveFn           SaveDesignFunc
	requireOwnerPage bool
	surfaces         map[string]*DesignSurface
}

func NewDesignProtocolHost(designResourceDir string, gate *CanvasAccessGate, saveFn SaveDesignFunc) (*DesignProtocolHost, error) {
	editorBytes, err := os.ReadFile(filepath.Join(designResourceDir, "editor.html"))
	if err != nil {
		return nil, fmt.Errorf("read Bento editor.html: %w", err)
	}
	buildRaw, err := os.ReadFile(filepath.Join(designResourceDir, "build.json"))
	if err != nil {
		return nil, fmt.Errorf("read Bento build.json: %w", err)
	}
	var manifest struct {
		ShellSHA256 string `json:"shellSha256"`
	}
	if err := json.Unmarshal(buildRaw, &manifest); err != nil {
		return nil, fmt.Errorf("parse Bento build.json: %w", err)
	}
	sum := sha256.Sum256(editorBytes)
	actualHex := hex.EncodeToString(sum[:])
	if manifest.ShellSHA256 == "" || actualHex != manifest.ShellSHA256 {
		return nil, errors.New("Bento resource integrity failure: editor.html sha256 mismatch")
	}
	return &DesignProtocolHost{
		editorHTML:       editorBytes,
		shellSHA256:      actualHex,
		gate:             gate,
		saveFn:           saveFn,
		requireOwnerPage: true,
		surfaces:         make(map[string]*DesignSurface),
	}, nil
}

func NewDesignProtocolHostFromBytes(editorHTML []byte, gate *CanvasAccessGate, saveFn SaveDesignFunc) *DesignProtocolHost {
	sum := sha256.Sum256(editorHTML)
	return &DesignProtocolHost{
		editorHTML:       append([]byte(nil), editorHTML...),
		shellSHA256:      hex.EncodeToString(sum[:]),
		gate:             gate,
		saveFn:           saveFn,
		requireOwnerPage: true,
		surfaces:         make(map[string]*DesignSurface),
	}
}

func (h *DesignProtocolHost) SetRequireOwnerPageForTest(required bool) {
	h.mu.Lock()
	h.requireOwnerPage = required
	h.mu.Unlock()
}

func randomHexToken(bytesLen int) string {
	buf := make([]byte, bytesLen)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func (h *DesignProtocolHost) CreateSurface(artworkID string, payload json.RawMessage, editable bool) *DesignSurface {
	host := "canvas-" + randomHexToken(16)
	token := randomHexToken(32)
	origin := "molly-design://" + host
	urlSuffix := ""
	if editable {
		urlSuffix = "&autosave=1&molly=1"
	}
	surface := &DesignSurface{
		Host:            host,
		Origin:          origin,
		URL:             fmt.Sprintf("%s/editor.html?ws=%s%s", origin, artworkID, urlSuffix),
		ArtworkID:       artworkID,
		CapabilityToken: token,
		Editable:        editable,
		payload:         append(json.RawMessage(nil), payload...),
	}
	h.mu.Lock()
	h.surfaces[host] = surface
	h.mu.Unlock()
	return surface
}

func BuildCanvasPreloadScript(surface *DesignSurface) string {
	if surface == nil || !surface.Editable {
		return ""
	}
	savePath := "/ws/" + surface.ArtworkID + "/save"
	tokenJSON, _ := json.Marshal(surface.CapabilityToken)
	originJSON, _ := json.Marshal(surface.Origin)
	pathJSON, _ := json.Marshal(savePath)
	headerJSON, _ := json.Marshal(security.CapabilityTokenHeader)
	return fmt.Sprintf(`(() => {
  const capToken = %s;
  const allowedOrigin = %s;
  const savePath = %s;
  const capHeader = %s;
  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    try {
      const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
      const resolved = new URL(rawUrl, window.location.href);
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (method === 'POST' && resolved.origin === allowedOrigin && resolved.pathname === savePath) {
        const headers = new Headers((init && init.headers) || (input && input.headers) || undefined);
        if (!headers.has(capHeader)) {
          headers.set(capHeader, capToken);
        }
        return origFetch(input, Object.assign({}, init || {}, { headers }));
      }
    } catch (_) {}
    return origFetch(input, init);
  };
})();`, string(tokenJSON), string(originJSON), string(pathJSON), string(headerJSON))
}

func (h *DesignProtocolHost) BindSurfaceLifecycle(win *mygo.Window, surface *DesignSurface) {
	page := win.Page()
	if page == nil || surface == nil {
		return
	}
	surface.BindOwnerPage(page)
	page.OnWillNavigate(func(e *mygo.NavigateEvent) {
		if err := security.ValidateTopLevelNavigation(e.URL, surface.Origin); err != nil {
			e.PreventDefault()
			h.RevokeSurface(surface.Host)
		}
	})
	page.OnDidNavigate(func(_ string) {
		if surface.navigations.Add(1) > 1 {
			h.RevokeSurface(surface.Host)
		}
	})
	win.OnClosed(func() {
		h.RevokeSurface(surface.Host)
	})
}

func (h *DesignProtocolHost) RevokeSurface(host string) {
	h.mu.Lock()
	surface, ok := h.surfaces[host]
	if ok {
		surface.Revoke()
		delete(h.surfaces, host)
	}
	h.mu.Unlock()
}

func (h *DesignProtocolHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", bentoStrictCSP)

	if !strings.EqualFold(r.URL.Scheme, "molly-design") {
		http.Error(w, "forbidden scheme", http.StatusForbidden)
		return
	}

	h.mu.RLock()
	surface := h.surfaces[r.URL.Host]
	requireOwner := h.requireOwnerPage
	h.mu.RUnlock()
	if surface == nil || surface.IsRevoked() {
		writeJSONError(w, http.StatusForbidden, "surface_revoked")
		return
	}

	surface.mu.RLock()
	ownerPage := surface.ownerPage
	payloadCopy := append(json.RawMessage(nil), surface.payload...)
	surface.mu.RUnlock()

	callerPage := mygo.CallerPage(r.Context())
	if requireOwner {
		if ownerPage == nil || callerPage == nil || callerPage != ownerPage {
			writeJSONError(w, http.StatusForbidden, "cross_page_access_denied")
			return
		}
	} else if ownerPage != nil && callerPage != nil && callerPage != ownerPage {
		writeJSONError(w, http.StatusForbidden, "cross_page_access_denied")
		return
	}
	callerVerified := ownerPage != nil && callerPage == ownerPage

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/editor.html":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(h.editorHTML)
		return

	case r.Method == http.MethodGet && r.URL.Path == "/ws/"+surface.ArtworkID:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payloadCopy)
		return

	case r.Method == http.MethodPost && r.URL.Path == "/ws/"+surface.ArtworkID+"/save":
		if !surface.Editable {
			writeJSONError(w, http.StatusForbidden, "surface_readonly")
			return
		}
		body, err := security.ValidateProtocolWriteRequest(r, security.ProtocolWriteGateConfig{
			CapabilityToken:               surface.CapabilityToken,
			AllowedOrigin:                 surface.Origin,
			AllowOpaqueCustomSchemeOrigin: callerVerified,
			RequireBaseRev:                true,
			MaxBodyBytes:                  security.MaxDesignWriteBodyBytes,
		})
		if err != nil {
			var gateErr *security.ProtocolWriteGateError
			status := http.StatusForbidden
			code := "forbidden"
			if errors.As(err, &gateErr) {
				status = gateErr.Status
				code = gateErr.Code
			}
			writeJSONError(w, status, code)
			return
		}
		if surface.IsRevoked() {
			writeJSONError(w, http.StatusForbidden, "surface_revoked")
			return
		}
		var req DesignSaveRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if h.saveFn == nil {
			writeJSONError(w, http.StatusServiceUnavailable, "design_worker_unavailable")
			return
		}
		var saveRes DesignSaveResult
		runSave := func() error {
			if surface.IsRevoked() {
				return errors.New("surface_revoked")
			}
			var saveErr error
			saveRes, saveErr = h.saveFn(surface.ArtworkID, req)
			return saveErr
		}
		var errSave error
		if h.gate != nil {
			errSave = h.gate.Write(surface.ArtworkID, req.WritePermit, runSave)
		} else {
			errSave = runSave()
		}
		if errSave != nil {
			status := http.StatusBadRequest
			code := errSave.Error()
			switch {
			case errors.Is(errSave, ErrCanvasReadOnly):
				status = http.StatusLocked
				code = "canvas_readonly"
			case code == "DESIGN_CONFLICT":
				status = http.StatusConflict
			case code == "surface_revoked":
				status = http.StatusForbidden
			}
			writeJSONError(w, status, code)
			return
		}
		if len(saveRes.Payload) > 0 {
			surface.UpdatePayload(saveRes.Payload)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":         true,
			"revisionId": saveRes.RevisionID,
		})
		return

	default:
		writeJSONError(w, http.StatusForbidden, "forbidden_route")
	}
}

func writeJSONError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"code":  code,
		"error": code,
	})
}
