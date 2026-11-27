//go:build darwin

package shell

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/egoist/mygo"
)

func TestG5NativeSchemeBodyLimits(t *testing.T) {
	if !nativeTestProcess(t) {
		return
	}
	if err := configureDesktopSchemeLimits(); err != nil {
		t.Fatal(err)
	}
	entered := make(chan string, 7)
	release := make(chan struct{})
	refill := make(chan struct{})
	var rejectedEntered atomic.Bool
	designHost := NewDesignProtocolHostFromBytes([]byte("<title>fixture</title>"), NewCanvasAccessGate(), nil)
	err := mygo.Protocol.HandleFunc("molly-design", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, "<title>G5</title>")
		case "/reject":
			rejectedEntered.Store(true)
			designHost.ServeHTTP(w, r)
		case "/refill":
			entered <- r.URL.Path
			<-refill
			w.WriteHeader(204)
		case "/hold", "/error", "/cancel":
			entered <- r.URL.Path
			if r.URL.Path == "/cancel" {
				<-r.Context().Done()
				return
			}
			<-release
			if r.URL.Path == "/error" {
				http.Error(w, "fixture error", 500)
				return
			}
			w.WriteHeader(204)
		default:
			w.WriteHeader(204)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	win := mygo.NewWindow(mygo.WindowOptions{})
	loaded := make(chan struct{}, 1)
	win.Page().OnDidFinishLoad(func() {
		select {
		case loaded <- struct{}{}:
		default:
		}
	})
	if err := win.Page().LoadURL("molly-design://fixture/"); err != nil {
		t.Fatal(err)
	}
	<-loaded
	eval := func(script string) any {
		t.Helper()
		v, e := win.Page().EvalContext(t.Context(), script)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	eval("window.postBody=(path,n,signal)=>fetch(path,{method:'POST',body:new Uint8Array(n),signal}).then(r=>r.status);window.pending=[];window.abortG5=new AbortController();return true")
	if status := eval("postBody('/reject',(5<<20)+1)"); status != float64(413) {
		t.Fatalf("single request: %v", status)
	}
	hold := func(path string, size int, signal string) {
		t.Helper()
		eval(fmt.Sprintf("pending.push(postBody(%q,%d,%s).catch(()=>0));return true", path, size, signal))
		if got := <-entered; got != path {
			t.Fatalf("handler %s, want %s", got, path)
		}
	}
	hold("/cancel", 5<<20, "abortG5.signal")
	hold("/error", 5<<20, "undefined")
	for range 4 {
		hold("/hold", 5<<20, "undefined")
	}
	hold("/hold", 2<<20, "undefined")

	if status := eval("postBody('/reject',1)"); status != float64(503) {
		t.Fatalf("aggregate request: %v", status)
	}
	eval("abortG5.abort();return true")
	close(release)
	statuses := eval("Promise.all(pending).then(a=>a.join(','))")
	if statuses != "0,500,204,204,204,204,204" {
		t.Fatalf("held requests: %v", statuses)
	}
	eval("window.pending=[];return true")
	for range 6 {
		hold("/refill", 5<<20, "undefined")
	}
	hold("/refill", 2<<20, "undefined")
	close(refill)
	if statuses := eval("Promise.all(pending).then(a=>a.join(','))"); statuses != "204,204,204,204,204,204,204" || rejectedEntered.Load() {
		t.Fatalf("recovery %v, rejected handler entered %t", statuses, rejectedEntered.Load())
	}
	t.Log("WKWebView observed 413 at 5 MiB + 1 and 503 at 32 MiB + 1 before design dispatch, then reused the full 32 MiB after completion, error and cancellation")
}
