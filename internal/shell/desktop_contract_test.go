package shell

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

type contractCanvas struct {
	id    string
	apply func(bool, string) error
	flush func(string) error
	state func() (*canvasEditorState, error)
}

func (c *contractCanvas) ArtworkID() string { return c.id }

func (c *contractCanvas) SetReadonly(_ context.Context, _ uint64, ro bool, why string) error {
	if c.apply != nil {
		return c.apply(ro, why)
	}
	return nil
}

func (c *contractCanvas) Flush(p string) error {
	if c.flush != nil {
		return c.flush(p)
	}
	return nil
}

func (c *contractCanvas) EditorState() (*canvasEditorState, error) { return c.state() }

func TestPermitsAcrossPreparingAndExecuting(t *testing.T) {
	g := NewCanvasAccessGate()
	g.UpdateFromDaemon(nil, nil)
	p, _, _, _ := g.AcquireCloseFreeze("art", "window")
	q, _, _, _ := g.AcquireCloseFreeze("art", "quit")
	g.ReleaseCloseFreezeByOwner("window")
	if g.IsWriteAllowed("art", p) || !g.IsWriteAllowed("art", q) || g.IsWriteAllowed("art", "") {
		t.Fatal("independent close ownership lost")
	}
	var issued string
	i := &contractCanvas{id: "art", flush: func(permit string) error {
		issued = permit
		if !g.IsWriteAllowed("art", permit) || g.IsWriteAllowed("art", q) {
			return errors.New("incorrect preparing permissions")
		}
		g.UpdateFromDaemon([]DesignCanvasState{{ArtworkID: "art", TurnID: "turn", Preparing: false}}, nil)
		if g.IsWriteAllowed("art", permit) || g.IsWriteAllowed("art", q) {
			return errors.New("executing turn admitted a write")
		}
		return nil
	}}
	g.Register(i)
	defer g.Unregister(i)
	reports := g.UpdateFromDaemon([]DesignCanvasState{{"art", "turn", true}}, nil)
	if len(reports) != 1 || !reports[0].OK || issued == "" {
		t.Fatal(reports)
	}
	g.UpdateFromDaemon(nil, nil)
	if !g.IsReadonly("art") {
		t.Fatal("quit freeze was lost")
	}
	g.ReleaseCloseFreezeByOwner("quit")
	if g.IsReadonly("art") || g.IsWriteAllowed("art", issued) {
		t.Fatal("unexpected idle permits")
	}
}

func TestPreparingResnapshotsAfterUnregister(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		g := NewCanvasAccessGate()
		g.UpdateFromDaemon(nil, nil)
		block := make(chan struct{})
		defer close(block)
		i := &contractCanvas{id: "B", apply: func(ro bool, _ string) error {
			if ro {
				<-block
			}
			return nil
		}, flush: func(string) error { return errors.New("retired instance flushed") }}
		g.Register(i)
		out := make(chan DesignCanvasReport, 1)
		g.UpdateFromDaemon([]DesignCanvasState{{"B", "turn", true}}, nil, func(r DesignCanvasReport) { out <- r })
		synctest.Wait()
		g.Unregister(i)
		if r := <-out; !r.OK {
			t.Fatal(r)
		}
	})
}

func TestIndependentPreparingAndNonblockingFreezeRelease(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		g := NewCanvasAccessGate()
		g.UpdateFromDaemon(nil, nil)
		blocked := make(chan struct{})
		var once sync.Once
		b := &contractCanvas{id: "B", apply: func(ro bool, _ string) error {
			if ro {
				<-blocked
				return context.DeadlineExceeded
			}
			return nil
		}}
		a := &contractCanvas{id: "A"}
		g.Register(a)
		g.Register(b)
		defer g.Unregister(a)
		defer g.Unregister(b)
		defer once.Do(func() { close(blocked) })
		_, _, _, release := g.AcquireCloseFreeze("B", "quit")
		synctest.Wait()
		out := make(chan DesignCanvasReport, 2)
		g.UpdateFromDaemon([]DesignCanvasState{{"B", "2", true}, {"A", "1", true}}, nil, func(r DesignCanvasReport) { out <- r })
		if r := <-out; r.ArtworkID != "A" || !r.OK {
			t.Fatal(r)
		}
		release()
		once.Do(func() { close(blocked) })
		if r := <-out; r.ArtworkID != "B" || r.OK {
			t.Fatal(r)
		}
	})
}

