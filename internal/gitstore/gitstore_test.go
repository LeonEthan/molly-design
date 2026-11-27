package gitstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/LeonEthan/molly-design/internal/design"
)

func TestCreateListReadRestoreAndBeforeAgentIsolation(t *testing.T) {
	ctx := context.Background()
	dataRoot := t.TempDir()
	sessionID := "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

	created, err := design.CreateDesign(ctx, dataRoot, design.CreateRequest{
		Association: design.Association{
			SessionID: sessionID,
			Name:      "Brand Poster",
			UserID:    "u1",
			MachineID: "m1",
			CreatedAt: "2026-11-23T12:00:00.000Z",
		},
		Width:  800,
		Height: 600,
	}, design.LockTiming{})
	if err != nil {
		t.Fatalf("CreateDesign: %v", err)
	}

	gs := New()
	if versions, err := gs.List(ctx, dataRoot, sessionID); err != nil || len(versions) != 0 {
		t.Fatalf("expected empty history initially, got %v err=%v", versions, err)
	}
	if v, err := gs.RecordBeforeAgent(ctx, dataRoot, sessionID, created, design.LockTiming{}); err != nil || v != nil {
		t.Fatalf("expected blank canvas not to create before-agent entry, got %v err=%v", v, err)
	}

	doc1 := json.RawMessage(`{"schemaVersion":4,"canvas":{"width":800,"height":600},"diagnostics":[],"background":{"type":"solid","color":"#ffffff"},"elements":[{"id":"el-1","kind":"shape","bounds":[10,10,100,50],"zIndex":0}]}`)
	rev1, err := design.SaveDesign(ctx, dataRoot, design.SaveRequest{
		SessionID:      sessionID,
		BaseRevisionID: created.RevisionID,
		Content:        design.Content{Doc: doc1, Assets: map[string]string{}},
	}, design.LockTiming{})
	if err != nil {
		t.Fatalf("SaveDesign rev1: %v", err)
	}

	v1, err := gs.CreateVersion(ctx, dataRoot, sessionID, rev1.RevisionID, design.LockTiming{})
	if err != nil {
		t.Fatalf("CreateVersion v1: %v", err)
	}
	if v1.Number != 1 || v1.Kind != KindSaved {
		t.Fatalf("unexpected v1: %+v", v1)
	}

	afterV1, err := design.ReadDesign(dataRoot, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if afterV1.Editing == nil || afterV1.Editing.BaseVersionID != v1.CommitID {
		t.Fatalf("expected editing.baseVersionId=%s, got %+v", v1.CommitID, afterV1.Editing)
	}

	doc2 := json.RawMessage(`{"schemaVersion":4,"canvas":{"width":800,"height":600},"background":{"type":"solid","color":"#111111"},"diagnostics":[],"elements":[{"id":"el-1","kind":"shape","bounds":[10,10,200,80],"zIndex":0}]}`)
	rev2, err := design.SaveDesign(ctx, dataRoot, design.SaveRequest{
		SessionID:      sessionID,
		BaseRevisionID: afterV1.RevisionID,
		Content:        design.Content{Doc: doc2, Assets: map[string]string{}},
	}, design.LockTiming{})
	if err != nil {
		t.Fatalf("SaveDesign rev2: %v", err)
	}

	if _, err := gs.RestoreVersion(ctx, dataRoot, sessionID, v1.CommitID, created.RevisionID, design.LockTiming{}); !errors.Is(err, design.ErrDesignConflict) {
		t.Fatalf("expected ErrDesignConflict on stale restore baseline, got %v", err)
	}

	restored, err := gs.RestoreVersion(ctx, dataRoot, sessionID, v1.CommitID, rev2.RevisionID, design.LockTiming{})
	if err != nil {
		t.Fatalf("RestoreVersion: %v", err)
	}
	if string(restored.Doc) != string(doc1) {
		t.Fatalf("restored doc mismatch: %s", string(restored.Doc))
	}

	versions, err := gs.List(ctx, dataRoot, sessionID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(versions) != 2 || versions[0].Kind != KindSaved || versions[1].Kind != KindBeforeRestore {
		t.Fatalf("expected [saved, before-restore], got %+v", versions)
	}

	ba, err := gs.RecordBeforeAgent(ctx, dataRoot, sessionID, restored, design.LockTiming{})
	if err != nil || ba != nil {
		t.Fatalf("expected duplicate content not to append before-agent, got %v err=%v", ba, err)
	}

	for _, badID := range []string{"../escape", "../../etc", "not-a-uuid", ""} {
		if _, err := gs.List(ctx, dataRoot, badID); err == nil {
			t.Errorf("expected List(%q) to fail UUID validation", badID)
		}
		if _, err := gs.CreateVersion(ctx, dataRoot, badID, strings.Repeat("a", 64), design.LockTiming{}); err == nil {
			t.Errorf("expected CreateVersion(%q) to fail UUID validation", badID)
		}
	}

	if runtime.GOOS != "windows" {
		symRoot := t.TempDir()
		realChats := filepath.Join(t.TempDir(), "real-chats")
		if err := os.MkdirAll(filepath.Join(realChats, sessionID), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(realChats, filepath.Join(symRoot, design.ChatsDirName)); err != nil {
			t.Fatal(err)
		}
		if _, err := design.ReadDesign(symRoot, sessionID); err == nil {
			t.Fatal("expected design.ReadDesign to reject symlinked chats directory")
		}
		if _, err := gs.Read(ctx, symRoot, sessionID, v1.CommitID); err == nil {
			t.Fatal("expected gitstore.Read to reject symlinked chats directory")
		}
	}

	repoDir := gs.RepoPath(dataRoot, sessionID)
	commondirPath := filepath.Join(repoDir, "commondir")
	if err := os.WriteFile(commondirPath, []byte("../other.git\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := gs.List(ctx, dataRoot, sessionID); err == nil {
		t.Fatal("expected gitstore.List to reject bare repo containing commondir")
	}
	if _, err := gs.Read(ctx, dataRoot, sessionID, v1.CommitID); err == nil {
		t.Fatal("expected gitstore.Read to reject bare repo containing commondir")
	}
	if err := os.Remove(commondirPath); err != nil {
		t.Fatal(err)
	}

	altPath := filepath.Join(repoDir, "objects", "info", "Alternates")
	if err := os.MkdirAll(filepath.Dir(altPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(altPath, []byte("/tmp/other/objects\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := gs.List(ctx, dataRoot, sessionID); err == nil {
		t.Fatal("expected gitstore.List to reject bare repo containing objects/info/Alternates")
	}
	if _, err := gs.Read(ctx, dataRoot, sessionID, v1.CommitID); err == nil {
		t.Fatal("expected gitstore.Read to reject bare repo containing objects/info/Alternates")
	}
	if err := os.Remove(altPath); err != nil {
		t.Fatal(err)
	}

	httpAltPath := filepath.Join(repoDir, "objects", "info", "http-alternates")
	if err := os.WriteFile(httpAltPath, []byte("https://example.com/objects\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := gs.List(ctx, dataRoot, sessionID); err == nil {
		t.Fatal("expected gitstore.List to reject bare repo containing objects/info/http-alternates")
	}
	if err := os.Remove(httpAltPath); err != nil {
		t.Fatal(err)
	}

	if runtime.GOOS != "windows" {
		packPath := filepath.Join(repoDir, "objects", "pack")
		_ = os.RemoveAll(packPath)
		extPack := filepath.Join(t.TempDir(), "ext-pack")
		if err := os.MkdirAll(extPack, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(extPack, packPath); err != nil {
			t.Fatal(err)
		}
		if _, err := gs.List(ctx, dataRoot, sessionID); err == nil {
			t.Fatal("expected gitstore.List to reject bare repo with symlinked objects/pack")
		}
		if _, err := gs.Read(ctx, dataRoot, sessionID, v1.CommitID); err == nil {
			t.Fatal("expected gitstore.Read to reject bare repo with symlinked objects/pack")
		}
	}
}

func BenchmarkSystemGitPlumbingAppend(b *testing.B) {
	ctx := context.Background()
	dataRoot := b.TempDir()
	sessionID := "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
	created, err := design.CreateDesign(ctx, dataRoot, design.CreateRequest{
		Association: design.Association{
			SessionID: sessionID,
			Name:      "Bench",
			UserID:    "u1",
			MachineID: "m1",
			CreatedAt: "2026-11-23T12:00:00.000Z",
		},
		Width:  800,
		Height: 600,
	}, design.LockTiming{})
	if err != nil {
		b.Fatal(err)
	}
	gs := New()
	rev := created.RevisionID
	pad := strings.Repeat("x", 32*1024)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		doc := json.RawMessage(fmt.Sprintf(`{"schemaVersion":4,"canvas":{"width":800,"height":600},"background":{"type":"solid","color":"#ffffff"},"diagnostics":[],"elements":[{"id":"el-%d","kind":"text","bounds":[0,0,100,40],"zIndex":0,"text":"%s-%d"}]}`, i, pad, i))
		saved, saveErr := design.SaveDesign(ctx, dataRoot, design.SaveRequest{
			SessionID:      sessionID,
			BaseRevisionID: rev,
			Content:        design.Content{Doc: doc, Assets: map[string]string{}},
		}, design.LockTiming{})
		if saveErr != nil {
			b.Fatal(saveErr)
		}
		if _, verErr := gs.CreateVersion(ctx, dataRoot, sessionID, saved.RevisionID, design.LockTiming{}); verErr != nil {
			b.Fatal(verErr)
		}
		latest, _ := design.ReadDesign(dataRoot, sessionID)
		rev = latest.RevisionID
	}
}
