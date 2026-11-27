//go:build !windows

package shell

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"image"
	"image/png"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPrivatePreviewHosts(t *testing.T) {
	dir := shortTempDir(t)
	path := filepath.Join(dir, "ctl")
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "workspace-catalog.json"), []byte(`{"identity":{"userId":"local:user"},"workspaces":[{"workspaceId":"lw_ws","state":"active"}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	self, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	defer self.Release()
	s := &CLISupervisor{process: self, coordinator: "synthetic", done: make(chan struct{})}
	s.owned.Store(true)
	id := uuid.NewString()
	stage := filepath.Join(dir, "design-preview-stage")
	output := filepath.Join(dir, "design-preview")
	for _, d := range []string{stage, output} {
		if err := os.Mkdir(d, 0700); err != nil {
			t.Fatal(err)
		}
	}
	work := renderWork{id, filepath.Join(stage, id+".json"), filepath.Join(output, "1-"+id[:8]+".png"), 1, 1}
	if err := os.WriteFile(work.PayloadPath, []byte(`{"doc":{"canvas":{"width":1,"height":1}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	reports := make(chan []renderReport, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/state" {
			io.WriteString(w, `{"machineId":"machine"}`)
			return
		}
		var q struct {
			Method string
			Params struct {
				Reports []renderReport
				Version int
			}
		}
		if json.NewDecoder(r.Body).Decode(&q) != nil {
			t.Error("invalid request")
			return
		}
		if q.Method == "design/source-path" && q.Params.Version == 2 {
			io.WriteString(w, `{"ok":true,"result":{"ok":true,"type":"design/source-path","artworkId":"art","path":"/work/design.yaml","live":{"sessionId":"source","sourceTurnId":"input","turnId":"active"}}}`)
			return
		}
		if r.Header.Get("X-Molly-Coordinator-Token") != "synthetic" || q.Method != "design/render-host" {
			t.Error("invalid render authentication")
			return
		}
		if len(q.Params.Reports) == 0 {
			_ = json.NewEncoder(w).Encode(settingsObject{"ok": true, "result": settingsObject{"type": "design/render-host", "requests": []renderWork{work}}})
			return
		}
		reports <- q.Params.Reports
		io.WriteString(w, `{"ok":true,"result":{"type":"design/render-host","requests":[]}}`)
	})}
	go srv.Serve(ln)
	defer srv.Close()
	worker := designWorkerFunc(func(_ context.Context, v any, checks ...func() error) (json.RawMessage, error) {
		q := v.(settingsObject)
		live, _ := q["live"].(settingsObject)
		if q["operation"] != "source-preview" || q["workdir"] != "/work" || live["sourceTurnId"] != "input" || len(checks) != 0 {
			return nil, errors.New("unexpected worker operation")
		}
		return json.RawMessage(`{"status":"ok","sourceIdentity":"identity","doc":{"canvas":{"width":1,"height":1}},"assets":{}}`), nil
	})
	b := NewMollyBridge(BridgeConfig{DataDir: dir, Supervisor: s, ControlSocketPath: path, ProbeSocketPath: path, DesignHost: NewDesignProtocolHostFromBytes(nil, nil, nil), DesignWorker: worker, appContext: t.Context()})
	b.cfg.CanvasGate.UpdateFromDaemon([]DesignCanvasState{{ArtworkID: "art", TurnID: "active"}}, nil)
	v, err := b.handleDesign(t.Context(), "refreshPreview", []json.RawMessage{json.RawMessage(`"art"`), json.RawMessage(`"host"`), json.RawMessage(`{"method":"design/source-path","params":{}}`)})
	if err != nil || v.(settingsObject)["status"] != "ready" || len(b.previews["host"].payload) == 0 {
		t.Fatal(v, err)
	}
	b.clearPreviews()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ticks := make(chan time.Time, 1)
	ticks <- time.Time{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		b.renderLoop(ctx, s, ticks, func(ctx context.Context, w renderWork) error {
			return b.renderStaged(ctx, w, func(_ context.Context, artwork string, payload json.RawMessage) ([]byte, error) {
				if artwork != id || !bytes.Contains(payload, []byte("canvas")) {
					return nil, os.ErrInvalid
				}
				var data bytes.Buffer
				err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 1, 1)))
				return data.Bytes(), err
			})

		})
	}()
	r := <-reports
	cancel()
	<-done
	if len(r) != 1 || r[0].RequestID != id || !r[0].OK {
		t.Fatal(r)
	}
	f, err := os.Open(work.OutputPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err = png.Decode(f); err != nil {
		t.Fatal(err)
	}
}
