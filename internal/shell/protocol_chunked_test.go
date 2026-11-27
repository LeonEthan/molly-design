package shell

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
)

type uploadFixture struct {
	t *testing.T
	h *DesignProtocolHost
	s *DesignSurface
}

func newUploadFixture(t *testing.T, save SaveDesignFunc, platform ...string) uploadFixture {
	t.Helper()
	gate := NewCanvasAccessGate()
	gate.UpdateFromDaemon(nil, nil)
	h := NewDesignProtocolHostFromBytes([]byte("editor"), gate, save)
	var err error
	h.spool, err = openDesignSpool(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h.SetRequireOwnerPageForTest(false)
	if len(platform) > 0 {
		h.platform = platform[0]
	}
	s := h.CreateSurface("7f45fd04-b210-4e31-9d5e-533d2bf1e938", nil, true)
	t.Cleanup(func() { h.RevokeSurface(s.Host); h.spool.Close() })
	return uploadFixture{t, h, s}
}

func (f uploadFixture) call(method, route string, body []byte) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, f.s.Origin+"/ws/"+f.s.ArtworkID+"/save/"+route, bytes.NewReader(body))
	r.Header.Set(security.CapabilityTokenHeader, f.s.CapabilityToken)
	r.Header.Set("Origin", f.s.Origin)
	typ := "application/json"
	if strings.HasPrefix(route, "chunk?") {
		typ = "application/octet-stream"
	}
	r.Header.Set("Content-Type", typ)
	w := httptest.NewRecorder()
	f.h.ServeHTTP(w, r)
	return w
}

func (f uploadFixture) expect(method, route string, body []byte, status int) map[string]any {
	f.t.Helper()
	w := f.call(method, route, body)
	if w.Code != status {
		f.t.Fatalf("%s: %d %s", route, w.Code, w.Body.String())
	}
	var data map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		f.t.Fatal(err)
	}
	return data
}

func (f uploadFixture) upload(content string) string {
	id := f.expect("POST", "init", fmt.Appendf(nil, `{"size":%d}`, len(content)), 200)["uploadId"].(string)
	f.expect("PUT", "chunk?uploadId="+id+"&offset=0", []byte(content), 200)
	return id
}

func TestChunkedInitExpiryAndReceipt(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		f := newUploadFixture(t, func(_ string, r DesignSaveRequest) (DesignSaveResult, error) {
			return DesignSaveResult{RevisionID: "B"}, r.BeforeSend()
		})
		for range 3 {
			f.expect("POST", "init", []byte(`{"size":67108864}`), 200)
		}
		id := f.upload(`{"baseRevisionId":"A","doc":{},"assets":{}}`)
		f.expect("POST", "commit", fmt.Appendf(nil, `{"uploadId":%q}`, id), 200)
		time.Sleep(2 * time.Minute)
		for range 3 {
			receipt := f.expect("GET", "status/"+id, nil, 200)
			if receipt["state"] != "done" || receipt["revisionId"] != "B" || receipt["projectionReady"] != true {
				t.Fatal(receipt)
			}
		}
		id = f.upload(`{"baseRevisionId":"B"}`)
		time.Sleep(16 * time.Second)
		synctest.Wait()
		f.expect("GET", "status/"+id, nil, 404)
		f.expect("POST", "init", []byte(`{"size":67108865}`), 413)
		if csp := f.call("GET", "status/"+id, nil).Header().Get("Content-Security-Policy"); !strings.Contains(csp, "connect-src 'self' data:") {
			t.Fatal(csp)
		}
	})
}

type permitCanvas struct {
	id    string
	flush func(string) error
}

func (c *permitCanvas) ArtworkID() string                                       { return c.id }
func (c *permitCanvas) SetReadonly(context.Context, uint64, bool, string) error { return nil }
func (c *permitCanvas) Flush(p string) error                                    { return c.flush(p) }

type freezeObserver struct {
	*permitCanvas
	frozen chan struct{}
}

func (c *freezeObserver) SetReadonly(_ context.Context, _ uint64, locked bool, reason string) error {
	if locked && reason == "processing" {
		select {
		case <-c.frozen:
		default:
			close(c.frozen)
		}
	}
	return nil
}

