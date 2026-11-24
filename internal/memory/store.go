package memory

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

const (
	MaxEntries              = 32
	MaxTextRunes            = 300
	MaxIDRunes              = 100
	MaxChangesPerBatch      = 8
	LegacyMem0MigrationName = "mem0_vectors_v1"
)

var (
	ErrMemoryStale    = errors.New("memory_stale")
	ErrMemoryMissing  = errors.New("memory_missing")
	ErrMemoryDisabled = errors.New("memory_disabled")
	ErrMemoryFull     = errors.New("memory_full")
)

type Entry struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type Change struct {
	ID   string `json:"id,omitempty"`
	Text string `json:"text"`
}

type Snapshot struct {
	Revision string  `json:"revision"`
	Enabled  bool    `json:"enabled"`
	Entries  []Entry `json:"entries"`
}

type MigrationReport struct {
	Imported int   `json:"imported"`
	Enabled  *bool `json:"enabled,omitempty"`
	Skipped  bool  `json:"skipped"`
}

type Store struct {
	mu     sync.Mutex
	db     *sql.DB
	dbPath string
	clock  func() time.Time
}

func Open(dbPath string) (*Store, error) {
	return OpenWithClock(dbPath, time.Now)
}

func OpenWithClock(dbPath string, clock func() time.Time) (*Store, error) {
	if strings.TrimSpace(dbPath) == "" {
		return nil, errors.New("memory database path must not be empty")
	}
	if clock == nil {
		clock = time.Now
	}

	isMemory := dbPath == ":memory:" || strings.HasPrefix(dbPath, "file::memory:")
	if !isMemory {
		dir := filepath.Dir(dbPath)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("create memory directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open memory sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	store := &Store{
		db:     db,
		dbPath: dbPath,
		clock:  clock,
	}
	if err := store.init(isMemory); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

func (s *Store) init(isMemory bool) error {
	pragmas := []string{
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA foreign_keys = ON;",
	}
	if !isMemory {
		pragmas = append(pragmas, "PRAGMA journal_mode = WAL;", "PRAGMA synchronous = NORMAL;")
	}
	for _, p := range pragmas {
		if _, err := s.db.Exec(p); err != nil {
			return fmt.Errorf("apply pragma %q: %w", p, err)
		}
	}

	var hadFTS int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'personal_preferences_fts'`).Scan(&hadFTS); err != nil {
		return fmt.Errorf("probe fts table: %w", err)
	}

	schema := `
CREATE TABLE IF NOT EXISTS personal_preferences (
	id TEXT PRIMARY KEY,
	text TEXT NOT NULL CHECK(length(text) >= 1 AND length(text) <= 300),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_memory_meta (
	id INTEGER PRIMARY KEY CHECK(id = 1),
	enabled INTEGER NOT NULL DEFAULT 1,
	revision_nonce TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_memory_migrations (
	name TEXT PRIMARY KEY,
	imported_count INTEGER NOT NULL,
	migrated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS personal_preferences_fts USING fts5(
	id UNINDEXED,
	text,
	content='personal_preferences',
	content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS personal_preferences_ai AFTER INSERT ON personal_preferences BEGIN
	INSERT INTO personal_preferences_fts(rowid, id, text) VALUES (new.rowid, new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS personal_preferences_ad AFTER DELETE ON personal_preferences BEGIN
	INSERT INTO personal_preferences_fts(personal_preferences_fts, rowid, id, text) VALUES ('delete', old.rowid, old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS personal_preferences_au AFTER UPDATE ON personal_preferences BEGIN
	INSERT INTO personal_preferences_fts(personal_preferences_fts, rowid, id, text) VALUES ('delete', old.rowid, old.id, old.text);
	INSERT INTO personal_preferences_fts(rowid, id, text) VALUES (new.rowid, new.id, new.text);
END;
`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("init memory schema: %w", err)
	}

	if err := s.syncFTSIndexLocked(context.Background(), hadFTS == 0); err != nil {
		return err
	}

	now := s.clock().UnixMilli()
	if _, err := s.db.Exec(
		`INSERT OR IGNORE INTO personal_memory_meta (id, enabled, revision_nonce, updated_at) VALUES (1, 1, 'initial', ?)`,
		now,
	); err != nil {
		return fmt.Errorf("seed memory meta: %w", err)
	}

	if _, err := s.importLegacyMem0InPlaceLocked(context.Background()); err != nil {
		return err
	}
	return nil
}

func (s *Store) syncFTSIndexLocked(ctx context.Context, createdNow bool) error {
	tx, err := s.beginImmediate(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var prefCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM personal_preferences`).Scan(&prefCount); err != nil {
		return fmt.Errorf("count preferences for fts sync: %w", err)
	}
	needRebuild := createdNow && prefCount > 0
	if !needRebuild {
		var ftsCount int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM personal_preferences_fts_docsize`).Scan(&ftsCount); err != nil {
			needRebuild = true
		} else if ftsCount != prefCount {
			needRebuild = true
		}
	}
	if !needRebuild {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO personal_preferences_fts(personal_preferences_fts) VALUES('rebuild')`); err != nil {
		return fmt.Errorf("rebuild memory fts index: %w", err)
	}
	return tx.Commit()
}

func (s *Store) Read(ctx context.Context) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return Snapshot{}, errors.New("memory store is closed")
	}
	return s.readLocked(ctx, s.db)
}

type queryable interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *Store) readLocked(ctx context.Context, q queryable) (Snapshot, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, text FROM personal_preferences ORDER BY id ASC LIMIT ?`, MaxEntries)
	if err != nil {
		return Snapshot{}, fmt.Errorf("list preferences: %w", err)
	}
	defer rows.Close()

	entries := make([]Entry, 0)
	for rows.Next() {
		var e Entry
		if scanErr := rows.Scan(&e.ID, &e.Text); scanErr != nil {
			return Snapshot{}, fmt.Errorf("scan preference: %w", scanErr)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return Snapshot{}, fmt.Errorf("iterate preferences: %w", err)
	}

	var enabledInt int
	var nonce string
	if err := q.QueryRowContext(ctx, `SELECT enabled, revision_nonce FROM personal_memory_meta WHERE id = 1`).Scan(&enabledInt, &nonce); err != nil {
		return Snapshot{}, fmt.Errorf("read memory meta: %w", err)
	}
	enabled := enabledInt != 0
	return Snapshot{
		Revision: computeRevision(entries, enabled, nonce),
		Enabled:  enabled,
		Entries:  entries,
	}, nil
}

func (s *Store) SetEnabled(ctx context.Context, enabled bool, revision string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("memory store is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	tx, err := s.beginImmediate(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	snap, err := s.readLocked(ctx, tx)
	if err != nil {
		return err
	}
	if snap.Revision != revision {
		return ErrMemoryStale
	}
	enabledVal := 0
	if enabled {
		enabledVal = 1
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE personal_memory_meta SET enabled = ?, revision_nonce = ?, updated_at = ? WHERE id = 1`,
		enabledVal, newUUID(), s.clock().UnixMilli(),
	); err != nil {
		return fmt.Errorf("update memory enabled: %w", err)
	}
	return tx.Commit()
}

func (s *Store) Edit(ctx context.Context, id string, text string, revision string) error {
	cleanID, cleanText, err := validateEntry(id, text)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("memory store is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	tx, err := s.beginImmediate(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	snap, err := s.readLocked(ctx, tx)
	if err != nil {
		return err
	}
	if snap.Revision != revision {
		return ErrMemoryStale
	}
	if !containsEntryID(snap.Entries, cleanID) {
		return ErrMemoryMissing
	}
	now := s.clock().UnixMilli()
	if _, err := tx.ExecContext(ctx, `UPDATE personal_preferences SET text = ?, updated_at = ? WHERE id = ?`, cleanText, now, cleanID); err != nil {
		return fmt.Errorf("edit preference: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`, newUUID(), now); err != nil {
		return fmt.Errorf("bump memory revision: %w", err)
	}
	return tx.Commit()
}

func (s *Store) Remove(ctx context.Context, id string, revision string) error {
	if err := validateID(id); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("memory store is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	tx, err := s.beginImmediate(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	snap, err := s.readLocked(ctx, tx)
	if err != nil {
		return err
	}
	if snap.Revision != revision {
		return ErrMemoryStale
	}
	if !containsEntryID(snap.Entries, id) {
		return ErrMemoryMissing
	}
	now := s.clock().UnixMilli()
	if _, err := tx.ExecContext(ctx, `DELETE FROM personal_preferences WHERE id = ?`, id); err != nil {
		return fmt.Errorf("remove preference: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`, newUUID(), now); err != nil {
		return fmt.Errorf("bump memory revision: %w", err)
	}
	return tx.Commit()
}

func (s *Store) Capture(ctx context.Context, revision string, changes []Change) error {
	if len(changes) > MaxChangesPerBatch {
		return fmt.Errorf("capture batch exceeds maximum %d changes", MaxChangesPerBatch)
	}
	normalized := make([]Change, 0, len(changes))
	for _, ch := range changes {
		cleanText, err := validateText(ch.Text)
		if err != nil {
			return err
		}
		if ch.ID != "" {
			if err := validateID(ch.ID); err != nil {
				return err
			}
		}
		normalized = append(normalized, Change{ID: ch.ID, Text: cleanText})
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("memory store is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	tx, err := s.beginImmediate(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	snap, err := s.readLocked(ctx, tx)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if snap.Revision != revision {
		return ErrMemoryStale
	}
	if !snap.Enabled {
		return ErrMemoryDisabled
	}

	additions := 0
	for _, ch := range normalized {
		if ch.ID != "" {
			if !containsEntryID(snap.Entries, ch.ID) {
				return ErrMemoryMissing
			}
		} else {
			additions++
		}
	}
	if len(snap.Entries)+additions > MaxEntries {
		return ErrMemoryFull
	}
	if len(normalized) == 0 {
		return nil
	}

	if err := ctx.Err(); err != nil {
		return err
	}
	now := s.clock().UnixMilli()
	for _, ch := range normalized {
		if ch.ID != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE personal_preferences SET text = ?, updated_at = ? WHERE id = ?`, ch.Text, now, ch.ID); err != nil {
				return fmt.Errorf("update captured preference: %w", err)
			}
		} else {
			if _, err := tx.ExecContext(ctx, `INSERT INTO personal_preferences (id, text, created_at, updated_at) VALUES (?, ?, ?, ?)`, newUUID(), ch.Text, now, now); err != nil {
				return fmt.Errorf("insert captured preference: %w", err)
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`, newUUID(), now); err != nil {
		return fmt.Errorf("bump memory revision: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Search(ctx context.Context, query string, limit int) ([]Entry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > MaxEntries {
		limit = MaxEntries
	}
	ftsExpr := buildSafeFTSQuery(query)
	if ftsExpr == "" {
		return []Entry{}, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, errors.New("memory store is closed")
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT p.id, p.text
		 FROM personal_preferences_fts f
		 JOIN personal_preferences p ON p.rowid = f.rowid
		 WHERE personal_preferences_fts MATCH ?
		 ORDER BY bm25(personal_preferences_fts), p.id ASC
		 LIMIT ?`,
		ftsExpr, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("search preferences: %w", err)
	}
	defer rows.Close()

	out := make([]Entry, 0)
	for rows.Next() {
		var e Entry
		if scanErr := rows.Scan(&e.ID, &e.Text); scanErr != nil {
			return nil, scanErr
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) ImportLegacyMem0File(ctx context.Context, legacyDBPath string) (MigrationReport, error) {
	if err := ctx.Err(); err != nil {
		return MigrationReport{}, err
	}
	legacyDB, err := sql.Open("sqlite", legacyDBPath)
	if err != nil {
		return MigrationReport{}, fmt.Errorf("open legacy mem0 sqlite: %w", err)
	}
	defer legacyDB.Close()

	entries, enabled, hasTable, err := readLegacyMem0Vectors(ctx, legacyDB)
	if err != nil {
		return MigrationReport{}, err
	}
	if !hasTable {
		return MigrationReport{Skipped: true}, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return MigrationReport{}, errors.New("memory store is closed")
	}
	return s.applyLegacyMem0ImportLocked(ctx, entries, enabled, "external:"+filepath.Base(legacyDBPath))
}

func (s *Store) importLegacyMem0InPlaceLocked(ctx context.Context) (MigrationReport, error) {
	var already int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM personal_memory_migrations WHERE name = ?`, LegacyMem0MigrationName).Scan(&already)
	if err != nil {
		return MigrationReport{}, fmt.Errorf("check migration state: %w", err)
	}
	if already > 0 {
		return MigrationReport{Skipped: true}, nil
	}
	entries, enabled, hasTable, err := readLegacyMem0Vectors(ctx, s.db)
	if err != nil {
		return MigrationReport{}, err
	}
	if !hasTable {
		return MigrationReport{Skipped: true}, nil
	}
	return s.applyLegacyMem0ImportLocked(ctx, entries, enabled, LegacyMem0MigrationName)
}

func (s *Store) applyLegacyMem0ImportLocked(ctx context.Context, entries []Entry, enabled *bool, migrationName string) (MigrationReport, error) {
	tx, err := s.beginImmediate(ctx)
	if err != nil {
		return MigrationReport{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var already int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM personal_memory_migrations WHERE name = ?`, migrationName).Scan(&already); err != nil {
		return MigrationReport{}, err
	}
	if already > 0 {
		return MigrationReport{Skipped: true}, nil
	}

	existingSnap, err := s.readLocked(ctx, tx)
	if err != nil {
		return MigrationReport{}, err
	}
	existingIDs := make(map[string]bool, len(existingSnap.Entries))
	for _, e := range existingSnap.Entries {
		existingIDs[e.ID] = true
	}

	now := s.clock().UnixMilli()
	imported := 0
	for _, e := range entries {
		if existingIDs[e.ID] {
			continue
		}
		if len(existingIDs) >= MaxEntries {
			break
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO personal_preferences (id, text, created_at, updated_at) VALUES (?, ?, ?, ?)`, e.ID, e.Text, now, now); err != nil {
			return MigrationReport{}, fmt.Errorf("import legacy preference %q: %w", e.ID, err)
		}
		existingIDs[e.ID] = true
		imported++
	}

	if enabled != nil {
		enabledInt := 0
		if *enabled {
			enabledInt = 1
		}
		if _, err := tx.ExecContext(ctx, `UPDATE personal_memory_meta SET enabled = ?, revision_nonce = ?, updated_at = ? WHERE id = 1`, enabledInt, newUUID(), now); err != nil {
			return MigrationReport{}, fmt.Errorf("import legacy enabled state: %w", err)
		}
	} else if imported > 0 {
		if _, err := tx.ExecContext(ctx, `UPDATE personal_memory_meta SET revision_nonce = ?, updated_at = ? WHERE id = 1`, newUUID(), now); err != nil {
			return MigrationReport{}, fmt.Errorf("bump revision after import: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO personal_memory_migrations (name, imported_count, migrated_at) VALUES (?, ?, ?)`, migrationName, imported, now); err != nil {
		return MigrationReport{}, fmt.Errorf("record legacy migration: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return MigrationReport{}, err
	}
	return MigrationReport{
		Imported: imported,
		Enabled:  enabled,
		Skipped:  false,
	}, nil
}

func readLegacyMem0Vectors(ctx context.Context, db *sql.DB) ([]Entry, *bool, bool, error) {
	var tableName string
	err := db.QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vectors'`).Scan(&tableName)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, false, nil
	}
	if err != nil {
		return nil, nil, false, fmt.Errorf("probe legacy vectors table: %w", err)
	}

	rows, err := db.QueryContext(ctx, `SELECT id, payload FROM vectors ORDER BY id ASC`)
	if err != nil {
		return nil, nil, true, fmt.Errorf("query legacy vectors: %w", err)
	}
	defer rows.Close()

	var entries []Entry
	var enabled *bool
	for rows.Next() {
		var rowID string
		var rawPayload string
		if scanErr := rows.Scan(&rowID, &rawPayload); scanErr != nil {
			return nil, nil, true, scanErr
		}
		var payload struct {
			Kind    string `json:"kind"`
			Text    string `json:"text"`
			Enabled *bool  `json:"enabled"`
		}
		if jsonErr := json.Unmarshal([]byte(rawPayload), &payload); jsonErr != nil {
			continue
		}
		if rowID == "settings" || payload.Kind == "settings" {
			if payload.Enabled != nil {
				val := *payload.Enabled
				enabled = &val
			}
			continue
		}
		if payload.Kind != "preference" {
			continue
		}
		cleanID, cleanText, valErr := validateEntry(rowID, payload.Text)
		if valErr != nil {
			continue
		}
		entries = append(entries, Entry{ID: cleanID, Text: cleanText})
	}
	if err := rows.Err(); err != nil {
		return nil, nil, true, err
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ID < entries[j].ID
	})
	return entries, enabled, true, nil
}

type immediateTx struct {
	conn   *sql.Conn
	closed bool
}

func (s *Store) beginImmediate(ctx context.Context) (*immediateTx, error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire memory db conn: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("begin immediate memory transaction: %w", err)
	}
	return &immediateTx{conn: conn}, nil
}

func (t *immediateTx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.conn.QueryContext(ctx, query, args...)
}

func (t *immediateTx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return t.conn.QueryRowContext(ctx, query, args...)
}

func (t *immediateTx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.conn.ExecContext(ctx, query, args...)
}

func (t *immediateTx) Commit() error {
	if t.closed {
		return nil
	}
	t.closed = true
	_, err := t.conn.ExecContext(context.Background(), "COMMIT")
	if err != nil {
		if _, rbErr := t.conn.ExecContext(context.Background(), "ROLLBACK"); rbErr != nil {
			_ = t.conn.Raw(func(any) error { return driver.ErrBadConn })
		}
	}
	_ = t.conn.Close()
	return err
}

func (t *immediateTx) Rollback() error {
	if t.closed {
		return nil
	}
	t.closed = true
	_, err := t.conn.ExecContext(context.Background(), "ROLLBACK")
	if err != nil {
		_ = t.conn.Raw(func(any) error { return driver.ErrBadConn })
	}
	_ = t.conn.Close()
	return err
}

func computeRevision(entries []Entry, enabled bool, nonce string) string {
	type payload struct {
		Entries []Entry `json:"entries"`
		Enabled bool    `json:"enabled"`
		Nonce   string  `json:"nonce"`
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(payload{
		Entries: entries,
		Enabled: enabled,
		Nonce:   nonce,
	})
	raw := unescapeJSONLineSeparators(bytes.TrimSuffix(buf.Bytes(), []byte("\n")))
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func unescapeJSONLineSeparators(raw []byte) []byte {
	if !bytes.Contains(raw, []byte(`\u2028`)) && !bytes.Contains(raw, []byte(`\u2029`)) {
		return raw
	}
	out := make([]byte, 0, len(raw))
	for i := 0; i < len(raw); {
		if raw[i] == '\\' && i+5 < len(raw) && raw[i+1] == 'u' &&
			raw[i+2] == '2' && raw[i+3] == '0' && raw[i+4] == '2' &&
			(raw[i+5] == '8' || raw[i+5] == '9') {
			slashes := 0
			for j := i - 1; j >= 0 && raw[j] == '\\'; j-- {
				slashes++
			}
			if slashes%2 == 0 {
				if raw[i+5] == '8' {
					out = append(out, 0xe2, 0x80, 0xa8)
				} else {
					out = append(out, 0xe2, 0x80, 0xa9)
				}
				i += 6
				continue
			}
		}
		out = append(out, raw[i])
		i++
	}
	return out
}

func validateID(id string) error {
	n := utf8.RuneCountInString(id)
	if n < 1 || n > MaxIDRunes {
		return fmt.Errorf("preference id must be 1 to %d characters", MaxIDRunes)
	}
	return nil
}

func validateText(text string) (string, error) {
	trimmed := strings.TrimSpace(text)
	n := utf8.RuneCountInString(trimmed)
	if n < 1 || n > MaxTextRunes {
		return "", fmt.Errorf("preference text must be 1 to %d characters", MaxTextRunes)
	}
	return trimmed, nil
}

func validateEntry(id, text string) (string, string, error) {
	if err := validateID(id); err != nil {
		return "", "", err
	}
	cleanText, err := validateText(text)
	if err != nil {
		return "", "", err
	}
	return id, cleanText, nil
}

func containsEntryID(entries []Entry, id string) bool {
	for _, e := range entries {
		if e.ID == id {
			return true
		}
	}
	return false
}

func buildSafeFTSQuery(raw string) string {
	fields := strings.Fields(strings.TrimSpace(raw))
	if len(fields) == 0 {
		return ""
	}
	parts := make([]string, 0, len(fields))
	for _, f := range fields {
		clean := strings.ReplaceAll(f, `"`, "")
		if clean == "" {
			continue
		}
		parts = append(parts, `"`+clean+`"`)
	}
	return strings.Join(parts, " AND ")
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
