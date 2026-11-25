package shell

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func openTestIdentityTemp(dir string) (*os.File, error) {
	return openWindows(filepath.Join(dir, "temp"), windows.GENERIC_READ|windows.GENERIC_WRITE|windows.DELETE, windows.FILE_SHARE_READ, windows.CREATE_NEW)
}

func moveTestIdentity(f *os.File, target string, replace bool) error {
	return renameWindowsHandle(f, target, replace)
}

func TestWindowsPublishedIdentityDeniesMutation(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "machine-id")
	held, err := holdWindowsIdentity(dir, identityTarget{"machine-id", []byte("machine"), func(b []byte) bool { return len(b) > 0 }})
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	if err = os.WriteFile(target, []byte("changed"), 0600); !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("write: %v", err)
	}
	if err = os.Remove(target); err == nil {
		t.Fatal("held identity removed")
	}
}