func TestChunkedRepairReplaysOriginalUnderFlushPermit(t *testing.T) {
	for _, platform := range []string{"darwin", "windows"} {
		for _, state := range []string{"partial", "uncertain"} {
			t.Run(platform+"/"+state, func(t *testing.T) {
				synctest.Test(t, func(t *testing.T) {
					var f uploadFixture
					var phase int
					frozen := make(chan struct{})
					finishFlush := make(chan struct{})
					flushDone := make(chan error, 1)
					var permit string
					f = newUploadFixture(t, func(_ string, r DesignSaveRequest) (DesignSaveResult, error) {
						if err := r.BeforeSend(); err != nil {
							return DesignSaveResult{}, err
						}
						phase++
						if phase == 1 {
							if state == "partial" {
								go func() { flushDone <- f.h.gate.Flush(f.s.ArtworkID) }()
								<-frozen
								return DesignSaveResult{}, &DesignWorkerError{"projection failure", "DESIGN_PROJECTION_PENDING", "B"}
							}
							ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
							defer cancel()
							<-ctx.Done()
							return DesignSaveResult{}, ctx.Err()
						}
						if phase == 2 && state == "uncertain" {
							if f.s.lastUnackedCommit == nil || f.s.lastUnackedCommit.State != "uncertain" {
								return DesignSaveResult{}, errors.New("missing uncertain receipt before retry")
							}
							return DesignSaveResult{}, &DesignWorkerError{Message: "DESIGN_BUSY"}
						}
						if r.WritePermit != permit || permit == "" {
							return DesignSaveResult{}, errors.New("missing repair permit")
						}
						if string(r.Doc) == `{"v":"B"}` && r.BaseRevisionID == "A" {
							return DesignSaveResult{RevisionID: "B"}, nil
						}
						if string(r.Doc) == `{"v":"C"}` && r.BaseRevisionID == "B" {
							return DesignSaveResult{RevisionID: "C"}, nil
						}
						return DesignSaveResult{}, errors.New("wrong replay")
					}, platform)
					id := f.upload(`{"baseRevisionId":"A","doc":{"v":"B"},"assets":{}}`)
					status := 503
					if state == "partial" {
						status = 500
						blocker := &permitCanvas{f.s.ArtworkID, func(string) error { <-finishFlush; return nil }}
						observer := &freezeObserver{permitCanvas: blocker, frozen: frozen}
						if err := f.h.gate.Register(observer); err != nil {
							t.Fatal(err)
						}
						defer f.h.gate.Unregister(observer)
					}
					f.expect("POST", "commit", fmt.Appendf(nil, `{"uploadId":%q}`, id), status)
					if receipt := f.expect("GET", "status/"+id, nil, 200); receipt["state"] != state || receipt["projectionReady"] != false {
						t.Fatal(receipt)
					}
					info, err := f.h.spool.Stat(f.s.lastUnackedCommit.path)
					if err != nil || runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
						t.Fatalf("spool %v %v", info, err)
					}
					if state == "partial" {
						close(finishFlush)
						if err := <-flushDone; err != nil {
							t.Fatal(err)
						}
					}
					c := &permitCanvas{f.s.ArtworkID, func(p string) error {
						permit = p
						f.expect("POST", "repair/"+id, fmt.Appendf(nil, `{"writePermit":%q}`, p), 200)
						cID := f.upload(fmt.Sprintf(`{"baseRevisionId":"B","doc":{"v":"C"},"assets":{},"writePermit":%q}`, p))
						saved := f.expect("POST", "commit", fmt.Appendf(nil, `{"uploadId":%q}`, cID), 200)
						if saved["revisionId"] != "C" {
							return errors.New("wrong revision")
						}
						return nil
					}}
					defer f.h.gate.Unregister(c)
					if err := f.h.gate.Register(c); err != nil {
						t.Fatal(err)
					}
					if err := f.h.gate.Flush(f.s.ArtworkID); err != nil {
						t.Fatal(err)
					}
				})
			})
		}
	}
}

