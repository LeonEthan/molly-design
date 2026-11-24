package memory

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixedClock() func() time.Time {
	t := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	return func() time.Time {
		t = t.Add(time.Second)
		return t
	}
}

func TestOpenCreateDirAndReopenPersistence(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "memory", "preferences.sqlite")
	store, err := OpenWithClock(dbPath, fixedClock())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	snap, err := store.Read(context.Background())
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !snap.Enabled || len(snap.Entries) != 0 {
		t.Fatalf("unexpected initial snapshot: %+v", snap)
	}
	if err := store.Capture(context.Background(), snap.Revision, []Change{{Text: "Prefers concise explanations."}}); err != nil {
		t.Fatalf("Capture: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	reopened, err := OpenWithClock(dbPath, fixedClock())
	if err != nil {
		t.Fatalf("Reopen: %v", err)
	}
	defer reopened.Close()
	snap2, err := reopened.Read(context.Background())
	if err != nil {
		t.Fatalf("Read reopened: %v", err)
	}
	if len(snap2.Entries) != 1 || snap2.Entries[0].Text != "Prefers concise explanations." {
		t.Fatalf("unexpected reopened entries: %+v", snap2.Entries)
	}
}

func TestRevisionFencingDisableRemoveAndConcurrency(t *testing.T) {
	ctx := context.Background()
	store, err := OpenWithClock(":memory:", fixedClock())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	initial, err := store.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, txt := range []string{"Prefers blue.", "Prefers red."} {
		wg.Add(1)
		go func(idx int, text string) {
			defer wg.Done()
			errs[idx] = store.Capture(ctx, initial.Revision, []Change{{Text: text}})
		}(i, txt)
	}
	wg.Wait()
	succeeded := 0
	stale := 0
	for _, e := range errs {
		if e == nil {
			succeeded++
		} else if errors.Is(e, ErrMemoryStale) {
			stale++
		}
	}
	if succeeded != 1 || stale != 1 {
		t.Fatalf("concurrent capture expected 1 ok + 1 stale, got %v", errs)
	}

	saved, _ := store.Read(ctx)
	entry := saved.Entries[0]

	if err := store.SetEnabled(ctx, false, saved.Revision); err != nil {
		t.Fatalf("SetEnabled(false): %v", err)
	}
	disabled, _ := store.Read(ctx)
	if disabled.Enabled {
		t.Fatal("expected enabled=false")
	}
	if err := store.Capture(ctx, disabled.Revision, []Change{{Text: "Should fail"}}); !errors.Is(err, ErrMemoryDisabled) {
		t.Fatalf("expected ErrMemoryDisabled, got %v", err)
	}

	if err := store.Edit(ctx, entry.ID, "Prefers green.", disabled.Revision); err != nil {
		t.Fatalf("Edit while disabled: %v", err)
	}
	edited, _ := store.Read(ctx)
	if edited.Entries[0].Text != "Prefers green." {
		t.Fatalf("unexpected edited text: %+v", edited.Entries)
	}

	if err := store.Remove(ctx, entry.ID, edited.Revision); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	afterRemove, _ := store.Read(ctx)
	if err := store.SetEnabled(ctx, true, afterRemove.Revision); err != nil {
		t.Fatalf("SetEnabled(true): %v", err)
	}
	if err := store.Capture(ctx, saved.Revision, []Change{{ID: entry.ID, Text: "Resurrect"}}); !errors.Is(err, ErrMemoryStale) {
		t.Fatalf("expected ErrMemoryStale on old revision, got %v", err)
	}
	finalSnap, _ := store.Read(ctx)
	if len(finalSnap.Entries) != 0 {
		t.Fatalf("expected empty entries, got %+v", finalSnap.Entries)
	}
}

func TestBounds32x300UnknownIDAndCancellation(t *testing.T) {
	ctx := context.Background()
	store, err := OpenWithClock(":memory:", fixedClock())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	initial, _ := store.Read(ctx)
	if err := store.Capture(ctx, initial.Revision, []Change{{ID: "unknown", Text: "Nope"}}); !errors.Is(err, ErrMemoryMissing) {
		t.Fatalf("expected ErrMemoryMissing, got %v", err)
	}
	if err := store.Capture(ctx, initial.Revision, []Change{{Text: strings.Repeat("a", MaxTextRunes+1)}}); err == nil {
		t.Fatal("expected >300 rune text to fail")
	}

	cancelledCtx, cancel := context.WithCancel(ctx)
	cancel()
	if err := store.Capture(cancelledCtx, initial.Revision, []Change{{Text: "Cancelled"}}); err == nil {
		t.Fatal("expected cancelled context to fail")
	}
	afterCancel, _ := store.Read(ctx)
	if afterCancel.Revision != initial.Revision || len(afterCancel.Entries) != 0 {
		t.Fatalf("cancelled capture mutated store: %+v", afterCancel)
	}

	for batch := 0; batch < 4; batch++ {
		snap, _ := store.Read(ctx)
		changes := make([]Change, 0, 8)
		for i := 0; i < 8; i++ {
			changes = append(changes, Change{Text: fmt.Sprintf("Preference %d", batch*8+i)})
		}
		if err := store.Capture(ctx, snap.Revision, changes); err != nil {
			t.Fatalf("batch %d capture failed: %v", batch, err)
		}
	}

	full, _ := store.Read(ctx)
	if len(full.Entries) != MaxEntries {
		t.Fatalf("entries = %d, want %d", len(full.Entries), MaxEntries)
	}
	if err := store.Capture(ctx, full.Revision, []Change{{Text: "Overflow entry"}}); !errors.Is(err, ErrMemoryFull) {
		t.Fatalf("expected ErrMemoryFull, got %v", err)
	}
	afterFull, _ := store.Read(ctx)
	if len(afterFull.Entries) != MaxEntries || afterFull.Revision != full.Revision {
		t.Fatal("full rejection should not evict or modify entries")
	}

	hits, err := store.Search(ctx, "Preference 15", 5)
	if err != nil {
		t.Fatalf("FTS5 Search failed: %v", err)
	}
	if len(hits) != 1 || hits[0].Text != "Preference 15" {
		t.Fatalf("unexpected FTS5 hits: %+v", hits)
	}
}

func seedLegacyMem0DB(t *testing.T, dbPath string, count int, enabled bool) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`
		CREATE TABLE vectors (
			id TEXT PRIMARY KEY,
			vector BLOB NOT NULL,
			payload TEXT NOT NULL
		)
	`); err != nil {
		t.Fatalf("create vectors: %v", err)
	}
	for i := 0; i < count; i++ {
		id := fmt.Sprintf("pref-%02d", i)
		payload, _ := json.Marshal(map[string]any{
			"id":   id,
			"text": fmt.Sprintf("Legacy preference %02d 偏好中文", i),
			"kind": "preference",
		})
		if _, err := db.Exec(`INSERT INTO vectors (id, vector, payload) VALUES (?, ?, ?)`, id, []byte{0, 0, 128, 63}, string(payload)); err != nil {
			t.Fatalf("insert vector %d: %v", i, err)
		}
	}
	settingsPayload, _ := json.Marshal(map[string]any{
		"kind":     "settings",
		"enabled":  enabled,
		"revision": "legacy-rev-1",
	})
	if _, err := db.Exec(`INSERT INTO vectors (id, vector, payload) VALUES (?, ?, ?)`, "settings", []byte{0, 0, 128, 63}, string(settingsPayload)); err != nil {
		t.Fatalf("insert settings: %v", err)
	}
}

