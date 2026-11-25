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
	"runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/egoist/mygo"

	"github.com/LeonEthan/molly-design/internal/security"
)

const bentoStrictCSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self' data:; worker-src blob:; base-uri 'none'; form-action 'none'"

type DesignSaveRequest struct {
	BeforeSend     func() error    `json:"-"`
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
	onSelection     func(map[string]any)
	Host            string
	Origin          string
	URL             string
	ArtworkID       string
	CapabilityToken string
	Editable        bool

	upload            *designUpload
	lastUnackedCommit *designUpload
	chunked           bool
	mu                sync.RWMutex
	payload           json.RawMessage
	ownerPage         *mygo.Page
	navigations       atomic.Int64
	revoked           atomic.Bool
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
	platform         string
	mu               sync.RWMutex
	spool            *os.Root
	editorHTML       []byte
	shellSHA256      string
	gate             *CanvasAccessGate
	saveFn           SaveDesignFunc
	requireOwnerPage bool
	surfaces         map[string]*DesignSurface
}

func NewDesignProtocolHost(designResourceDir string, gate *CanvasAccessGate, saveFn SaveDesignFunc, dataDir ...string) (*DesignProtocolHost, error) {
	if len(dataDir) > 0 {
		return NewDesignProtocolHostWithDataDir(designResourceDir, gate, saveFn, dataDir[0])
	}
	return NewDesignProtocolHostWithDataDir(designResourceDir, gate, saveFn, "")
}
func NewDesignProtocolHostWithDataDir(designResourceDir string, gate *CanvasAccessGate, saveFn SaveDesignFunc, dataDir string) (*DesignProtocolHost, error) {
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
	var spool *os.Root
	if dataDir != "" {
		spool, err = openDesignSpool(dataDir)
		if err != nil {
			return nil, err
		}
	}
	return &DesignProtocolHost{
		platform:         runtime.GOOS,
		spool:            spool,
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
		platform:         runtime.GOOS,
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

func protocolOrigin(platform, scheme, host string) string {
	if platform == "windows" && host == "localhost" {
		return "http://" + scheme + ".localhost"
	}
	if platform == "windows" {
		return "http://" + host + "." + scheme + ".localhost"
	}
	return scheme + "://" + host
}
func validateProtocolNavigation(target, platform, scheme, host string) error {
	if platform == "windows" && security.ValidateTopLevelNavigation(target, scheme+"://"+host) == nil {
		return nil
	}
	return security.ValidateTopLevelNavigation(target, protocolOrigin(platform, scheme, host))
}
func randomHexToken(bytesLen int) string {
	buf := make([]byte, bytesLen)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

func (h *DesignProtocolHost) CreateSurface(artworkID string, payload json.RawMessage, editable bool) *DesignSurface {
	host := "canvas-" + randomHexToken(16)
	token := randomHexToken(32)
	origin := protocolOrigin(h.platform, "molly-design", host)
	urlSuffix := ""
	if editable {
		urlSuffix = "&autosave=1&molly=1"
	}
	surface := &DesignSurface{
		chunked:         h.spool != nil,
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
  let lastAppliedSeq = -1;
  window.__mollyApplyReadonly = (seq, locked, reason) => {
    if (seq < lastAppliedSeq) return true;
    if (typeof window.molly?.setReadonly !== 'function') return false;
    lastAppliedSeq = seq;
    window.molly.setReadonly(locked, reason);
    return true;
  };
  let selectionSummary = null;
  window.__mollySelectionSummary = () => selectionSummary;
  const origFetch = window.fetch.bind(window);
  const chunked = %t;
  let previous;
  let recovered;
  async function send(route, method, value, binary, signal) {
    const headers = { [capHeader]: capToken };
    if (value !== undefined) headers['Content-Type'] = binary ? 'application/octet-stream' : 'application/json';
    return origFetch(allowedOrigin + savePath + '/' + route, { method, headers, signal, body: binary ? value : JSON.stringify(value) });
  }
  async function save(input, init, url) {
    const signal = init?.signal ?? input?.signal;
    const req = typeof init?.body === "string" ? JSON.parse(init.body) : await new Request(input, init).json();
    const originalBase = req.baseRevisionId;
    if (typeof req.doc === 'string') req.doc = JSON.parse(req.doc);
    const assets = Object.create(null);
    function collect(value, depth) {
      if (depth > 40) throw Error('Document nesting exceeds limit');
      if (typeof value === 'string' && value.startsWith('asset:')) {
        const key = value.slice(6);
        assets[key] = req.assets?.[key];
      } else if (value && typeof value === 'object') {
        for (const child of Object.values(value)) collect(child, depth + 1);
      }
    }
    collect(req.doc, 0);
    req.assets = assets;
    if (!chunked) return origFetch(url, {method: 'POST', headers: {'Content-Type':'application/json',[capHeader]:capToken}, body:JSON.stringify(req),signal:signal});
    if (previous) {
      let response = await send('status/' + previous.id, 'GET');
      if (response.ok) {
        let receipt = await response.json();
        if (receipt.state === 'active' || receipt.state === 'committing') {
          response = await send('upload/' + previous.id, 'DELETE');
          if (!response.ok) return response;
          receipt = await response.json();
        }
        if (receipt.state === 'partial' || receipt.state === 'uncertain') {
          response = await send('repair/' + previous.id, 'POST', {writePermit:req.writePermit});
          if (!response.ok) return response;
          receipt = await response.json();
        }
        if (receipt.revisionId && req.baseRevisionId === previous.base) recovered = {base: previous.base, revision:receipt.revisionId};
      } else if (response.status !== 404) return response;
    }
    if (recovered && recovered.base === req.baseRevisionId) req.baseRevisionId = recovered.revision;
    const bytes = new TextEncoder().encode(JSON.stringify(req));
    if (bytes.length > 64 * 1024 * 1024) return Response.json({ok:false,error:'body_too_large'}, {status:413});
    let response = await send('init','POST',{size:bytes.length},false,signal);
    if (!response.ok) return response;
    const {uploadId} = await response.json();
    previous = {id:uploadId,base:originalBase};
    for (let offset=0; offset<bytes.length; offset+=4*1024*1024) {
      response = await send('chunk?uploadId='+uploadId+'&offset='+offset,'PUT',bytes.subarray(offset,offset+4*1024*1024),true,signal);
      if (!response.ok) return response;
    }
    return send('commit','POST',{uploadId},false,signal);
  }
  window.fetch = function(input, init) {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    if (method === 'POST' && url.protocol + '//' + url.host === allowedOrigin && url.pathname === savePath.replace(/save$/, 'selection')) {
      const value = JSON.parse(init.body);
      selectionSummary = value?.count > 0 ? value : null;
      return origFetch(url,{method,headers:{"Content-Type":"application/json",[capHeader]:capToken},body:init.body});
    }
    if (method === 'POST' && url.protocol + '//' + url.host === allowedOrigin && url.pathname === savePath)
      return save(input, init, url);
    return origFetch(input, init);
  };
})();`, string(tokenJSON), string(originJSON), string(pathJSON), string(headerJSON), surface.chunked)
}

func (h *DesignProtocolHost) BindSurfaceLifecycle(win *mygo.Window, surface *DesignSurface) {
	page := win.Page()
	if page == nil || surface == nil {
		return
	}
	surface.BindOwnerPage(page)
	page.OnWillNavigate(func(e *mygo.NavigateEvent) {
		if err := validateProtocolNavigation(e.URL, h.platform, "molly-design", surface.Host); err != nil {
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
		h.releaseUploads(surface)
		delete(h.surfaces, host)
	}
	h.mu.Unlock()
}

func (h *DesignProtocolHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	resource := protocolOrigin(h.platform, "molly-resource", "file")
	w.Header().Set("Content-Security-Policy", strings.NewReplacer("img-src data: blob:", "img-src data: blob: "+resource, "connect-src 'self' data:", "connect-src 'self' data: "+resource).Replace(bentoStrictCSP))

	host := r.URL.Host
	if h.platform == "windows" && r.URL.Scheme == "http" && strings.HasSuffix(host, ".molly-design.localhost") {
		host = strings.TrimSuffix(host, ".molly-design.localhost")
	} else if !strings.EqualFold(r.URL.Scheme, "molly-design") {
		http.Error(w, "forbidden scheme", http.StatusForbidden)
		return
	}

	h.mu.RLock()
	surface := h.surfaces[host]
	requireOwner := h.requireOwnerPage
	h.mu.RUnlock()
	if surface == nil || surface.IsRevoked() {
		writeJSONError(w, http.StatusForbidden, "surface_revoked")
		return
	}

	surface.mu.RLock()
	ownerPage := surface.ownerPage

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
		surface.mu.RLock()
		payload := surface.payload
		surface.mu.RUnlock()
		_, _ = w.Write(payload)
		return

	case r.Method == "POST" && r.URL.Path == "/ws/"+surface.ArtworkID+"/selection":
		body, err := security.ValidateProtocolWriteRequest(r, security.ProtocolWriteGateConfig{CapabilityToken: surface.CapabilityToken, AllowedOrigin: surface.Origin, AllowOpaqueCustomSchemeOrigin: callerVerified, MaxBodyBytes: 1 << 20})
		if err != nil || surface.IsRevoked() || !surface.Editable {
			writeJSONError(w, 403, "selection_denied")
			return
		}
		var summary map[string]any
		if json.Unmarshal(body, &summary) != nil || summary == nil {
			writeJSONError(w, 400, "invalid_selection")
			return
		}
		surface.mu.RLock()
		notify := surface.onSelection
		surface.mu.RUnlock()
		if notify != nil {
			notify(summary)
		}
		w.WriteHeader(204)
		return
	case strings.HasPrefix(r.URL.Path, "/ws/"+surface.ArtworkID+"/save/"):
		h.serveUpload(w, r, surface, callerVerified)
		return
	case r.Method == http.MethodPost && r.URL.Path == "/ws/"+surface.ArtworkID+"/save":
		if !surface.Editable {
			writeJSONError(w, http.StatusForbidden, "surface_readonly")
			return
		}
		limit := int64(security.MaxDesignWriteBodyBytes)
		if h.spool != nil {
			limit = security.MaxWriteBodyBytes
		}
		body, err := security.ValidateProtocolWriteRequest(r, security.ProtocolWriteGateConfig{
			CapabilityToken:               surface.CapabilityToken,
			AllowedOrigin:                 surface.Origin,
			AllowOpaqueCustomSchemeOrigin: callerVerified,
			RequireBaseRev:                true,
			MaxBodyBytes:                  limit,
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
		req.BeforeSend = func() error {
			if surface.IsRevoked() {
				return errors.New("surface_revoked")
			}
			if h.gate != nil && !h.gate.IsWriteAllowed(surface.ArtworkID, req.WritePermit) {
				return ErrCanvasReadOnly
			}
			return nil
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
