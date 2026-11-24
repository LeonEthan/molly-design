package design

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func sampleDesignPNG(t *testing.T) (string, string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.SetRGBA(x, y, color.RGBA{R: 40, G: 120, B: 220, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	return DigestHex(b), "data:image/png;base64," + base64.StdEncoding.EncodeToString(b)
}

func TestDesignLockTimeoutStaleStealAndAssertHeld(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	now := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	timing := LockTiming{
		Now: func() time.Time { return now },
		Sleep: func(_ context.Context, d time.Duration) error {
			now = now.Add(d)
			return nil
		},
	}

	lockPath := filepath.Join(dir, LockFilename)
	if err := os.WriteFile(lockPath, []byte(`{"pid":99999,"token":"holder-a"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(lockPath, now, now); err != nil {
		t.Fatal(err)
	}

	_, err := WithDesignLock(ctx, dir, timing, func(_ func() error) (struct{}, error) {
		return struct{}{}, nil
	})
	if !errors.Is(err, ErrDesignBusy) {
		t.Fatalf("expected ErrDesignBusy while fresh lock held, got %v", err)
	}

	staleTime := now.Add(-DefaultLockStale - time.Second)
	if err := os.Chtimes(lockPath, staleTime, staleTime); err != nil {
		t.Fatal(err)
	}
	stolenRan := false
	_, err = WithDesignLock(ctx, dir, timing, func(assertHeld func() error) (struct{}, error) {
		stolenRan = true
		if err := assertHeld(); err != nil {
			return struct{}{}, err
		}
		if err := os.WriteFile(lockPath, []byte(`{"pid":88888,"token":"other-owner"}`), 0o600); err != nil {
			return struct{}{}, err
		}
		return struct{}{}, assertHeld()
	})
	if !stolenRan {
		t.Fatal("expected stale lock to be stolen")
	}
	if !errors.Is(err, ErrDesignBusy) {
		t.Fatalf("expected ErrDesignBusy after token stolen mid-hold, got %v", err)
	}
	if got := readLockToken(lockPath); got != "other-owner" {
		t.Fatalf("releaseLock deleted another owner's lock: got token %q", got)
	}
}

func TestCreateReadSaveCASIdempotencyAndAssetValidation(t *testing.T) {
	ctx := context.Background()
	dataRoot := t.TempDir()
	sessionID := "11111111-2222-4333-8444-555555555555"
	assoc := Association{
		SessionID: sessionID,
		Name:      "Poster Draft",
		UserID:    "user-1",
		MachineID: "machine-1",
		CreatedAt: "2026-11-23T12:00:00.000Z",
	}

	created, err := CreateDesign(ctx, dataRoot, CreateRequest{
		Association: assoc,
		Width:       1080,
		Height:      1350,
	}, LockTiming{})
	if err != nil {
		t.Fatalf("CreateDesign: %v", err)
	}
	if created.RevisionID == "" {
		t.Fatal("expected non-empty revisionId")
	}

	pending, err := PendingDesigns(dataRoot)
	if err != nil || len(pending) != 1 {
		t.Fatalf("PendingDesigns = %d, err=%v", len(pending), err)
	}
	if err := AcknowledgeDesign(dataRoot, sessionID); err != nil {
		t.Fatalf("AcknowledgeDesign: %v", err)
	}
	pendingAfter, _ := PendingDesigns(dataRoot)
	if len(pendingAfter) != 0 {
		t.Fatalf("expected 0 pending designs after ack, got %d", len(pendingAfter))
	}

	assetHash, assetURI := sampleDesignPNG(t)
	docWithImage := json.RawMessage(`{"schemaVersion":4,"canvas":{"width":1080,"height":1350},"background":{"type":"solid","color":"#ffffff"},"diagnostics":[],"elements":[{"id":"hero","kind":"image","bounds":[10,20,100,100],"zIndex":0,"src":"asset:` + assetHash + `"}]}`)

	saved, err := SaveDesign(ctx, dataRoot, SaveRequest{
		SessionID:      sessionID,
		BaseRevisionID: created.RevisionID,
		Content: Content{
			Doc:    docWithImage,
			Assets: map[string]string{assetHash: assetURI},
		},
		Name: "Poster V2",
	}, LockTiming{})
	if err != nil {
		t.Fatalf("SaveDesign: %v", err)
	}
	if saved.Association.Name != "Poster V2" || saved.RevisionID == created.RevisionID {
		t.Fatalf("unexpected saved payload: %+v", saved)
	}

	retried, err := SaveDesign(ctx, dataRoot, SaveRequest{
		SessionID:      sessionID,
		BaseRevisionID: created.RevisionID,
		Content: Content{
			Doc:    docWithImage,
			Assets: map[string]string{assetHash: assetURI},
		},
		Name: "Poster V2",
	}, LockTiming{})
	if err != nil || retried.RevisionID != saved.RevisionID {
		t.Fatalf("expected idempotent lost-ack retry to succeed, got rev=%s err=%v", retried.RevisionID, err)
	}

	_, err = SaveDesign(ctx, dataRoot, SaveRequest{
		SessionID:      sessionID,
		BaseRevisionID: created.RevisionID,
		Content: Content{
			Doc:    json.RawMessage(`{"schemaVersion":4,"canvas":{"width":1080,"height":1350},"background":{"type":"solid","color":"#000000"},"diagnostics":[],"elements":[]}`),
			Assets: map[string]string{},
		},
	}, LockTiming{})
	if !errors.Is(err, ErrDesignConflict) {
		t.Fatalf("expected ErrDesignConflict on stale baseRevisionId, got %v", err)
	}

	_, err = SaveDesign(ctx, dataRoot, SaveRequest{
		SessionID:      sessionID,
		BaseRevisionID: saved.RevisionID,
		Content: Content{
			Doc:    json.RawMessage(`{"schemaVersion":4,"canvas":{"width":1080,"height":1350},"background":{"type":"solid","color":"#ffffff"},"diagnostics":[],"elements":[{"id":"bad","kind":"image","bounds":[0,0,10,10],"zIndex":0,"src":"https://evil.example/a.png"}]}`),
			Assets: map[string]string{},
		},
	}, LockTiming{})
	if err == nil {
		t.Fatal("expected external URL in document to be rejected")
	}

	specialDoc := json.RawMessage(`{"elements":[{"id":"txt-1","kind":"text","bounds":[0,0,200,40],"zIndex":0,"label":"A & <B> > C"}],"background":{"type":"solid","color":"#ffffff"},"canvas":{"height":600,"width":800},"schemaVersion":4}`)
	canon, err := CanonicalContentBytes(specialDoc, map[string]string{})
	if err != nil {
		t.Fatalf("CanonicalContentBytes specialDoc: %v", err)
	}
	if !bytes.Contains(canon, []byte(`"A & <B> > C"`)) {
		t.Fatalf("expected SetEscapeHTML(false) to preserve literal &<>, got %s", string(canon))
	}
	if !bytes.Contains(canon, []byte(`"diagnostics":[]`)) {
		t.Fatalf("expected omitted diagnostics to default to [], got %s", string(canon))
	}
}

func TestWatcherCoalescesAndIgnoresLockTempFiles(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dir := t.TempDir()
	w, err := NewWatcher(ctx, dir, 20*time.Millisecond)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	defer w.Close()

	if err := os.WriteFile(filepath.Join(dir, LockFilename), []byte(`{"pid":1,"token":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".abc.tmp"), []byte("tmp"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, DesignFileName)
	if err := os.WriteFile(target, []byte(`{"ok":true}`), 0o600); err != nil {
		t.Fatal(err)
	}

	select {
	case ev := <-w.Events():
		found := false
		for _, p := range ev.Paths {
			if filepath.Base(p) == DesignFileName {
				found = true
			}
			if filepath.Base(p) == LockFilename || filepath.Base(p) == ".abc.tmp" {
				t.Fatalf("watcher should ignore lock/tmp files, got %s", p)
			}
		}
		if !found {
			t.Fatalf("expected %s in watch event paths, got %v", DesignFileName, ev.Paths)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for watch event")
	}
}
