package shell

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/LeonEthan/molly-design/internal/security"
)

const uploadLimit = 64 << 20
const chunkLimit = 4 << 20

var uploadBudget struct {
	sync.Mutex
	active   int
	reserved int64
}

type designUpload struct {
	ID            string `json:"uploadId"`
	Base          string `json:"baseRevisionId,omitempty"`
	State         string `json:"state"`
	Revision      string `json:"revisionId,omitempty"`
	Ready         bool   `json:"projectionReady"`
	Digest        string `json:"contentSha256,omitempty"`
	size, written int64
	path          string
	dispatched    bool
	running       chan struct{}
	timer         *time.Timer
	generation    int
}

func openDesignSpool(dir string) (*os.Root, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if err = root.Mkdir("tmp", 0700); err != nil && !errors.Is(err, fs.ErrExist) {
		return nil, err
	}
	info, err := root.Lstat("tmp")
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("invalid design spool directory")
	}
	tmp, err := root.OpenRoot("tmp")
	if err != nil {
		return nil, err
	}
	entries, err := fs.ReadDir(tmp.FS(), ".")
	for _, e := range entries {
		if e.Type().IsRegular() && strings.HasPrefix(e.Name(), "design-upload-") && strings.HasSuffix(e.Name(), ".tmp") {
			if err = tmp.Remove(e.Name()); err != nil {
				break
			}
		}
	}
	if err != nil {
		tmp.Close()
		return nil, err
	}
	return tmp, nil
}

func (h *DesignProtocolHost) discard(u *designUpload) {
	if u == nil {
		return
	}
	if u.timer != nil {
		u.timer.Stop()
	}
	if u.path != "" {
		if err := h.spool.Remove(u.path); err == nil || errors.Is(err, fs.ErrNotExist) {
			uploadBudget.reserved -= u.size
			u.path = ""
		}
	}
	if u.State == "active" || u.State == "committing" {
		uploadBudget.active--
	}
	u.State = "aborted"
}

func (h *DesignProtocolHost) releaseUploads(s *DesignSurface) {
	uploadBudget.Lock()
	defer uploadBudget.Unlock()
	if u := s.upload; u != nil && u.running == nil {
		h.discard(u)
		s.upload = nil
	}
	if u := s.lastUnackedCommit; u != nil && u.running == nil {
		h.discard(u)
		s.lastUnackedCommit = nil
	}
}

func (h *DesignProtocolHost) expire(s *DesignSurface, u *designUpload, generation int) {
	uploadBudget.Lock()
	defer uploadBudget.Unlock()
	if s.upload == u && u.State == "active" && u.generation == generation {
		h.discard(u)
		s.upload = nil
	}
}

func (h *DesignProtocolHost) touch(s *DesignSurface, u *designUpload) {
	if u.timer != nil {
		u.timer.Stop()
	}
	u.generation++
	generation := u.generation
	u.timer = time.AfterFunc(15*time.Second, func() { h.expire(s, u, generation) })
}