func TestLegacyMem0InPlaceMigrationZeroDataLossAndIdempotency(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "preferences.sqlite")
	seedLegacyMem0DB(t, dbPath, 32, false)

	store, err := OpenWithClock(dbPath, fixedClock())
	if err != nil {
		t.Fatalf("Open migrated db: %v", err)
	}
	snap, err := store.Read(ctx)
	if err != nil {
		t.Fatalf("Read migrated: %v", err)
	}
	if snap.Enabled {
		t.Fatal("expected legacy enabled=false to be preserved")
	}
	if len(snap.Entries) != 32 {
		t.Fatalf("migrated entries = %d, want 32 (zero data loss)", len(snap.Entries))
	}
	if snap.Entries[0].ID != "pref-00" || snap.Entries[31].ID != "pref-31" {
		t.Fatalf("unexpected migrated entries bounds: %+v .. %+v", snap.Entries[0], snap.Entries[31])
	}

	if err := store.Remove(ctx, "pref-00", snap.Revision); err != nil {
		t.Fatalf("Remove after migration: %v", err)
	}
	_ = store.Close()

	reopened, err := OpenWithClock(dbPath, fixedClock())
	if err != nil {
		t.Fatalf("Reopen after delete: %v", err)
	}
	defer reopened.Close()
	snap2, _ := reopened.Read(ctx)
	if len(snap2.Entries) != 31 {
		t.Fatalf("expected one-time migration not to resurrect deleted entry, got %d entries", len(snap2.Entries))
	}
}

