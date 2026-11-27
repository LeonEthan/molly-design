package design

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/LeonEthan/molly-design/internal/imaging"
	"github.com/LeonEthan/molly-design/internal/security"
)

const (
	MaxDesignBytes      = 64 << 20
	MaxAssetValueBytes  = 32 << 20
	MaxElements         = 2000
	MaxFonts            = 100
	MaxDiagnostics      = 1000
	MaxCanvasEdge       = 4096
	MaxNestingDepth     = 40
	DesignFileName      = "design.json"
	PendingDirName      = "design-pending"
	CandidatesDirName   = "candidates"
	ChatsDirName        = "chats"
	DefaultCanvasWidth  = 800
	DefaultCanvasHeight = 600
)

var (
	uuidPattern         = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	sha256HexPattern    = regexp.MustCompile(`^[a-f0-9]{64}$`)
	sha1HexPattern      = regexp.MustCompile(`^[a-f0-9]{40}$`)
	assetRefPattern     = regexp.MustCompile(`^asset:[a-f0-9]{64}$`)
	assetDataURIPattern = regexp.MustCompile(`^data:(image/(?:png|jpeg|gif)|font/(?:ttf|otf|woff|woff2));base64,([A-Za-z0-9+/]+={0,2})$`)
	allowedKinds        = map[string]bool{
		"text":  true,
		"shape": true,
		"line":  true,
		"image": true,
		"icon":  true,
		"table": true,
		"chart": true,
	}
)

type Association struct {
	SessionID string `json:"sessionId"`
	Name      string `json:"name"`
	UserID    string `json:"userId"`
	MachineID string `json:"machineId"`
	CreatedAt string `json:"createdAt"`
}

type EditingContext struct {
	BaseVersionID string `json:"baseVersionId"`
	ActionID      string `json:"actionId"`
}

type Content struct {
	Doc    json.RawMessage   `json:"doc"`
	Assets map[string]string `json:"assets"`
}

type SavedDocument struct {
	Doc         json.RawMessage   `json:"doc"`
	Assets      map[string]string `json:"assets"`
	Association Association       `json:"association"`
	Editing     *EditingContext   `json:"editing,omitempty"`
}

type Payload struct {
	Doc         json.RawMessage   `json:"doc"`
	Assets      map[string]string `json:"assets"`
	Association Association       `json:"association"`
	Editing     *EditingContext   `json:"editing,omitempty"`
	RevisionID  string            `json:"revisionId"`
}

type Candidate struct {
	Version            int     `json:"version"`
	CandidateID        string  `json:"candidateId"`
	ArtworkID          string  `json:"artworkId"`
	TurnID             string  `json:"turnId"`
	BaselineRevisionID string  `json:"baselineRevisionId"`
	CreatedAt          string  `json:"createdAt"`
	Content            Content `json:"content"`
}

type CreateRequest struct {
	Association Association `json:"association"`
	Width       int         `json:"width,omitempty"`
	Height      int         `json:"height,omitempty"`
	Copy        *Content    `json:"copy,omitempty"`
}

type SaveRequest struct {
	SessionID      string          `json:"sessionId"`
	BaseRevisionID string          `json:"baseRevisionId"`
	Content        Content         `json:"content"`
	Name           string          `json:"name,omitempty"`
	Editing        *EditingContext `json:"editing,omitempty"`
}

func DigestHex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func marshalJSONNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return unescapeJSONLineSeparators(bytes.TrimSuffix(buf.Bytes(), []byte("\n"))), nil
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

func compactRawJSON(raw json.RawMessage) (json.RawMessage, error) {
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return nil, err
	}
	return json.RawMessage(buf.Bytes()), nil
}

