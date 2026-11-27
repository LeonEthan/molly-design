package shell

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestCanonicalEndpoints(t *testing.T) {
	for _, v := range []struct {
		path, scope string
		port        int
	}{{"/molly-stage3a/vector #1", "d77a13c037b91153", 41888}, {`C:\molly-stage3a\vector #1`, "45bd25dfa25526a2", 43903}} {
		s, p := canonicalEndpoints(v.path)
		if s != v.scope || p != v.port {
			t.Fatalf("%s: %s %d", v.path, s, p)
		}
	}
	home, _ := os.UserHomeDir()
	for _, name := range []string{".molly", ".lody", ".molly-preview"} {
		s, _, err := dataDirectoryScope(filepath.Join(home, name))
		if err != nil || s != "" {
			t.Fatalf("%s: %q %v", name, s, err)
		}
	}
}

func TestIsolatedDirectoryOwnership(t *testing.T) {
	base, err := os.MkdirTemp("", "iso")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(base)
	dir := filepath.Join(base, "data")
	if err := ValidateIsolatedShellPaths(dir); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(filepath.Join(dir, experimentalMarker))
	if err != nil || runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("marker: %v %v", info, err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Symlink(base, filepath.Join(dir, "unknown")); err != nil {
			t.Fatal(err)
		}
		if err := ValidateIsolatedShellPaths(dir); err == nil {
			t.Fatal("accepted top-level link")
		}
	}
	occupied := filepath.Join(base, "occupied")
	if err := os.Mkdir(occupied, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(occupied, "existing"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := ValidateIsolatedShellPaths(occupied); err == nil || err.Error() != "refusing_non_experimental_data_dir" {
		t.Fatal(err)
	}
	t.Setenv("MOLLY_ELECTRON_USER_DATA_DIR", filepath.Join(base, "protected"))
	for _, p := range []string{base, filepath.Join(base, "protected"), filepath.Join(base, "protected", "child")} {
		if err := ValidateIsolatedShellPaths(p); err == nil {
			t.Fatal(p)
		}
	}
}

type deadlineRecorder struct {
	net.Conn
	deadline time.Time
}

func (c *deadlineRecorder) SetDeadline(t time.Time) error { c.deadline = t; return nil }

func (c *deadlineRecorder) Read(b []byte) (int, error) { return len(b), nil }

func (c *deadlineRecorder) Write(b []byte) (int, error) { return len(b), nil }

func TestControlIdleDeadlines(t *testing.T) {
	cases := map[string]int{"machine/acp-capabilities-refresh": 1610000, "machine/acp-authenticate": 300000, "machine/acp-binary-install": 300000, "session/file-send-local": 120000, "ping": 10000, "local-project/list-files": 120000, "local-project/list-skills": 120000, "local-project/list-global-skills": 120000, "worktree/list-files": 120000, "local-project/sync-history": 120000, "local-project/import-history": 120000, "local-project/resolve-history-conflict": 120000, "local-project/read-file": 20000}
	for typ, ms := range cases {
		path := "/session-control"
		if strings.HasPrefix(typ, "local-project/") || strings.HasPrefix(typ, "worktree/") {
			path = "/project-control"
		}
		if got := controlIdleTimeout(path, []byte(fmt.Sprintf(`{"type":%q}`, typ))); got != time.Duration(ms)*time.Millisecond {
			t.Fatalf("%s: %s", typ, got)
		}
	}
	client := new(MollyBridge).idleIPCClient("", time.Second)
	tr := client.Transport.(*http.Transport)
	if client.Timeout != 0 || tr.ResponseHeaderTimeout != 0 || !tr.DisableKeepAlives {
		t.Fatal("transport does not enforce idle deadlines")
	}
	now := time.Unix(1000, 0)
	raw := &deadlineRecorder{}
	c := activityDeadlineConn{Conn: raw, idle: time.Minute, now: func() time.Time { return now }}
	for _, op := range []func([]byte) (int, error){c.Write, c.Read} {
		now = now.Add(time.Second)
		op([]byte{1})
		if !raw.deadline.Equal(now.Add(time.Minute)) {
			t.Fatal(raw.deadline)
		}
		now = now.Add(time.Second)
		op(nil)
		if raw.deadline.Equal(now.Add(time.Minute)) {
			t.Fatal("zero-byte renewal")
		}
	}
}

type observedParent struct {
	strings.Builder
	synced bool
}

func (w *observedParent) Sync() error { w.synced = true; return nil }

type heldIdentity struct{ released bool }

func (h *heldIdentity) Close() error { h.released = true; return nil }

func TestPostLockOwnership(t *testing.T) {
	for _, tc := range []string{"legacy appears", "second identity fails", "both held"} {
		t.Run(tc, func(t *testing.T) {
			root, err := os.OpenRoot(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			o := &ownership{root: root}
			defer o.close()
			if err := root.WriteFile("credentials.json", []byte(`{"version":3,"token":"","user":{"id":"u","email":"e"},"machine":{"machineName":"m","machineId":"legacy-id"}}`), 0600); err != nil {
				t.Fatal(err)
			}
			lock := new(observedParent)
			held := map[string]*heldIdentity{}
			err = finishParentOwnership(o, lock, "instance", func() error {
				if !lock.synced || lock.String() != fmt.Sprintf("%d\ninstance\n", os.Getpid()) {
					t.Fatal("recheck before durable publication")
				}
				if tc == "legacy appears" {
					return os.ErrExist
				}
				return nil
			}, func(target identityTarget) (io.Closer, error) {
				if tc == "legacy appears" {
					t.Fatal("published despite conflicting owner")
				}
				if target.name == "machine-id" {
					if target.valid([]byte("old")) || !target.valid([]byte("legacy-id")) || string(target.value) != "legacy-id" {
						t.Fatal("migration lost")
					}
					if tc == "second identity fails" {
						return nil, os.ErrPermission
					}
				}
				h := new(heldIdentity)
				held[target.name] = h
				return h, nil
			})
			if (err == nil) != (tc == "both held") {
				t.Fatal(err)
			}
			if tc == "both held" && len(held) != 2 {
				t.Fatal(held)
			}
			for _, h := range held {
				if h.released {
					t.Fatal("released before shutdown")
				}
			}
			for _, close := range o.release {
				close()
			}
			o.release = nil
			for _, h := range held {
				if !h.released {
					t.Fatal("leaked identity")
				}
			}
		})
	}
}

func TestExperimentalGrantBoundToSnapshot(t *testing.T) {
	apiKey := "fixture"
	connection := map[string]any{"id": "c", "enabled": true, "revision": 1}
	v := harnessVault{Entries: []harnessEntry{{Connection: connection, APIKey: &apiKey}}}
	var req harnessRequest
	req.Snapshot.Connection = connection
	if got := v.modelReport(req, time.Unix(100, 0))["result"].(map[string]any); got["apiKey"] != apiKey {
		t.Fatal("matching snapshot denied")
	}
	req.Snapshot.Connection = map[string]any{"id": "c", "enabled": true, "revision": 2}
	if got := v.modelReport(req, time.Unix(100, 0))["result"].(map[string]any); got["ok"] != false || got["apiKey"] != nil {
		t.Fatal("stale revision received a grant")
	}
}

func TestRootPublicationRejectsRedirectedParent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks requires developer mode")
	}
	outer := t.TempDir()
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, dir := range []string{"secrets", "tmp", "design-thumbnails-v2"} {
		if err = root.Symlink(outer, dir); err != nil {
			t.Fatal(err)
		}
		if err = publishRootFile(root, filepath.Join(dir, "sentinel"), []byte("x"), true); err == nil {
			t.Fatal("escaped root", dir)
		}
	}
	entries, err := os.ReadDir(outer)
	if err != nil || len(entries) != 0 {
		t.Fatal(entries, err)
	}
}

func TestAtomicIdentityKeepsWinningHandle(t *testing.T) {
	for _, mode := range []string{"first", "collision", "repair", "reuse"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "id")
			if mode == "repair" || mode == "reuse" {
				initial := ""
				if mode == "reuse" {
					initial = "historical"
				}
				if err := os.WriteFile(target, []byte(initial), 0600); err != nil {
					t.Fatal(err)
				}
			}
			var moved *os.File
			f, err := publishHeldIdentity(identityTarget{name: "id", value: []byte("generated"), valid: func(b []byte) bool { return len(b) > 0 }}, identityFiles{
				open: func() (*os.File, error) { return os.Open(target) },
				temp: func() (*os.File, error) { return openTestIdentityTemp(dir) },
				move: func(f *os.File, replace bool) error {
					if replace != (mode == "repair") {
						t.Fatal("invalid replace flag")
					}
					if mode == "collision" {
						if err := os.WriteFile(target, []byte("winner"), 0600); err != nil {
							return err
						}
						return os.ErrExist
					}
					moved = f
					return moveTestIdentity(f, target, replace)
				}, retryAccess: func(error, int) bool { return false },
			})
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			if moved != nil && moved != f {
				t.Fatal("renamed handle was reopened")
			}
			info, err := f.Stat()
			if err != nil {
				t.Fatal(err)
			}
			targetInfo, err := os.Stat(target)
			if err != nil || !os.SameFile(info, targetInfo) {
				t.Fatal("wrong held identity", err)
			}
			b := make([]byte, info.Size())
			_, err = f.ReadAt(b, 0)
			if err != nil {
				t.Fatal(err)
			}
			want := map[string]string{"collision": "winner", "reuse": "historical", "first": "generated", "repair": "generated"}[mode]
			if string(b) != want {
				t.Fatalf("got %s, want %s", b, want)
			}
		})
	}
}