func TestPreparationDrainsAdmittedWrite(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		g := NewCanvasAccessGate()
		g.UpdateFromDaemon(nil, nil)
		done := make(chan struct{})
		entered := make(chan struct{})
		go func() { _ = g.Write("art", "", func() error { close(entered); <-done; return nil }) }()
		<-entered
		out := make(chan DesignCanvasReport, 1)
		g.UpdateFromDaemon([]DesignCanvasState{{"art", "turn", true}}, nil, func(r DesignCanvasReport) { out <- r })
		synctest.Wait()
		select {
		case r := <-out:
			t.Fatalf("reported during write: %v", r)
		default:
		}
		close(done)
		if r := <-out; !r.OK {
			t.Fatal(r)
		}
	})
}

func TestCloseDecisionAndCanceledQuit(t *testing.T) {
	for _, tc := range []struct {
		name             string
		state            *canvasEditorState
		err              error
		button           int
		allowed, discard bool
	}{{"timeout", nil, context.DeadlineExceeded, 0, false, false}, {"dirty readonly", &canvasEditorState{Dirty: true}, nil, 0, false, false}, {"discard", &canvasEditorState{Saving: true}, nil, 2, true, true}, {"clean readonly", &canvasEditorState{}, nil, -1, true, false}} {
		t.Run(tc.name, func(t *testing.T) {
			g := NewCanvasAccessGate()
			g.UpdateFromDaemon([]DesignCanvasState{{"art", "turn", false}}, nil)
			i := &contractCanvas{id: "art", state: func() (*canvasEditorState, error) { return tc.state, tc.err }, flush: func(string) error { t.Fatal("readonly flushed"); return nil }}
			g.Register(i)
			defer g.Unregister(i)
			choice := false
			ok, discard := confirmClose(g, i, "quit", func() (int, error) { choice = true; return tc.button, nil })
			if ok != tc.allowed || discard != tc.discard || choice != (tc.button >= 0) {
				t.Fatal(ok, discard, choice)
			}
			g.ReleaseCloseFreezeByOwner("quit")
		})
	}
	x := canvasExit{phase: quitConfirming, token: "quit"}
	if x.canceled() != "" || x.phase != quitConfirming {
		t.Fatal("self-veto canceled confirmation")
	}
	x.phase = quitApproved
	if x.canceled() != "quit" || x.phase != quitIdle {
		t.Fatal("external veto retained approval")
	}
}

func TestRecoveryWorkerFrames(t *testing.T) {
	node, e := exec.LookPath("node")
	if e != nil {
		t.Fatal(e)
	}
	script := filepath.Join(t.TempDir(), "worker.cjs")
	const fixture = `const rl=require("node:readline").createInterface({input:process.stdin});let acknowledged=false;
 rl.on("line",line=>{const q=JSON.parse(line);let value;
 if(q.operation==="pending-associations"&&q.readOnly===true)value=q.cursor?{items:[{sessionId:"art",association:{sessionId:"art"},revisionId:"old",projectionStale:true}],nextCursor:null}:{items:[],nextCursor:"next"};
 else if(q.operation==="repair-projection")value={revisionId:"new"};
 else if(q.operation==="acknowledge"&&q.sessionId==="art"&&q.verifyProjection===true&&!acknowledged){acknowledged=true;value=null}
 else if(q.operation==="read"&&q.readOnly)value={revisionId:"read-only"};
 else {console.log(JSON.stringify({ok:false,error:"invalid frame"}));return}
 console.log(JSON.stringify({ok:true,value}));});`
	if e = os.WriteFile(script, []byte(fixture), 0600); e != nil {
		t.Fatal(e)
	}
	w := NewDesignWorkerClient(node, script)
	defer w.Close()
	s := &CLISupervisor{done: make(chan struct{})}
	s.owned.Store(true)
	b := NewMollyBridge(BridgeConfig{DesignWorker: w, Supervisor: s})
	g := b.cfg.CanvasGate
	g.UpdateFromDaemon(nil, nil)
	items, e := b.designStore(t.Context(), "pending", nil)
	if e != nil {
		t.Fatal(e)
	}
	if got := items.([]settingsObject); len(got) != 1 || got[0]["revisionId"] != "new" {
		t.Fatal(items)
	}
	args := []json.RawMessage{json.RawMessage(`"art"`)}
	if _, e = b.designStore(t.Context(), "acknowledge", args); e != nil {
		t.Fatal(e)
	}
	g.UpdateFromDaemon([]DesignCanvasState{{"art", "turn", false}}, nil)
	if _, e = b.designStore(t.Context(), "acknowledge", args); !errors.Is(e, ErrCanvasReadOnly) {
		t.Fatal(e)
	}
	if _, e = b.designStore(t.Context(), "read", args); e != nil {
		t.Fatal(e)
	}
	items, e = b.designStore(t.Context(), "pending", nil)
	if e != nil || items.([]settingsObject)[0]["revisionId"] != "old" {
		t.Fatal(items, e)
	}
}