func TestImportLegacyMem0ExternalFile(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "old-mem0.sqlite")
	newPath := filepath.Join(dir, "new-molly.sqlite")
	seedLegacyMem0DB(t, legacyPath, 5, true)

	store, err := OpenWithClock(newPath, fixedClock())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	report, err := store.ImportLegacyMem0File(ctx, legacyPath)
	if err != nil {
		t.Fatalf("ImportLegacyMem0File: %v", err)
	}
	if report.Skipped || report.Imported != 5 {
		t.Fatalf("unexpected migration report: %+v", report)
	}
	second, err := store.ImportLegacyMem0File(ctx, legacyPath)
	if err != nil {
		t.Fatalf("second ImportLegacyMem0File: %v", err)
	}
	if !second.Skipped {
		t.Fatalf("expected second external import to be idempotently skipped: %+v", second)
	}
}

func TestFTS5RebuildOnPreExistingTypeScriptSchemaAndLineSeparators(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "ts-seeded.sqlite")

	rawDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open raw sqlite: %v", err)
	}
	tsSchema := `
CREATE TABLE personal_preferences (
	id TEXT PRIMARY KEY,
	text TEXT NOT NULL CHECK(length(text) >= 1 AND length(text) <= 300),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE TABLE personal_memory_meta (
	id INTEGER PRIMARY KEY CHECK(id = 1),
	enabled INTEGER NOT NULL DEFAULT 1,
	revision_nonce TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
`
	if _, err := rawDB.Exec(tsSchema); err != nil {
		_ = rawDB.Close()
		t.Fatalf("seed TS schema: %v", err)
	}
	textWithSeparators := "Line one\u2028Line two\u2029Literal \\u2028 Swiss grid"
	if _, err := rawDB.Exec(
		`INSERT INTO personal_preferences (id, text, created_at, updated_at) VALUES (?, ?, 1000, 1000)`,
		"ts-pref-1", textWithSeparators,
	); err != nil {
		_ = rawDB.Close()
		t.Fatalf("insert TS row: %v", err)
	}
	if _, err := rawDB.Exec(
		`INSERT INTO personal_memory_meta (id, enabled, revision_nonce, updated_at) VALUES (1, 1, 'ts-nonce-1', 1000)`,
	); err != nil {
		_ = rawDB.Close()
		t.Fatalf("insert TS meta: %v", err)
	}
	_ = rawDB.Close()

	store, err := OpenWithClock(dbPath, fixedClock())
	if err != nil {
		t.Fatalf("Open TS-seeded db: %v", err)
	}
	defer store.Close()

	snap, err := store.Read(ctx)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(snap.Entries) != 1 || snap.Entries[0].Text != textWithSeparators {
		t.Fatalf("unexpected entries: %+v", snap.Entries)
	}

	rawExpectedJSON := `{"entries":[{"id":"ts-pref-1","text":"Line one` + "\u2028" + `Line two` + "\u2029" + `Literal \\u2028 Swiss grid"}],"enabled":true,"nonce":"ts-nonce-1"}`
	if got := string(unescapeJSONLineSeparators([]byte(`{"entries":[{"id":"ts-pref-1","text":"Line one\u2028Line two\u2029Literal \\u2028 Swiss grid"}],"enabled":true,"nonce":"ts-nonce-1"}`))); got != rawExpectedJSON {
		t.Fatalf("unescapeJSONLineSeparators mismatch:\ngot:  %q\nwant: %q", got, rawExpectedJSON)
	}

	hits, err := store.Search(ctx, "Swiss grid", 5)
	if err != nil {
		t.Fatalf("Search on rebuilt FTS: %v", err)
	}
	if len(hits) != 1 || hits[0].ID != "ts-pref-1" {
		t.Fatalf("expected rebuilt FTS to find ts-pref-1, got %+v", hits)
	}

	if err := store.Edit(ctx, "ts-pref-1", "Updated Swiss grid", snap.Revision); err != nil {
		t.Fatalf("Edit pre-existing TS row failed (FTS drift?): %v", err)
	}
	edited, err := store.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(ctx, "ts-pref-1", edited.Revision); err != nil {
		t.Fatalf("Remove pre-existing TS row failed (FTS drift?): %v", err)
	}
}

func BenchmarkStoreReadWrite(b *testing.B) {
	ctx := context.Background()
	dbPath := filepath.Join(b.TempDir(), "bench.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()

	snap, _ := store.Read(ctx)
	_ = store.Capture(ctx, snap.Revision, []Change{
		{Text: "Prefers minimalist editorial Swiss grid layouts."},
		{Text: "Avoids neon gradients and heavy drop shadows."},
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := store.Read(ctx); err != nil {
			b.Fatal(err)
		}
	}
}
