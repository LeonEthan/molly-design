package security

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveAllowedFilePathAndSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	workdir := filepath.Join(root, "session")
	previewDir := filepath.Join(root, "preview")
	outsideDir := filepath.Join(root, "outside")
	for _, d := range []string{workdir, previewDir, outsideDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", d, err)
		}
	}

	insideFile := filepath.Join(workdir, "art.png")
	outsideFile := filepath.Join(outsideDir, "secret.png")
	if err := os.WriteFile(insideFile, []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outsideFile, []byte("nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	escapeLink := filepath.Join(workdir, "escape.png")
	if err := os.Symlink(outsideFile, escapeLink); err != nil {
		t.Fatal(err)
	}
	symlinkPreview := filepath.Join(root, "preview-link")
	if err := os.Symlink(outsideDir, symlinkPreview); err != nil {
		t.Fatal(err)
	}

	roots := []PathRoot{
		{Dir: workdir},
		{Dir: previewDir, RejectSymlinkRoot: true},
	}

	resolved, err := ResolveAllowedFilePath("art.png", workdir, roots, false)
	if err != nil {
		t.Fatalf("ResolveAllowedFilePath inside file failed: %v", err)
	}
	expected, _ := filepath.EvalSymlinks(insideFile)
	if resolved != expected {
		t.Fatalf("resolved = %q, want %q", resolved, expected)
	}

	if _, err := ResolveAllowedFilePath(escapeLink, workdir, roots, false); err == nil {
		t.Fatal("expected symlink escape to be rejected")
	}

	if _, err := ResolveAllowedFilePath("art.png", workdir, roots, true); err == nil {
		t.Fatal("expected relative path to fail when requireAbs is true")
	}

	symlinkRoots := []PathRoot{
		{Dir: symlinkPreview, RejectSymlinkRoot: true},
	}
	if _, err := ResolveAllowedFilePath(outsideFile, workdir, symlinkRoots, true); err == nil {
		t.Fatal("expected symlink preview root to be rejected")
	}
}

func TestReadBoundedRegularFile(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "sample.bin")
	payload := []byte("0123456789")
	if err := os.WriteFile(file, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.bin")
	if err := os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}

	got, err := ReadBoundedRegularFile(file, 16)
	if err != nil {
		t.Fatalf("ReadBoundedRegularFile failed: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("got %q, want %q", got, payload)
	}

	if _, err := ReadBoundedRegularFile(file, 5); err == nil {
		t.Fatal("expected oversized file to be rejected")
	}

	if _, err := ReadBoundedRegularFile(link, 16); err == nil {
		t.Fatal("expected symlink read to be rejected")
	}
}
