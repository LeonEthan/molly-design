//go:build windows

package shell

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsLockedInstallerPreventsConcurrentModifyAndDelete(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "updater-cache")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "MollyDesign-0.3.0-x64-setup.exe")
	if err := os.WriteFile(target, []byte("synthetic-exe-payload"), 0o600); err != nil {
		t.Fatal(err)
	}

	locked, _, _, err := openLockedInstallerAndDir(target)
	if err != nil {
		t.Fatalf("openLockedInstallerAndDir failed: %v", err)
	}
	defer locked.Close()

	// Concurrent write and delete/rename must fail while the locked handles are held.
	if err := os.WriteFile(target, []byte("tampered"), 0o600); err == nil {
		t.Fatal("expected concurrent write to locked installer to fail")
	}
	if err := os.Rename(target, filepath.Join(dir, "renamed.exe")); err == nil {
		t.Fatal("expected concurrent rename of locked installer to fail")
	}
	if err := os.Rename(dir, dir+"-swapped"); err == nil {
		t.Fatal("expected concurrent rename of locked staging directory to fail")
	}
	// Read-only access (as used by CreateProcess) must remain allowed.
	if raw, err := os.ReadFile(locked.Path()); err != nil || string(raw) != "synthetic-exe-payload" {
		t.Fatalf("expected read-only access to locked installer, got %q (%v)", string(raw), err)
	}

	if err := locked.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	// Extended-length \\?\ drive paths must also validate and lock cleanly.
	extPath := `\\?\` + target
	extLocked, _, _, err := openLockedInstallerAndDir(extPath)
	if err != nil {
		t.Fatalf("openLockedInstallerAndDir(%q) failed: %v", extPath, err)
	}
	if err := extLocked.Close(); err != nil {
		t.Fatalf("Close extended failed: %v", err)
	}

	// After release, normal cleanup succeeds.
	if err := os.Remove(target); err != nil {
		t.Fatalf("expected remove after Close to succeed: %v", err)
	}
}