func replyUpload(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (h *DesignProtocolHost) serveUpload(w http.ResponseWriter, r *http.Request, s *DesignSurface, verified bool) {
	origin := r.Header.Get("Origin")
	referer := strings.ToLower(r.Header.Get("Referer"))
	site := strings.ToLower(r.Header.Get("Sec-Fetch-Site"))
	trusted := strings.EqualFold(origin, s.Origin) || verified && (origin == "" || origin == "null") && (referer == "" || referer == strings.ToLower(s.Origin) || strings.HasPrefix(referer, strings.ToLower(s.Origin)+"/"))
	if !s.Editable || !trusted || site != "" && site != "same-origin" && site != "none" || subtle.ConstantTimeCompare([]byte(s.CapabilityToken), []byte(r.Header.Get(security.CapabilityTokenHeader))) != 1 {
		writeJSONError(w, 403, "forbidden")
		return
	}
	if h.spool == nil {
		writeJSONError(w, 503, "spool_unavailable")
		return
	}
	route, id, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/ws/"+s.ArtworkID+"/save/"), "/")
	method := map[string]string{"init": "POST", "chunk": "POST", "commit": "POST", "repair": "POST", "status": "GET", "upload": "DELETE"}[route]
	idRoute := route == "repair" || route == "upload" || route == "status"
	if (idRoute && (len(id) != 32 || strings.Contains(id, "/"))) || (!idRoute && r.URL.Path != "/ws/"+s.ArtworkID+"/save/"+route) {
		writeJSONError(w, 404, "unknown_route")
		return
	}
	if method == "" || r.Method != method && !(route == "chunk" && r.Method == "PUT") {
		writeJSONError(w, 405, "method_not_allowed")
		return
	}
	var meta uploadMetadata
	var body []byte
	if method == "POST" {
		limit := int64(4096)
		media := "application/json"
		if route == "chunk" {
			limit = chunkLimit
			media = "application/octet-stream"
		}
		typ, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || typ != media {
			writeJSONError(w, 415, "invalid_content_type")
			return
		}
		body, err = io.ReadAll(io.LimitReader(r.Body, limit+1))
		if err != nil {
			writeJSONError(w, 400, "read_failed")
			return
		}
		if int64(len(body)) > limit {
			writeJSONError(w, 413, "body_too_large")
			return
		}
		if route != "chunk" && json.Unmarshal(body, &meta) != nil {
			writeJSONError(w, 400, "invalid_json")
			return
		}
	}
	status, value := h.processUpload(r, s, route, id, meta, body)
	replyUpload(w, status, value)
}

type uploadMetadata struct {
	Size   int64  `json:"size"`
	ID     string `json:"uploadId"`
	Permit string `json:"writePermit"`
}

func uploadError(status int, code string) (int, any) {
	return status, map[string]any{"ok": false, "code": code, "error": code}
}

func (h *DesignProtocolHost) processUpload(r *http.Request, s *DesignSurface, route, id string, meta uploadMetadata, body []byte) (int, any) {
	uploadBudget.Lock()
	defer uploadBudget.Unlock()
	if s.IsRevoked() {
		return uploadError(403, "surface_revoked")
	}
	if route == "init" {
		return h.startUpload(s, meta.Size)
	}
	if route == "chunk" {
		id = r.URL.Query().Get("uploadId")
	} else if route == "commit" {
		id = meta.ID
	}
	u := s.upload
	if u == nil || u.ID != id {
		u = s.lastUnackedCommit
	}
	if u == nil || u.ID != id {
		return uploadError(404, "unknown_upload")
	}
	switch route {
	case "status":
		return 200, *u
	case "chunk":
		return h.appendUpload(r, s, u, body)
	case "upload":
		if !u.dispatched && s.upload == u {
			h.discard(u)
			s.upload = nil
		} else if ch := u.running; ch != nil {
			uploadBudget.Unlock()
			<-ch
			uploadBudget.Lock()
		}
		return 200, *u
	}
	if route == "repair" && u.running != nil {
		ch := u.running
		uploadBudget.Unlock()
		select {
		case <-ch:
		case <-r.Context().Done():
		}
		uploadBudget.Lock()
		if s.IsRevoked() || r.Context().Err() != nil {
			return uploadError(403, "request_expired")
		}
	}
	if u.State == "done" {
		return 200, map[string]any{"ok": true, "revisionId": u.Revision}
	}
	repair := route == "repair"
	if u.running != nil || repair && (u.State != "partial" && u.State != "uncertain") || !repair && (u.State != "active" || u.written != u.size) {
		return uploadError(423, "upload_not_ready")
	}
	u.running = make(chan struct{})
	defer func() {
		close(u.running)
		u.running = nil
		if s.IsRevoked() && u.path != "" {
			h.discard(u)
		}
	}()
	if !repair {
		u.State = "committing"
		u.timer.Stop()
	}
	uploadBudget.Unlock()
	result, err := h.saveUpload(s, u, repair, meta.Permit)
	uploadBudget.Lock()
	if err == nil {
		return 200, map[string]any{"ok": true, "revisionId": result.RevisionID}
	}
	code := err.Error()
	var worker *DesignWorkerError
	if errors.As(err, &worker) && worker.Code != "" {
		code = worker.Code
	}
	switch {
	case code == "DESIGN_CONFLICT":
		return uploadError(409, code)
	case u.State == "partial":
		return uploadError(500, "projection_pending")
	case u.State == "uncertain":
		return uploadError(503, "save_outcome_uncertain")
	case errors.Is(err, ErrCanvasReadOnly):
		return uploadError(423, "canvas_readonly")
	default:
		return uploadError(400, code)
	}
}

func (h *DesignProtocolHost) saveUpload(s *DesignSurface, u *designUpload, repair bool, permit string) (result DesignSaveResult, err error) {
	uploadBudget.Lock()
	path := u.path
	uploadBudget.Unlock()
	data, err := h.spool.ReadFile(path)
	var req DesignSaveRequest
	if err == nil && (!utf8.Valid(data) || json.Unmarshal(data, &req) != nil || strings.TrimSpace(req.BaseRevisionID) == "") {
		err = errors.New("invalid_save")
	}
	var digest string
	if err == nil {
		sum := sha256.Sum256(data)
		digest = hex.EncodeToString(sum[:])
		if repair && digest != u.Digest {
			err = errors.New("repair_spool_changed")
		}
	}
	if repair {
		req.WritePermit = permit
	}
	req.BeforeSend = func() error {
		uploadBudget.Lock()
		defer uploadBudget.Unlock()
		if s.IsRevoked() || u.State == "aborted" {
			return errors.New("upload_aborted")
		}
		if h.gate != nil && !h.gate.IsWriteAllowed(s.ArtworkID, req.WritePermit) {
			return ErrCanvasReadOnly
		}
		u.dispatched = true
		return nil
	}
	attempt := func() error {
		action := func() error {
			if h.saveFn == nil {
				return errors.New("design_worker_unavailable")
			}
			var e error
			result, e = h.saveFn(s.ArtworkID, req)
			if e == nil && result.RevisionID == "" {
				return errors.New("missing_saved_revision")
			}
			return e
		}
		if h.gate != nil {
			return h.gate.Write(s.ArtworkID, req.WritePermit, action)
		}
		return action()
	}
	if err == nil {
		err = attempt()
	}
	uploadBudget.Lock()
	if !repair && u.State != "aborted" {
		u.Digest = digest
		u.Base = req.BaseRevisionID
		if err != nil && u.dispatched {
			var worker *DesignWorkerError
			switch {
			case errors.As(err, &worker) && worker.Code == "DESIGN_PROJECTION_PENDING":
				u.State = "partial"
				u.Revision = worker.RevisionID
			case !errors.As(err, &worker) || worker.Code == "DESIGN_BUSY" || worker.Message == "DESIGN_BUSY":
				u.State = "uncertain"
			}
			if u.State == "partial" || u.State == "uncertain" {
				s.lastUnackedCommit = u
				s.upload = nil
				uploadBudget.active--
				uploadBudget.Unlock()
				err = attempt()
				uploadBudget.Lock()
			}
		}
	}
	defer uploadBudget.Unlock()
	if err == nil {
		if len(result.Payload) > 0 {
			s.UpdatePayload(result.Payload)
		}
		h.discard(u)
		u.State = "done"
		u.Revision = result.RevisionID
		u.Ready = true
		s.lastUnackedCommit = u
	} else if u.State == "committing" {
		h.discard(u)
	}
	if s.upload == u {
		s.upload = nil
	}
	return
}

func (h *DesignProtocolHost) startUpload(s *DesignSurface, size int64) (int, any) {
	if size <= 0 || size > uploadLimit {
		return uploadError(413, "invalid_upload_size")
	}
	if old := s.upload; old != nil {
		if old.State != "active" {
			return uploadError(423, "commit_in_progress")
		}
		h.discard(old)
		s.upload = nil
	}
	if last := s.lastUnackedCommit; last != nil && last.State != "done" {
		return uploadError(423, "repair_required")
	}
	if uploadBudget.active >= 2 || uploadBudget.reserved+size > 256<<20 {
		return uploadError(429, "upload_budget_exceeded")
	}
	u := &designUpload{ID: randomHexToken(16), State: "active", size: size}
	u.path = "design-upload-" + u.ID + ".tmp"
	f, err := h.spool.OpenFile(u.path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return uploadError(500, "spool_failed")
	}
	if err = f.Close(); err != nil {
		_ = h.spool.Remove(u.path)
		return uploadError(500, "spool_failed")
	}
	s.upload = u
	uploadBudget.active++
	uploadBudget.reserved += u.size
	h.touch(s, u)
	return 200, *u
}
func (h *DesignProtocolHost) appendUpload(r *http.Request, s *DesignSurface, u *designUpload, body []byte) (int, any) {
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if err != nil || u.State != "active" || offset != u.written || len(body) == 0 || u.written+int64(len(body)) > u.size {
		return uploadError(400, "invalid_chunk")
	}
	f, err := h.spool.OpenFile(u.path, os.O_WRONLY|os.O_APPEND, 0)
	if err == nil {
		_, err = f.Write(body)
		err = errors.Join(err, f.Close())
	}
	if err != nil {
		h.discard(u)
		s.upload = nil
		return uploadError(500, "spool_failed")
	}
	u.written += int64(len(body))
	h.touch(s, u)
	return 200, map[string]bool{"ok": true}
}