func normalizeDocumentJSON(rawDoc []byte) (json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(rawDoc, &top); err != nil {
		return nil, err
	}
	var canvasTop map[string]json.RawMessage
	if err := json.Unmarshal(top["canvas"], &canvasTop); err != nil {
		return nil, err
	}
	type canonicalCanvas struct {
		Width  json.RawMessage `json:"width"`
		Height json.RawMessage `json:"height"`
	}
	type canonicalDoc struct {
		SchemaVersion json.RawMessage `json:"schemaVersion"`
		Canvas        canonicalCanvas `json:"canvas"`
		Diagnostics   json.RawMessage `json:"diagnostics"`
		Background    json.RawMessage `json:"background"`
		Fonts         json.RawMessage `json:"fonts,omitempty"`
		Elements      json.RawMessage `json:"elements"`
	}

	sv, err := compactRawJSON(top["schemaVersion"])
	if err != nil {
		return nil, err
	}
	cw, err := compactRawJSON(canvasTop["width"])
	if err != nil {
		return nil, err
	}
	ch, err := compactRawJSON(canvasTop["height"])
	if err != nil {
		return nil, err
	}
	diagsRaw, hasDiags := top["diagnostics"]
	var diags json.RawMessage
	if !hasDiags || len(bytes.TrimSpace(diagsRaw)) == 0 || bytes.Equal(bytes.TrimSpace(diagsRaw), []byte("null")) {
		diags = json.RawMessage("[]")
	} else {
		diags, err = compactRawJSON(diagsRaw)
		if err != nil {
			return nil, err
		}
	}
	bg, err := compactRawJSON(top["background"])
	if err != nil {
		return nil, err
	}
	var fontsRaw json.RawMessage
	if f, ok := top["fonts"]; ok && len(bytes.TrimSpace(f)) > 0 {
		fontsRaw, err = compactRawJSON(f)
		if err != nil {
			return nil, err
		}
	}
	elems, err := compactRawJSON(top["elements"])
	if err != nil {
		return nil, err
	}

	out := canonicalDoc{
		SchemaVersion: sv,
		Canvas:        canonicalCanvas{Width: cw, Height: ch},
		Diagnostics:   diags,
		Background:    bg,
		Fonts:         fontsRaw,
		Elements:      elems,
	}
	encoded, err := marshalJSONNoEscape(out)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(encoded), nil
}

func CanonicalContentBytes(doc json.RawMessage, assets map[string]string) ([]byte, error) {
	if len(bytes.TrimSpace(doc)) == 0 {
		return nil, errors.New("doc must not be empty")
	}
	normalizedDoc, err := normalizeDocumentJSON(doc)
	if err != nil {
		var compactedDoc bytes.Buffer
		if compactErr := json.Compact(&compactedDoc, doc); compactErr != nil {
			return nil, fmt.Errorf("compact doc json: %w", compactErr)
		}
		normalizedDoc = compactedDoc.Bytes()
	}
	keys := make([]string, 0, len(assets))
	for k := range assets {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var out bytes.Buffer
	out.WriteString(`{"doc":`)
	out.Write(normalizedDoc)
	out.WriteString(`,"assets":{`)
	for i, k := range keys {
		if i > 0 {
			out.WriteByte(',')
		}
		kb, _ := marshalJSONNoEscape(k)
		vb, _ := marshalJSONNoEscape(assets[k])
		out.Write(kb)
		out.WriteByte(':')
		out.Write(vb)
	}
	out.WriteString(`}}`)
	return out.Bytes(), nil
}

func PublishBytesAtomic(directory string, target string, data []byte) error {
	tmpPath := filepath.Join(directory, "."+newUUID()+".tmp")
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmpPath) }()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, target); err != nil {
		return err
	}
	return syncDirectory(directory)
}