func TestDesktopIPCContractsWithoutNativeUI(t *testing.T) {
	b := NewMollyBridge(BridgeConfig{DataDir: t.TempDir()})
	for _, tc := range []struct {
		method string
		arg    json.RawMessage
		want   any
	}{{"app.getFullscreen", nil, false}, {"app.revealLocalPath", json.RawMessage(`"relative"`), settingsObject{"revealed": false, "error": "invalid_path"}}, {"image.copyToClipboard", json.RawMessage(`{"pngBytes":"YWJj"}`), settingsObject{"copied": false, "error": "unsupported_image"}}, {"image.saveAs", json.RawMessage(`{}`), settingsObject{"saved": false, "error": "invalid_bytes"}}, {"image.showPreviewMenu", json.RawMessage(`{}`), settingsObject{"action": nil}}, {"notifications.getPermissionStatus", nil, settingsObject{"supported": false, "permission": "default", "error": "permission_status_unavailable"}}} {
		t.Run(tc.method, func(t *testing.T) {
			var args []json.RawMessage
			if tc.arg != nil {
				args = []json.RawMessage{tc.arg}
			}
			got, e := b.Invoke(t.Context(), b.CurrentDocGeneration(), tc.method, args)
			if e != nil || !reflect.DeepEqual(got, tc.want) {
				t.Fatal(got, e)
			}
		})
	}
}

type testCanvasPage func(context.Context, string) (any, error)

func (p testCanvasPage) EvalContext(ctx context.Context, script string) (any, error) {
	return p(ctx, script)
}

func TestExecutingTurnSettlesCanvasNotes(t *testing.T) {
	g := NewCanvasAccessGate()
	g.UpdateFromDaemon([]DesignCanvasState{{"art", "turn", false}}, nil)
	c := newMygoDesignController(nil, g, nil)
	c.instances[canvasInstanceKey("art", "host")] = &mygoCanvasInstance{artworkID: "art", hostID: "host", surface: &DesignSurface{}, page: testCanvasPage(func(ctx context.Context, script string) (any, error) {
		if _, ok := ctx.Deadline(); !ok || script != `window.molly.settleNotes(...[17,true,"instance"])` {
			return nil, errors.New("invalid settlement invocation")
		}
		return true, nil
	})}
	b := NewMollyBridge(BridgeConfig{CanvasGate: g, DesignController: c})
	result, err := b.handleDesign(t.Context(), "settleNotes", []json.RawMessage{json.RawMessage(`"art"`), json.RawMessage(`"host"`), json.RawMessage(`17`), json.RawMessage(`true`), json.RawMessage(`"instance"`)})
	if err != nil || result != true {
		t.Fatal(result, err)
	}
}

func TestCanvasExchangeReportsHealthyArtworkBeforePageTimeout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s := &CLISupervisor{done: make(chan struct{})}
		s.owned.Store(true)
		b := NewMollyBridge(BridgeConfig{Supervisor: s})
		g := b.cfg.CanvasGate
		a := &contractCanvas{id: "A"}
		hung := &mygoCanvasInstance{artworkID: "B", page: testCanvasPage(func(ctx context.Context, _ string) (any, error) { <-ctx.Done(); return nil, ctx.Err() })}
		g.Register(a)
		g.Register(hung)
		defer g.Unregister(a)
		defer g.Unregister(hung)
		ticks := make(chan time.Time, 1)
		ticks <- time.Now()
		seen := make(chan DesignCanvasReport)
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		go b.canvasExchangeLoop(ctx, ticks, func(_ context.Context, _ *CLISupervisor, reports []DesignCanvasReport) ([]DesignCanvasState, error) {
			for _, r := range reports {
				seen <- r
			}
			return []DesignCanvasState{{"B", "turn-b", true}, {"A", "turn-a", true}}, nil
		})
		if r := <-seen; !r.OK || r.ArtworkID != "A" {
			t.Fatal(r)
		}
		if r := <-seen; r.OK || r.ArtworkID != "B" {
			t.Fatal(r)
		}
	})
}

