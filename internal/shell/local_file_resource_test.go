package shell

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func previewRoot(t *testing.T) *os.Root {
	t.Helper()
	r, e := os.OpenRoot(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { r.Close() })
	return r
}
func TestLocalResourceBoundaries(t *testing.T) {
	s := NewLocalFileResourceStore()
	root := previewRoot(t)
	for _, tc := range []struct {
		size   int
		only   bool
		status string
	}{{LocalTextEditBytes, false, "ok"}, {3, true, "resource"}, {LocalTextEditBytes + 1, false, "resource"}} {
		data := bytes.Repeat([]byte("a"), tc.size)
		if e := root.WriteFile("text", data, 0600); e != nil {
			t.Fatal(e)
		}
		v, e := s.Issue(0, root, "text", "notes/text", true, tc.only)
		if e != nil || v["status"] != tc.status {
			t.Fatal(v["status"], e)
		}
		if tc.status == "ok" {
			if v["content"].(map[string]any)["text"] != string(data) || v["readonly"] != true {
				t.Fatal("invalid inline response")
			}
			continue
		}
		q := httptest.NewRequest("GET", v["url"].(string), nil)
		q.Header.Set("Range", "bytes=0-65535")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, q)
		if w.Code != 206 || !bytes.Equal(w.Body.Bytes(), data[:min(tc.size, 65536)]) {
			t.Fatal(w.Code, w.Body.Len())
		}
		q.Header.Set("Range", "bytes=-1")
		w = httptest.NewRecorder()
		s.ServeHTTP(w, q)
		if w.Code != 416 {
			t.Fatal(w.Code)
		}
	}
	if _, e := s.Issue(0, root, "../escape", "", false, false); e == nil {
		t.Fatal("accepted traversal")
	}
}

type pausedPreviewWriter struct {
	*httptest.ResponseRecorder
	started, resume chan struct{}
}

func (w pausedPreviewWriter) Write(p []byte) (int, error) {
	if w.Body.Len() == 0 {
		close(w.started)
		<-w.resume
	}
	return w.ResponseRecorder.Write(p)
}
func TestActivePreviewInvalidation(t *testing.T) {
	for _, op := range []string{"navigation", "eviction", "modification"} {
		t.Run(op, func(t *testing.T) {
			s := NewLocalFileResourceStore()
			s.limit = 1
			root := previewRoot(t)
			if e := root.WriteFile("large", make([]byte, 2*LocalTextPageBytes), 0600); e != nil {
				t.Fatal(e)
			}
			v, e := s.Issue(0, root, "large", "large", false, true)
			if e != nil {
				t.Fatal(e)
			}
			u := v["url"].(string)
			w := pausedPreviewWriter{httptest.NewRecorder(), make(chan struct{}), make(chan struct{})}
			done := make(chan any, 1)
			go func() { defer func() { done <- recover() }(); s.ServeHTTP(w, httptest.NewRequest("GET", u, nil)) }()
			<-w.started
			r := s.items[strings.TrimPrefix(u, protocolOrigin(s.platform, "molly-resource", "file")+"/")]
			var f *os.File
			for active := range r.readers {
				f = active
			}
			switch op {
			case "navigation":
				s.AdvanceGen()
			case "eviction":
				if e := root.WriteFile("second", []byte("x"), 0600); e != nil {
					t.Fatal(e)
				}
				_, e = s.Issue(0, root, "second", "second", false, true)
			case "modification":
				e = root.WriteFile("large", make([]byte, 3*LocalTextPageBytes), 0600)
			}
			if e != nil {
				t.Fatal(e)
			}
			if op != "modification" {
				if _, e = f.Stat(); e == nil || !r.revoked {
					t.Fatal("reader still live")
				}
			}
			close(w.resume)
			if err := <-done; err != http.ErrAbortHandler || w.Body.Len() != LocalTextPageBytes {
				t.Fatal(fmt.Sprint(err), w.Body.Len())
			}
		})
	}
}

func TestLocalPreviewOwnerBoundary(t *testing.T) {
	root := previewRoot(t)
	s := NewLocalFileResourceStore()
	if e := root.WriteFile("safe", []byte("safe"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := root.Symlink("safe", "alias"); e == nil {
		if _, e = s.Issue(0, root, "alias", "safe", false, true); e == nil {
			t.Fatal("accepted file symlink")
		}
	}
	result, e := s.Issue(0, root, "safe", "safe", false, true)
	if e != nil {
		t.Fatal(e)
	}
	s.RevokeAll()
	if _, e = s.Issue(0, root, "safe", "safe", false, true); e == nil {
		t.Fatal("stale generation issued token")
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", result["url"].(string), nil))
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}

func TestMappedAttachmentOrigins(t *testing.T) {
	for _, platform := range []string{"linux", "windows"} {
		s := NewLocalFileResourceStore()
		s.platform = platform
		defer s.Close()
		root := previewRoot(t)
		if e := root.WriteFile("data", []byte("abc"), 0600); e != nil {
			t.Fatal(e)
		}
		v, e := s.Issue(0, root, "data", "data", false, true)
		if e != nil {
			t.Fatal(e)
		}
		origin := protocolOrigin(platform, "molly-resource", "file")
		if !strings.HasPrefix(v["url"].(string), origin+"/") {
			t.Fatal(v)
		}
		for _, trusted := range []bool{false, true} {
			r := httptest.NewRequest("GET", v["url"].(string), nil)
			r.Header.Set("Origin", "http://other.invalid")
			want := 403
			if trusted {
				r.Header.Set("Origin", protocolOrigin(platform, "mygo", "localhost"))
				r.Header.Set("Range", "bytes=0-2")
				want = 206
			}
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != want {
				t.Fatal(platform, w.Code)
			}
		}
	}
}

func TestWorkbenchResourceCSP(t *testing.T) {
	root := previewRoot(t)
	if err := root.WriteFile("index.html", []byte(`<meta http-equiv="Content-Security-Policy" content="img-src 'self' molly-resource: data:; connect-src 'self' molly-resource: data:">`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, platform := range []string{"linux", "windows"} {
		f := rendererFiles{root.FS(), platform}
		r := httptest.NewRecorder()
		http.FileServerFS(f).ServeHTTP(r, httptest.NewRequest("GET", "http://localhost/", nil))
		want := " molly-resource: "
		if platform == "windows" {
			want = " http://file.molly-resource.localhost "
		}
		if r.Code != 200 || strings.Count(r.Body.String(), want) != 2 {
			t.Fatal(platform, r.Code, r.Body.String())
		}
	}
}