func openSessionRoot(dataRoot string, sessionID string) (*os.Root, error) {
	if !uuidPattern.MatchString(sessionID) {
		return nil, errors.New("invalid design sessionId")
	}
	dataRootHandle, err := os.OpenRoot(dataRoot)
	if err != nil {
		return nil, err
	}
	defer dataRootHandle.Close()

	chatsInfo, err := dataRootHandle.Lstat(ChatsDirName)
	if err != nil {
		return nil, err
	}
	if chatsInfo.Mode()&os.ModeSymlink != 0 || !chatsInfo.IsDir() {
		return nil, errors.New("Design chats directory cannot be a symlink")
	}
	chatsRoot, err := dataRootHandle.OpenRoot(ChatsDirName)
	if err != nil {
		return nil, err
	}
	defer chatsRoot.Close()

	chatInfo, err := chatsRoot.Lstat(sessionID)
	if err != nil {
		return nil, err
	}
	if chatInfo.Mode()&os.ModeSymlink != 0 || !chatInfo.IsDir() {
		return nil, errors.New("Design workspace cannot be a symlink")
	}
	return chatsRoot.OpenRoot(sessionID)
}

func ReadDesign(dataRoot string, sessionID string) (Payload, error) {
	sessionRoot, err := openSessionRoot(dataRoot, sessionID)
	if err != nil {
		return Payload{}, err
	}
	defer sessionRoot.Close()
	return readDesignFromRoot(sessionRoot, sessionID)
}

func CreateDesign(ctx context.Context, dataRoot string, req CreateRequest, timing LockTiming) (Payload, error) {
	if err := validateAssociation(req.Association); err != nil {
		return Payload{}, err
	}
	id := req.Association.SessionID
	dir := filepath.Join(dataRoot, ChatsDirName, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Payload{}, err
	}
	if info, err := os.Lstat(dir); err != nil {
		return Payload{}, err
	} else if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return Payload{}, errors.New("Design workspace cannot be a symlink")
	}

	return WithDesignLock(ctx, dir, timing, func(assertHeld func() error) (Payload, error) {
		prev, err := readDesignFromDir(dir, id)
		if err == nil {
			if prev.Association != req.Association {
				return Payload{}, errors.New("Design already exists")
			}
			return prev, nil
		} else if !os.IsNotExist(err) {
			return Payload{}, err
		}

		var content Content
		if req.Copy != nil {
			content = *req.Copy
		} else {
			w := req.Width
			if w == 0 {
				w = DefaultCanvasWidth
			}
			h := req.Height
			if h == 0 {
				h = DefaultCanvasHeight
			}
			if w < 1 || w > MaxCanvasEdge || h < 1 || h > MaxCanvasEdge {
				return Payload{}, errors.New("canvas dimensions out of range (1..4096)")
			}
			blankDoc := fmt.Sprintf(`{"schemaVersion":4,"canvas":{"width":%d,"height":%d},"background":{"type":"solid","color":"#ffffff"},"diagnostics":[],"elements":[]}`, w, h)
			content = Content{
				Doc:    json.RawMessage(blankDoc),
				Assets: map[string]string{},
			}
		}

		filteredAssets, compactDoc, err := ValidateContent(content)
		if err != nil {
			return Payload{}, err
		}

		saved := SavedDocument{
			Doc:         compactDoc,
			Assets:      filteredAssets,
			Association: req.Association,
		}
		rawBytes, err := marshalSavedDocument(saved)
		if err != nil {
			return Payload{}, err
		}
		if len(rawBytes) > MaxDesignBytes {
			return Payload{}, errors.New("Design exceeds 64 MiB")
		}

		if err := markPendingDesign(dataRoot, id); err != nil {
			return Payload{}, err
		}
		if err := assertHeld(); err != nil {
			return Payload{}, err
		}
		if err := PublishBytesAtomic(dir, filepath.Join(dir, DesignFileName), rawBytes); err != nil {
			return Payload{}, err
		}
		return Payload{
			Doc:         compactDoc,
			Assets:      filteredAssets,
			Association: req.Association,
			RevisionID:  DigestHex(rawBytes),
		}, nil
	})
}