func TestQuitCancellationPreservesResourcesUntilShutdown(t *testing.T) {
	g := NewCanvasAccessGate()
	g.UpdateFromDaemon(nil, nil)
	host := NewDesignProtocolHostFromBytes([]byte("canvas"), g, nil)
	surface := host.CreateSurface("art", nil, true)
	worker := NewDesignWorkerClient("", "")
	c := newMygoDesignController(host, g, worker)
	c.instances["canvas"] = &mygoCanvasInstance{artworkID: "art", surface: surface}
	resources := NewLocalFileResourceStore()
	b := NewMollyBridge(BridgeConfig{CanvasGate: g, DesignHost: host, DesignWorker: worker, DesignController: c, Resources: resources})
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	prevented := false
	owner := c.exit.beginQuit(false, func() { prevented = true })
	if !prevented || owner == "" || c.exit.canceled() != "" {
		t.Fatal("quit did not enter confirmation")
	}
	if another := c.exit.beginQuit(false, func() {}); another != "" {
		t.Fatal("re-entered quit")
	}
	c.finishQuit(owner, func(i *mygoCanvasInstance, token string) (bool, bool) {
		g.AcquireCloseFreeze(i.artworkID, token)
		return false, false
	}, func() { t.Fatal("quit after Keep Editing") })
	if surface.IsRevoked() || worker.stopping || ctx.Err() != nil || resources.closed || g.IsReadonly("art") || c.exit.phase != quitIdle || len(c.instances) != 1 {
		t.Fatal("cancellation tore down live resources")
	}
	b.shutdownDesktop(cancel)
	if !surface.IsRevoked() || !worker.stopping || ctx.Err() == nil || !resources.closed {
		t.Fatal("incomplete irreversible cleanup")
	}
}

type designWorkerFunc func(context.Context, any, ...func() error) (json.RawMessage, error)

func (f designWorkerFunc) Request(ctx context.Context, q any, before ...func() error) (json.RawMessage, error) {
	return f(ctx, q, before...)
}

func (designWorkerFunc) Close() error { return nil }

func TestDispatchedRenameFinishesBeforePreparingReport(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		g := NewCanvasAccessGate()
		g.UpdateFromDaemon(nil, nil)
		s := &CLISupervisor{done: make(chan struct{})}
		s.owned.Store(true)
		entered := make(chan struct{})
		commit := make(chan struct{})
		w := designWorkerFunc(func(_ context.Context, q any, before ...func() error) (json.RawMessage, error) {
			for _, check := range before {
				if e := check(); e != nil {
					return nil, e
				}
			}
			req := q.(settingsObject)
			switch req["operation"] {
			case "read":
				return json.RawMessage(`{"revisionId":"base","doc":{},"assets":{}}`), nil
			case "save":
				if req["name"] != "new" || req["baseRevisionId"] != "base" {
					return nil, os.ErrInvalid
				}
				close(entered)
				<-commit
				return json.RawMessage(`{"revisionId":"renamed"}`), nil
			}
			return nil, os.ErrInvalid
		})
		b := NewMollyBridge(BridgeConfig{CanvasGate: g, DesignWorker: w, Supervisor: s})
		renamed := make(chan error, 1)
		go func() {
			_, err := b.handleDesign(t.Context(), "rename", []json.RawMessage{json.RawMessage(`"art"`), json.RawMessage(`"new"`)})
			renamed <- err
		}()
		<-entered
		report := make(chan DesignCanvasReport, 1)
		g.UpdateFromDaemon([]DesignCanvasState{{"art", "turn", true}}, nil, func(r DesignCanvasReport) { report <- r })
		synctest.Wait()
		select {
		case r := <-report:
			t.Fatalf("prepared before durable rename: %v", r)
		default:
		}
		close(commit)
		if e := <-renamed; e != nil {
			t.Fatal(e)
		}
		if r := <-report; !r.OK {
			t.Fatal(r)
		}
	})
}

