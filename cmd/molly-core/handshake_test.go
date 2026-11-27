package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/LeonEthan/molly-design/internal/ipc"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type supervisorInput struct {
	ready chan struct{}
	eof   chan struct{}
}

func (s supervisorInput) Read(p []byte) (int, error) { close(s.ready); <-s.eof; return 0, io.EOF }

func markedRoot(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "sandbox")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".molly-mygo-experimental"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestHandshakeServer(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix socket")
	}
	root := markedRoot(t)
	token := strings.Repeat("a1", 32)
	t.Setenv("MOLLY_CORE_IPC_TOKEN", "")
	frame, err := json.Marshal(map[string]string{"authToken": token, "allowedDataRoot": root})
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp("/tmp", "mc-hs-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "c")
	input := supervisorInput{make(chan struct{}), make(chan struct{})}
	done := make(chan int, 1)
	var stderr bytes.Buffer
	go func() {
		done <- runWithInput([]string{"--serve-ipc", socket, "--stdin-handshake"}, io.MultiReader(bytes.NewReader(append(frame, '\n')), input), io.Discard, &stderr)
	}()
	select {
	case <-input.ready:
	case code := <-done:
		t.Fatalf("startup %d: %s", code, &stderr)
	}
	defer func() {
		close(input.eof)
		if code := <-done; code != 0 {
			t.Fatalf("exit %d: %s", code, &stderr)
		}
	}()
	ctx := context.Background()
	client, err := ipc.DialWithAuth(ctx, socket, token)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	other := markedRoot(t)
	for _, method := range []string{"design.read", "gitstore.list", "gitstore.read"} {
		err := client.Call(ctx, method, map[string]string{"dataRoot": other}, nil)
		if err == nil || !strings.Contains(err.Error(), "unauthorized") {
			t.Fatalf("%s: %v", method, err)
		}
	}
	var result json.RawMessage
	if err := client.Call(ctx, "memory.read", map[string]string{"dbPath": filepath.Join(root, "memory", "preferences.sqlite")}, &result); err != nil {
		t.Fatal(err)
	}
}

func TestInvalidHandshakeFailsClosed(t *testing.T) {
	token := strings.Repeat("b", 64)
	missing := t.TempDir()
	for _, frame := range []string{
		`{"authToken":"` + token + `","allowedDataRoot":"` + filepath.ToSlash(missing) + `"}` + "\n",
		`{"authToken":"` + token + `"}`, `{"authToken":"bad"}` + "\n", strings.Repeat(" ", 65536) + "\n"} {
		var stderr bytes.Buffer
		code := runWithInput([]string{"--serve-ipc", "unused", "--stdin-handshake"}, strings.NewReader(frame), io.Discard, &stderr)
		if code != 1 || !strings.Contains(stderr.String(), "handshake") || strings.Contains(stderr.String(), token) {
			t.Fatal("expected handshake rejection with redacted error")
		}
	}
}

func TestBoundMemoryPaths(t *testing.T) {
	root := markedRoot(t)
	bound, err := bindDataRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	db := func(base string) string { return filepath.Join(base, "memory", "preferences.sqlite") }
	for _, path := range []string{db(markedRoot(t)), filepath.Join(root, "preferences.sqlite"), filepath.Join(root, "memory", "other.sqlite")} {
		if _, err := bound.databasePath(path); err == nil {
			t.Fatalf("accepted %s", path)
		}
	}
	if runtime.GOOS == "windows" {
		t.Skip("symlink privileges")
	}
	link := func(target, path string) {
		t.Helper()
		if err := os.Symlink(target, path); err != nil {
			t.Fatal(err)
		}
	}
	alias := filepath.Join(t.TempDir(), "alias")
	link(root, alias)
	if _, err := bindDataRoot(alias); err == nil {
		t.Fatal("accepted symlink root")
	}
	memory := filepath.Dir(db(root))
	link(t.TempDir(), memory)
	if _, err := bound.databasePath(db(root)); err == nil {
		t.Fatal("accepted symlink memory dir")
	}
	if err := os.Remove(memory); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(memory, 0700); err != nil {
		t.Fatal(err)
	}
	link(filepath.Join(t.TempDir(), "missing"), db(root))
	if _, err := bound.databasePath(db(root)); err == nil {
		t.Fatal("accepted symlink database")
	}
	marker := filepath.Join(root, ".molly-mygo-experimental")
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	link(filepath.Join(markedRoot(t), ".molly-mygo-experimental"), marker)
	if _, err := bindDataRoot(root); err == nil {
		t.Fatal("accepted symlink marker")
	}
}

func TestReplacedRootIdentity(t *testing.T) {
	root := markedRoot(t)
	bound, err := bindDataRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(root, root+"-original"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	for _, requested := range []string{root, root + "-original"} {
		if _, err := bound.authorize(requested); err == nil {
			t.Fatalf("accepted replaced root via %s", requested)
		}
	}
}

func TestMemoryOpenRejectsLinkedSQLiteFiles(t *testing.T) {
	for _, kind := range []string{"hardlink", "symlink"} {
		for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
			t.Run(kind+"/database"+suffix, func(t *testing.T) {
				root := markedRoot(t)
				bound, err := bindDataRoot(root)
				if err != nil {
					t.Fatal(err)
				}
				dir := filepath.Join(root, "memory")
				if err := os.Mkdir(dir, 0700); err != nil {
					t.Fatal(err)
				}
				db := filepath.Join(dir, "preferences.sqlite")
				outside := filepath.Join(t.TempDir(), "production")
				want := []byte("external database bytes")
				if err := os.WriteFile(outside, want, 0600); err != nil {
					t.Fatal(err)
				}
				link := os.Link
				if kind == "symlink" {
					link = os.Symlink
				}
				if err := link(outside, db+suffix); err != nil {
					if kind == "symlink" && runtime.GOOS == "windows" {
						t.Skip(err)
					}
					t.Fatal(err)
				}
				registry := newMemoryRegistry()
				registry.root = bound
				defer registry.closeAll()
				if _, err := registry.get(db); err == nil || !strings.Contains(err.Error(), "invalid memory database") {
					t.Fatalf("expected isolation error, got %v", err)
				}
				got, err := os.ReadFile(outside)
				if err != nil || !bytes.Equal(got, want) {
					t.Fatalf("external file changed: %q, %v", got, err)
				}
			})
		}
	}
}