func SaveDesign(ctx context.Context, dataRoot string, req SaveRequest, timing LockTiming) (Payload, error) {
	if !uuidPattern.MatchString(req.SessionID) {
		return Payload{}, errors.New("invalid design sessionId")
	}
	if !sha256HexPattern.MatchString(req.BaseRevisionID) {
		return Payload{}, errors.New("invalid baseRevisionId")
	}
	if req.Editing != nil {
		if err := validateEditingContext(*req.Editing); err != nil {
			return Payload{}, err
		}
	}
	dir := filepath.Join(dataRoot, ChatsDirName, req.SessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Payload{}, err
	}
	if info, err := os.Lstat(dir); err != nil {
		return Payload{}, err
	} else if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return Payload{}, errors.New("Design workspace cannot be a symlink")
	}

	return WithDesignLock(ctx, dir, timing, func(assertHeld func() error) (Payload, error) {
		prev, err := readDesignFromDir(dir, req.SessionID)
		if err != nil {
			return Payload{}, err
		}

		filteredAssets, compactDoc, err := ValidateContent(req.Content)
		if err != nil {
			return Payload{}, err
		}

		assoc := prev.Association
		if trimmedName := strings.TrimSpace(req.Name); trimmedName != "" {
			if utf8.RuneCountInString(trimmedName) > 200 {
				return Payload{}, errors.New("design name exceeds 200 characters")
			}
			assoc.Name = trimmedName
		}

		editing := prev.Editing
		if req.Editing != nil {
			editing = req.Editing
		}

		saved := SavedDocument{
			Doc:         compactDoc,
			Assets:      filteredAssets,
			Association: assoc,
			Editing:     editing,
		}
		rawBytes, err := marshalSavedDocument(saved)
		if err != nil {
			return Payload{}, err
		}
		if len(rawBytes) > MaxDesignBytes {
			return Payload{}, errors.New("Design exceeds 64 MiB")
		}
		newRevision := DigestHex(rawBytes)

		if prev.RevisionID != req.BaseRevisionID {
			if prev.RevisionID == newRevision {
				return prev, nil
			}
			return Payload{}, ErrDesignConflict
		}

		if err := assertHeld(); err != nil {
			return Payload{}, err
		}
		if err := PublishBytesAtomic(dir, filepath.Join(dir, DesignFileName), rawBytes); err != nil {
			return Payload{}, err
		}
		return Payload{
			Doc:         compactDoc,
			Assets:      filteredAssets,
			Association: assoc,
			Editing:     editing,
			RevisionID:  newRevision,
		}, nil
	})
}

func ReadDesignCandidate(dataRoot string, artworkID string, candidateID string) (Candidate, string, error) {
	if !uuidPattern.MatchString(artworkID) {
		return Candidate{}, "", errors.New("invalid artworkId")
	}
	if !sha256HexPattern.MatchString(candidateID) {
		return Candidate{}, "", errors.New("invalid candidateId")
	}
	sessionRoot, err := openSessionRoot(dataRoot, artworkID)
	if err != nil {
		return Candidate{}, "", err
	}
	defer sessionRoot.Close()

	candInfo, err := sessionRoot.Lstat(CandidatesDirName)
	if err != nil {
		return Candidate{}, "", err
	}
	if candInfo.Mode()&os.ModeSymlink != 0 || !candInfo.IsDir() {
		return Candidate{}, "", errors.New("Design candidates directory cannot be a symlink")
	}
	candRoot, err := sessionRoot.OpenRoot(CandidatesDirName)
	if err != nil {
		return Candidate{}, "", err
	}
	defer candRoot.Close()

	raw, err := security.ReadBoundedFileFromRoot(candRoot, candidateID+".json", MaxDesignBytes)
	if err != nil {
		return Candidate{}, "", err
	}
	file := filepath.Join(dataRoot, ChatsDirName, artworkID, CandidatesDirName, candidateID+".json")
	var cand Candidate
	if err := json.Unmarshal(raw, &cand); err != nil {
		return Candidate{}, "", errors.New("Invalid design candidate")
	}
	if cand.Version != 1 || cand.ArtworkID != artworkID || cand.CandidateID != candidateID {
		return Candidate{}, "", errors.New("Design candidate identity mismatch")
	}
	if cand.Content.Assets == nil {
		cand.Content.Assets = map[string]string{}
	}
	canon, err := CanonicalContentBytes(cand.Content.Doc, cand.Content.Assets)
	if err != nil || DigestHex(canon) != cand.CandidateID {
		return Candidate{}, "", errors.New("Design candidate checksum mismatch")
	}
	return cand, file, nil
}