func TestCanvasCloseTimeoutUsesNativeChoice(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		g := NewCanvasAccessGate()
		g.UpdateFromDaemon(nil, nil)
		i := &mygoCanvasInstance{artworkID: "art", page: testCanvasPage(func(ctx context.Context, js string) (any, error) {
			if strings.Contains(js, "ApplyReadonly") {
				return true, nil
			}
			<-ctx.Done()
			return nil, ctx.Err()
		})}
		g.Register(i)
		defer g.Unregister(i)
		start := time.Now()
		allowed, discard := confirmClose(g, i, "close", func() (int, error) {
			if time.Since(start) != 3*time.Second {
				t.Fatal("unexpected editor deadline")
			}
			return 2, nil
		})
		if !allowed || !discard {
			t.Fatal("timed out state skipped dialog")
		}
		g.ReleaseCloseFreezeByOwner("close")
	})
}

func TestImageIPCUsesPickedPathAndPngClipboard(t *testing.T) {
	b := NewMollyBridge(BridgeConfig{DataDir: t.TempDir()})
	var encoded bytes.Buffer
	if e := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 2, 2))); e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "picked.png")
	req, _ := json.Marshal(settingsObject{"fileName": "../preview.png", "bytes": encoded.Bytes()})
	value, e := b.imageAction("saveAs", []json.RawMessage{req}, nil, func(opts mygo.SaveDialogOptions) (string, error) {
		if opts.DefaultPath != "preview.png" {
			return "", os.ErrInvalid
		}
		return path, nil
	})
	if e != nil || !reflect.DeepEqual(value, settingsObject{"saved": true, "path": path}) {
		t.Fatal(value, e)
	}
	persisted, e := os.ReadFile(path)
	if e != nil || !bytes.Equal(persisted, encoded.Bytes()) {
		t.Fatal("incorrect saved bytes", e)
	}
	info, e := os.Stat(path)
	if e != nil || runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatal(info, e)
	}
	req, _ = json.Marshal(settingsObject{"pngBytes": persisted})
	value, e = b.imageAction("copyToClipboard", []json.RawMessage{req}, func(data []byte) error {
		if !bytes.Equal(data, persisted) {
			return os.ErrInvalid
		}
		return nil
	}, nil)
	if e != nil || !reflect.DeepEqual(value, settingsObject{"copied": true}) {
		t.Fatal(value, e)
	}
}

type testPreviewWindow struct {
	*mygo.Window
	destroyed bool
}

func (w *testPreviewWindow) Destroy() { w.destroyed = true }

func TestCanvasExchangePublishesPreparationAndClosesCompletedPreviews(t *testing.T) {
	for _, transition := range []string{"idle", "next-preparing"} {
		t.Run(transition, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				s := &CLISupervisor{done: make(chan struct{})}
				s.owned.Store(true)
				events := make(chan settingsObject, 8)
				host := NewDesignProtocolHostFromBytes(nil, nil, nil)
				b := NewMollyBridge(BridgeConfig{Supervisor: s, DesignHost: host, OnEmitPush: func(channel string, payload any) {
					if channel == "design.state" {
						events <- payload.(settingsObject)
					}
				}})
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				active := []DesignCanvasState{{"art", "turn", true}, {"other", "other-turn", false}}
				ticks := make(chan time.Time)
				go b.canvasExchangeLoop(ctx, ticks, func(context.Context, *CLISupervisor, []DesignCanvasReport) ([]DesignCanvasState, error) {
					return active, nil
				})
				ticks <- time.Now()
				synctest.Wait()
				for len(events) > 0 {
					<-events
				}
				active[0].Preparing = false
				ticks <- time.Now()
				synctest.Wait()
				select {
				case event := <-events:
					if event["artworkId"] != "art" {
						t.Fatal(event)
					}
				default:
					t.Fatal("preparation ended without a state change")
				}
				watch, stop := context.WithCancel(ctx)
				defer stop()
				window := &testPreviewWindow{}
				surface := host.CreateSurface("art", nil, false)
				b.previews = map[string]*sourcePreview{
					"consumer": {id: "art", turn: "turn", cancel: stop, win: window, surface: surface},
					"other":    {id: "other", turn: "other-turn", cancel: func() { t.Error("discarded unrelated preview") }},
				}
				if transition == "idle" {
					active = active[1:]
				} else {
					active[0] = DesignCanvasState{"art", "next", true}
				}
				ticks <- time.Now()
				synctest.Wait()
				if !window.destroyed || !surface.IsRevoked() || b.previews["consumer"] != nil || watch.Err() == nil || b.previews["other"] == nil {
					t.Fatal("preview or poller survived turn completion, or another consumer was removed")
				}
			})
		})
	}
}