func TestChunkedBentoFlushRealWorker(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("MOLLY_TEST_REAL_BENTO_WORKER") == "1" {
		matrix := filepath.Join(root, "packages", "design-authoring", "src", "generated", "capability-matrix-bytes.ts")
		if _, err := os.Stat(matrix); err != nil {
			t.Fatalf("run pnpm --dir apps/cli run prepare:design-authoring before testing the real worker: %v", err)
		}
	}
	cli := filepath.Join(root, "apps", "cli")
	loader := filepath.ToSlash(filepath.Join(cli, "node_modules", "tsx", "dist", "loader.mjs"))
	for _, dependency := range []string{loader, filepath.Join(root, "packages", "components", "node_modules", "jsdom", "package.json")} {
		if _, err := os.Stat(dependency); err != nil {
			if errors.Is(err, os.ErrNotExist) && os.Getenv("MOLLY_TEST_REAL_BENTO_WORKER") != "1" {
				t.Skipf("workspace dependencies missing: %v", err)
			}
			t.Fatal(err)
		}
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	loaderURL := url.URL{Scheme: "file", Path: "/" + strings.TrimPrefix(loader, "/")}
	t.Setenv("NODE_OPTIONS", "--import="+loaderURL.String())
	dataDir := t.TempDir()
	worker := NewDesignWorkerClientWithDataDir(node, filepath.Join(cli, "src", "design-entry.ts"), dataDir)
	worker.stderr = os.Stderr
	defer worker.Close()
	f := newUploadFixture(t, func(id string, r DesignSaveRequest) (DesignSaveResult, error) {
		raw, err := worker.Request(t.Context(), map[string]any{"operation": "save", "sessionId": id, "baseRevisionId": r.BaseRevisionID, "content": map[string]any{"doc": r.Doc, "assets": r.Assets}}, r.BeforeSend)
		if err != nil {
			return DesignSaveResult{}, err
		}
		var saved DesignSaveResult
		err = json.Unmarshal(raw, &saved)
		return saved, err
	})
	raw, err := worker.Request(t.Context(), map[string]any{"operation": "create", "association": map[string]string{"sessionId": f.s.ArtworkID, "name": "Synthetic", "machineId": "test", "userId": "local:test", "createdAt": "2026-09-09T00:00:00.000Z"}})
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "fixture.mjs")
	script := `
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { crc32,deflateSync } from 'node:zlib';
import { createInterface } from 'node:readline';
const [root,origin,id] = process.argv.slice(2);
const require=createRequire(join(root,'packages/components/package.json'));
const {JSDOM}=require('jsdom');
const {window}=new JSDOM('<body></body>',{url:origin+'/editor.html'});
for(const prop of ['window','document','location','MutationObserver','AbortController','HTMLElement','HTMLInputElement','HTMLTextAreaElement','CustomEvent','Event','Element','Node','HTMLCanvasElement'])globalThis[prop]=prop==='window'?window:window[prop];
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
document.fonts={ready:Promise.resolve()};
globalThis.CSS={escape:s=>s};
const NativeRequest=Request;
globalThis.Request=class extends NativeRequest{constructor(input,init){super(typeof input==='string'?new URL(input,location.href):input,init)}};
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
window.fetch=async(url,init)=>{
 if (!String(url).includes('/save/')) return Response.json({});
 const binary=init.body instanceof Uint8Array;
 process.stdout.write(JSON.stringify({route:String(url).split('/save/')[1],method:init.method,body:binary?Buffer.from(init.body).toString('base64'):init.body,binary})+'\n');
 const {status,data}=JSON.parse((await lines.next()).value);
 return Response.json(data,{status});
};
` + BuildCanvasPreloadScript(f.s) + `
globalThis.fetch=window.fetch;
const {createProductSession}=await import(pathToFileURL(join(root,'packages/design-bento/src/product-session.ts')));
const initial=` + string(raw) + `;
const doc=initial.doc;
const assets={};
const session=createProductSession({sessionId:id,revisionId:initial.revisionId,snapshot:()=>JSON.stringify(doc),assets:()=>assets,commitPending(){},setReadonly(){},setDirty(){},applyCommands(){},pickImageFile(){},elements:()=>[],select(){}});
window.molly.setReadonly(false);
function png(size,n){
 function chunk(type,data){
   const bytes=Buffer.alloc(data.length+12);
   bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);
   bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);
   return bytes;
 }
 const header=Buffer.from('00000001000000010802000000','hex');
 const start=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,n,0,0])))]);
 const end=chunk('IEND',Buffer.alloc(0));
 return Buffer.concat([start,chunk('moLY',Buffer.alloc(size-start.length-end.length-12,n)),end]);
}
for(let i=0;i<4;i++){
 const image=png(15*1024*1024,i);
 const key=createHash('sha256').update(image).digest('hex');
 assets[key]='data:image/png;base64,'+image.toString('base64');
 doc.elements=[{id:'photo',kind:'image',bounds:[0,0,50,50],zIndex:0,src:'asset:'+key}];
}
async function flush(ok){
 session.changed();
 const result=await window.molly.flush(process.argv[5]);
 if(result.ok!==ok)throw Error(JSON.stringify(result));
}
await flush(true);
doc.canvas.width+=1;
await flush(false);
for (const key of Object.keys(assets)) delete assets[key];
doc.elements=[];
for(let i=0;i<3;i++){
 const image=png(Math.floor(63.9*1024*1024/4),i);
 const key=createHash('sha256').update(image).digest('hex');
 assets[key]='data:image/png;base64,'+image.toString('base64');
 doc.elements.push({id:'photo'+i,kind:'image',bounds:[0,0,50,50],zIndex:i,src:'asset:'+key});
}
await flush(true);
doc.diagnostics=['x'.repeat(256*1024)];
await flush(false);
process.exit(0);
`
	if err = os.WriteFile(file, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	permit, _, _, release := f.h.gate.AcquireCloseFreeze(f.s.ArtworkID, "fixture")
	defer release()
	cmd := exec.CommandContext(t.Context(), node, file, root, f.s.Origin, f.s.ArtworkID, permit)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	dec := json.NewDecoder(out)
	enc := json.NewEncoder(in)
	saves := 0
	firstRevision := ""
	repaired := false
	for {
		var msg struct {
			Route, Method, Body string
			Binary              bool
		}
		err = dec.Decode(&msg)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body := []byte(msg.Body)
		if msg.Binary {
			body, err = base64.StdEncoding.DecodeString(msg.Body)
			if err != nil {
				t.Fatal(err)
			}
		}
		projection := filepath.Join(dataDir, "chats", f.s.ArtworkID, "design-current")
		if msg.Route == "commit" && saves == 1 && f.s.lastUnackedCommit.State == "done" && f.s.lastUnackedCommit.Revision == firstRevision {
			if err := os.Rename(projection, projection+".test-backup"); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(projection, []byte("block projection publication"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		reply := f.call(msg.Method, msg.Route, body)
		if msg.Route == "commit" && reply.Code == 500 {
			receipt := f.s.lastUnackedCommit
			if receipt == nil || receipt.State != "partial" || receipt.Revision == "" || receipt.Revision == firstRevision {
				t.Fatal("typed projection revision missing")
			}
			if err := os.Remove(projection); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(projection+".test-backup", projection); err != nil {
				t.Fatal(err)
			}
		}
		if strings.HasPrefix(msg.Route, "repair/") {
			if string(body) != fmt.Sprintf(`{"writePermit":%q}`, permit) || reply.Code != 200 {
				t.Fatalf("Bento repair failed %s %d", body, reply.Code)
			}
			repaired = true
		}
		if msg.Route == "commit" && reply.Code == 200 {
			saves++
			if saves == 1 {
				firstRevision = f.s.lastUnackedCommit.Revision
			}
			reopened, err := worker.Request(t.Context(), map[string]any{"operation": "read", "sessionId": f.s.ArtworkID, "readOnly": true})
			if err != nil {
				t.Fatal(err)
			}
			var saved struct {
				Assets     map[string]json.RawMessage
				RevisionID string
			}
			if err = json.Unmarshal(reopened, &saved); err != nil || len(saved.Assets) != 2*saves-1 || saved.RevisionID != f.s.lastUnackedCommit.Revision {
				t.Fatalf("reopen %d: %v", saves, err)
			}
			lower := 20 << 20
			if saves == 2 {
				lower = 66900000
			}
			if len(reopened) < lower || len(reopened) > lower+(1<<20) {
				t.Fatalf("unexpected reopened size %d", len(reopened))
			}
		}
		if err = enc.Encode(map[string]any{"status": reply.Code, "data": json.RawMessage(reply.Body.Bytes())}); err != nil {
			t.Fatal(err)
		}
	}
	if err = cmd.Wait(); err != nil {
		t.Fatalf("Bento fixture: %s %v", stderr.String(), err)
	}
	if saves != 2 || !repaired {
		t.Fatalf("reopened %d saves", saves)
	}
}

type delayedReceipt struct {
	*httptest.ResponseRecorder
	writing chan struct{}
	release chan struct{}
}

func (w delayedReceipt) Write(p []byte) (int, error) {
	close(w.writing)
	<-w.release
	return 0, io.ErrClosedPipe
}

func TestChunkedReceiptAvailableBeforeResponseDelivery(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		f := newUploadFixture(t, func(_ string, r DesignSaveRequest) (DesignSaveResult, error) {
			return DesignSaveResult{RevisionID: "saved"}, r.BeforeSend()
		})
		id := f.upload(`{"baseRevisionId":"base","doc":{},"assets":{}}`)
		r := httptest.NewRequest("POST", f.s.Origin+"/ws/"+f.s.ArtworkID+"/save/commit", strings.NewReader(fmt.Sprintf(`{"uploadId":%q}`, id)))
		r.Header.Set(security.CapabilityTokenHeader, f.s.CapabilityToken)
		r.Header.Set("Origin", f.s.Origin)
		r.Header.Set("Content-Type", "application/json")
		w := delayedReceipt{httptest.NewRecorder(), make(chan struct{}), make(chan struct{})}
		done := make(chan struct{})
		go func() { f.h.ServeHTTP(w, r); close(done) }()
		<-w.writing
		defer func() { close(w.release); <-done }()
		time.Sleep(90 * time.Second)
		for range 3 {
			got := f.expect("GET", "status/"+id, nil, 200)
			if got["revisionId"] != "saved" || got["state"] != "done" {
				t.Fatal(got)
			}
		}
	})
}

func TestChunkedAbortBeforeDispatchReleasesQuota(t *testing.T) {
	queued, resume := make(chan struct{}), make(chan struct{})
	f := newUploadFixture(t, func(_ string, r DesignSaveRequest) (DesignSaveResult, error) {
		close(queued)
		<-resume
		return DesignSaveResult{}, r.BeforeSend()
	})
	id := f.upload(`{"baseRevisionId":"old","doc":{},"assets":{}}`)
	other := newUploadFixture(t, nil)
	other.expect("POST", "init", []byte(`{"size":67108864}`), 200)
	third := newUploadFixture(t, nil)
	third.expect("POST", "init", []byte(`{"size":1}`), 429)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- f.call("POST", "commit", fmt.Appendf(nil, `{"uploadId":%q}`, id)) }()
	<-queued
	receipt := f.expect("DELETE", "upload/"+id, nil, 200)
	close(resume)
	if result := <-done; result.Code == 200 || receipt["state"] != "aborted" {
		t.Fatalf("unexpected abort %v %s", receipt, result.Body.String())
	}
	third.expect("POST", "init", []byte(`{"size":1}`), 200)
}

func TestCanvasOriginModes(t *testing.T) {
	for _, platform := range []string{"linux", "windows"} {
		f := newUploadFixture(t, func(string, DesignSaveRequest) (DesignSaveResult, error) {
			return DesignSaveResult{RevisionID: "saved"}, nil
		}, platform)
		if !strings.Contains(BuildCanvasPreloadScript(f.s), f.s.Origin) {
			t.Fatal("preload origin mismatch")
		}
		for _, origin := range []string{f.s.Origin, protocolOrigin(platform, "molly-design", "unrelated")} {
			r := httptest.NewRequest("POST", "molly-design://"+f.s.Host+"/ws/"+f.s.ArtworkID+"/save", strings.NewReader(`{"doc":{},"assets":{},"baseRevisionId":"a"}`))
			r.Header.Set("Origin", origin)
			r.Header.Set(security.CapabilityTokenHeader, f.s.CapabilityToken)
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			f.h.ServeHTTP(w, r)
			want := 403
			if origin == f.s.Origin {
				want = 200
			}
			if w.Code != want {
				t.Fatalf("%s %s got %d: %s", platform, origin, w.Code, w.Body.String())
			}
		}
	}
}