func PendingDesigns(dataRoot string) ([]Payload, error) {
	pendingDir := filepath.Join(dataRoot, PendingDirName)
	if err := os.MkdirAll(pendingDir, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(pendingDir)
	if err != nil {
		return nil, err
	}
	results := make([]Payload, 0)
	for _, entry := range entries {
		id := entry.Name()
		if !uuidPattern.MatchString(id) {
			continue
		}
		p, readErr := ReadDesign(dataRoot, id)
		if readErr != nil {
			if os.IsNotExist(readErr) {
				continue
			}
			return nil, readErr
		}
		results = append(results, p)
	}
	return results, nil
}

func AcknowledgeDesign(dataRoot string, sessionID string) error {
	if !uuidPattern.MatchString(sessionID) {
		return errors.New("invalid design sessionId")
	}
	err := os.Remove(filepath.Join(dataRoot, PendingDirName, sessionID))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func readDesignFromDir(dir string, expectedID string) (Payload, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return Payload{}, err
	}
	defer root.Close()
	return readDesignFromRoot(root, expectedID)
}

func readDesignFromRoot(sessionRoot *os.Root, expectedID string) (Payload, error) {
	raw, err := security.ReadBoundedFileFromRoot(sessionRoot, DesignFileName, MaxDesignBytes)
	if err != nil {
		return Payload{}, err
	}
	var saved SavedDocument
	if err := json.Unmarshal(raw, &saved); err != nil {
		return Payload{}, fmt.Errorf("Invalid design file: %w", err)
	}
	if err := validateAssociation(saved.Association); err != nil {
		return Payload{}, err
	}
	if saved.Association.SessionID != expectedID {
		return Payload{}, errors.New("Design association mismatch")
	}
	if saved.Editing != nil {
		if err := validateEditingContext(*saved.Editing); err != nil {
			return Payload{}, err
		}
	}
	if saved.Assets == nil {
		saved.Assets = map[string]string{}
	}
	if _, _, err := ValidateContent(Content{Doc: saved.Doc, Assets: saved.Assets}); err != nil {
		return Payload{}, err
	}
	return Payload{
		Doc:         saved.Doc,
		Assets:      saved.Assets,
		Association: saved.Association,
		Editing:     saved.Editing,
		RevisionID:  DigestHex(raw),
	}, nil
}

func ValidateContent(content Content) (map[string]string, json.RawMessage, error) {
	rawDoc := bytes.TrimSpace(content.Doc)
	if len(rawDoc) == 0 || len(rawDoc) > MaxAssetValueBytes {
		return nil, nil, errors.New("design doc must be non-empty and at most 32 MiB")
	}
	if rawDoc[0] == '"' {
		var unquoted string
		if err := json.Unmarshal(rawDoc, &unquoted); err != nil {
			return nil, nil, fmt.Errorf("invalid string-encoded doc: %w", err)
		}
		rawDoc = []byte(strings.TrimSpace(unquoted))
	}

	var docMap map[string]any
	dec := json.NewDecoder(bytes.NewReader(rawDoc))
	dec.UseNumber()
	if err := dec.Decode(&docMap); err != nil {
		return nil, nil, fmt.Errorf("invalid doc JSON: %w", err)
	}
	if err := validateDocumentMap(docMap); err != nil {
		return nil, nil, err
	}

	required := make(map[string]bool)
	if err := walkDocumentRefs(docMap, 0, required); err != nil {
		return nil, nil, err
	}

	filtered := make(map[string]string, len(required))
	for key := range required {
		uri, ok := content.Assets[key]
		if !ok || len(uri) > MaxAssetValueBytes {
			return nil, nil, fmt.Errorf("Missing or unsupported asset: %s", key)
		}
		match := assetDataURIPattern.FindStringSubmatch(uri)
		if match == nil {
			return nil, nil, fmt.Errorf("Missing or unsupported asset: %s", key)
		}
		declaredMIME := match[1]
		decoded, err := base64.StdEncoding.DecodeString(match[2])
		if err != nil {
			return nil, nil, fmt.Errorf("Missing or unsupported asset: %s", key)
		}
		if err := validateAssetBytes(declaredMIME, decoded); err != nil {
			return nil, nil, err
		}
		if DigestHex(decoded) != key {
			return nil, nil, fmt.Errorf("Asset checksum mismatch: %s", key)
		}
		filtered[key] = uri
	}

	normalizedDoc, err := normalizeDocumentJSON(rawDoc)
	if err != nil {
		return nil, nil, err
	}
	return filtered, normalizedDoc, nil
}

func validateDocumentMap(doc map[string]any) error {
	allowedTop := map[string]bool{
		"schemaVersion": true,
		"canvas":        true,
		"diagnostics":   true,
		"background":    true,
		"fonts":         true,
		"elements":      true,
	}
	for k := range doc {
		if !allowedTop[k] {
			return fmt.Errorf("unexpected top-level document key %q", k)
		}
	}
	sv, ok := asInt(doc["schemaVersion"])
	if !ok || sv != 4 {
		return errors.New("schemaVersion must be 4")
	}
	canvas, ok := doc["canvas"].(map[string]any)
	if !ok || len(canvas) != 2 {
		return errors.New("canvas must have width and height only")
	}
	cw, okW := asInt(canvas["width"])
	ch, okH := asInt(canvas["height"])
	if !okW || !okH || cw < 1 || cw > MaxCanvasEdge || ch < 1 || ch > MaxCanvasEdge {
		return errors.New("canvas dimensions must be integers in 1..4096")
	}
	if _, ok := doc["background"].(map[string]any); !ok {
		return errors.New("background must be an object")
	}
	if diagsRaw, exists := doc["diagnostics"]; exists {
		diags, ok := diagsRaw.([]any)
		if !ok || len(diags) > MaxDiagnostics {
			return errors.New("diagnostics must be an array of at most 1000 items")
		}
	}
	if fontsRaw, exists := doc["fonts"]; exists {
		fontsList, ok := fontsRaw.([]any)
		if !ok || len(fontsList) > MaxFonts {
			return errors.New("fonts must be an array of at most 100 entries")
		}
		for _, item := range fontsList {
			fm, ok := item.(map[string]any)
			if !ok {
				return errors.New("invalid font registration")
			}
			fam, _ := fm["family"].(string)
			src, _ := fm["src"].(string)
			if fam == "" || !assetRefPattern.MatchString(src) {
				return errors.New("font registration requires non-empty family and asset:<sha256> src")
			}
		}
	}
	elems, ok := doc["elements"].([]any)
	if !ok || len(elems) > MaxElements {
		return errors.New("elements must be an array of at most 2000 items")
	}
	seenIDs := make(map[string]bool, len(elems))
	for _, item := range elems {
		em, ok := item.(map[string]any)
		if !ok {
			return errors.New("invalid element entry")
		}
		id, _ := em["id"].(string)
		if id == "" || utf8.RuneCountInString(id) > 200 {
			return errors.New("element id must be 1..200 characters")
		}
		if seenIDs[id] {
			return errors.New("Duplicate element IDs")
		}
		seenIDs[id] = true

		kind, _ := em["kind"].(string)
		if !allowedKinds[kind] {
			return fmt.Errorf("unsupported element kind %q", kind)
		}
		zIdx, okZ := asInt(em["zIndex"])
		if !okZ || zIdx < 0 {
			return errors.New("element zIndex must be a non-negative integer")
		}
		bounds, okB := em["bounds"].([]any)
		if !okB || len(bounds) != 4 {
			return errors.New("element bounds must be a 4-tuple")
		}
		for idx, bv := range bounds {
			f, okF := asFloat(bv)
			if !okF || math.IsNaN(f) || math.IsInf(f, 0) {
				return errors.New("element bounds must contain finite numbers")
			}
			if idx >= 2 && f <= 0 {
				return errors.New("element width and height must be positive")
			}
		}
	}
	return nil
}

func walkDocumentRefs(v any, depth int, required map[string]bool) error {
	if depth > MaxNestingDepth {
		return errors.New("Document nesting exceeds limit")
	}
	switch val := v.(type) {
	case string:
		if strings.HasPrefix(val, "asset:") {
			ref := val[len("asset:"):]
			if !sha256HexPattern.MatchString(ref) {
				return errors.New("External document resources are unsupported")
			}
			required[ref] = true
		}
	case []any:
		for _, item := range val {
			if err := walkDocumentRefs(item, depth+1, required); err != nil {
				return err
			}
		}
	case map[string]any:
		for k, item := range val {
			if k == "src" || k == "href" || k == "url" {
				if s, ok := item.(string); ok && !assetRefPattern.MatchString(s) {
					return errors.New("External document resources are unsupported")
				}
			}
			if err := walkDocumentRefs(item, depth+1, required); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateAssetBytes(declaredMIME string, data []byte) error {
	if strings.HasPrefix(declaredMIME, "image/") {
		decoded, err := imaging.InspectAndDecodeBounded(data, false)
		if err != nil {
			return err
		}
		if decoded.MIME != declaredMIME {
			return errors.New("Asset MIME does not match its bytes")
		}
		return nil
	}
	if len(data) < 4 || len(data) > imaging.MaxImageBytes {
		return errors.New("invalid font asset size")
	}
	var actual string
	switch {
	case bytes.Equal(data[:4], []byte{0x00, 0x01, 0x00, 0x00}) || string(data[:4]) == "true":
		actual = "font/ttf"
	case string(data[:4]) == "OTTO":
		actual = "font/otf"
	case string(data[:4]) == "wOFF":
		actual = "font/woff"
	case string(data[:4]) == "wOF2":
		actual = "font/woff2"
	default:
		return errors.New("unsupported font asset bytes")
	}
	if actual != declaredMIME {
		return errors.New("Asset MIME does not match its bytes")
	}
	return nil
}

func validateAssociation(a Association) error {
	if !uuidPattern.MatchString(a.SessionID) {
		return errors.New("invalid association.sessionId")
	}
	if strings.TrimSpace(a.Name) == "" || utf8.RuneCountInString(a.Name) > 200 {
		return errors.New("invalid association.name")
	}
	if a.UserID == "" || utf8.RuneCountInString(a.UserID) > 200 {
		return errors.New("invalid association.userId")
	}
	if a.MachineID == "" || utf8.RuneCountInString(a.MachineID) > 200 {
		return errors.New("invalid association.machineId")
	}
	if strings.TrimSpace(a.CreatedAt) == "" {
		return errors.New("invalid association.createdAt")
	}
	return nil
}

func validateEditingContext(e EditingContext) error {
	if !sha1HexPattern.MatchString(e.BaseVersionID) {
		return errors.New("invalid editing.baseVersionId")
	}
	if !sha256HexPattern.MatchString(e.ActionID) {
		return errors.New("invalid editing.actionId")
	}
	return nil
}

func marshalSavedDocument(saved SavedDocument) ([]byte, error) {
	if saved.Assets == nil {
		saved.Assets = map[string]string{}
	}
	return marshalJSONNoEscape(saved)
}

func markPendingDesign(dataRoot string, id string) error {
	pendingDir := filepath.Join(dataRoot, PendingDirName)
	if err := os.MkdirAll(pendingDir, 0o755); err != nil {
		return err
	}
	markerPath := filepath.Join(pendingDir, id)
	f, err := os.OpenFile(markerPath, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return syncDirectory(pendingDir)
}

func asInt(v any) (int, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	if err != nil {
		return 0, false
	}
	return int(i), true
}

func asFloat(v any) (float64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := n.Float64()
	if err != nil {
		return 0, false
	}
	return f, true
}
