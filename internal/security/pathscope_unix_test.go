//go:build unix

package security

import (
	"path/filepath"
	"syscall"
	"testing"
)

func TestReadAllowedFileBoundedRejectsFIFOWithoutBlocking(t *testing.T) {
	dir := t.TempDir()
	fifoPath := filepath.Join(dir, "blocked.fifo")
	if err := syscall.Mkfifo(fifoPath, 0o600); err != nil {
		t.Fatalf("mkfifo failed: %v", err)
	}
	roots := []PathRoot{{Dir: dir}}
	if _, _, err := ReadAllowedFileBounded("blocked.fifo", dir, roots, false, 1024); err == nil {
		t.Fatal("expected FIFO read to be rejected immediately without blocking")
	}
}
