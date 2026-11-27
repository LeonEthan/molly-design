package gitstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/LeonEthan/molly-design/internal/design"
)

const (
	HistoryRepoName = "history.git"
	HistoryRef      = "refs/heads/main"
	ZeroOID         = "0000000000000000000000000000000000000000"
	DefaultTimeout  = 30 * time.Second
)

const (
	KindSaved         = "saved"
	KindBeforeRestore = "before-restore"
	KindBeforeAgent   = "before-agent"
)

var (
	uuidPattern   = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	sha1Pattern   = regexp.MustCompile(`^[a-f0-9]{40}$`)
	sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
	validKinds    = map[string]bool{
		KindSaved:         true,
		KindBeforeRestore: true,
		KindBeforeAgent:   true,
	}
)

func validateSessionID(sessionID string) error {
	if !uuidPattern.MatchString(sessionID) {
		return errors.New("invalid design sessionId")
	}
	return nil
}

type Version struct {
	CommitID         string `json:"commitId"`
	Number           int    `json:"number"`
	CreatedAt        string `json:"createdAt"`
	Kind             string `json:"kind"`
	BaseVersionID    string `json:"baseVersionId,omitempty"`
	ContentDigest    string `json:"contentDigest,omitempty"`
	SourceRevisionID string `json:"sourceRevisionId,omitempty"`
	ActionID         string `json:"actionId,omitempty"`
}

type versionDetails struct {
	BaseVersionID    string `json:"baseVersionId,omitempty"`
	ContentDigest    string `json:"contentDigest"`
	SourceRevisionID string `json:"sourceRevisionId"`
	ActionID         string `json:"actionId"`
}

type ReadVersionResult struct {
	Content design.Content `json:"content"`
	Version Version        `json:"version"`
}

type Store struct {
	GitBinary string
	Timeout   time.Duration
}

func New() *Store {
	return &Store{
		GitBinary: "git",
		Timeout:   DefaultTimeout,
	}
}

func ActionIdentity(operation string, baseline string, target string) string {
	raw, _ := json.Marshal([]string{operation, baseline, target})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (s *Store) RepoPath(dataRoot string, sessionID string) string {
	return filepath.Join(dataRoot, design.ChatsDirName, sessionID, HistoryRepoName)
}

func (s *Store) List(ctx context.Context, dataRoot string, sessionID string) ([]Version, error) {
	if err := validateSessionID(sessionID); err != nil {
		return nil, err
	}
	repo, err := s.validatedRepoPath(dataRoot, sessionID)
	if err != nil {
		return nil, err
	}
	avail, err := dirExistsNoSymlink(repo)
	if err != nil {
		return nil, err
	}
	if !avail {
		return []Version{}, nil
	}
	return s.listRepo(ctx, repo)
}

func (s *Store) Read(ctx context.Context, dataRoot string, sessionID string, commitID string) (design.Payload, error) {
	if err := validateSessionID(sessionID); err != nil {
		return design.Payload{}, err
	}
	if !sha1Pattern.MatchString(commitID) {
		return design.Payload{}, errors.New("invalid commitId")
	}
	repo, err := s.validatedRepoPath(dataRoot, sessionID)
	if err != nil {
		return design.Payload{}, err
	}
	current, err := design.ReadDesign(dataRoot, sessionID)
	if err != nil {
		return design.Payload{}, err
	}
	avail, err := dirExistsNoSymlink(repo)
	if err != nil {
		return design.Payload{}, err
	}
	if !avail {
		return design.Payload{}, errors.New("Design version not found")
	}
	historic, err := s.readRepoVersion(ctx, repo, commitID)
	if err != nil {
		return design.Payload{}, err
	}
	canon, err := design.CanonicalContentBytes(historic.Content.Doc, historic.Content.Assets)
	if err != nil {
		return design.Payload{}, err
	}
	return design.Payload{
		Doc:         historic.Content.Doc,
		Assets:      historic.Content.Assets,
		Association: current.Association,
		RevisionID:  design.DigestHex(canon),
	}, nil
}

func (s *Store) CreateVersion(
	ctx context.Context,
	dataRoot string,
	sessionID string,
	baseRevisionID string,
	timing design.LockTiming,
) (Version, error) {
	if err := validateSessionID(sessionID); err != nil {
		return Version{}, err
	}
	if !sha256Pattern.MatchString(baseRevisionID) {
		return Version{}, errors.New("invalid baseRevisionId")
	}
	repo, err := s.openRepoDir(dataRoot, sessionID)
	if err != nil {
		return Version{}, err
	}
	return design.WithDesignLock(ctx, repo, timing, func(assertHeld func() error) (Version, error) {
		lockedCurrent, err := design.ReadDesign(dataRoot, sessionID)
		if err != nil {
			return Version{}, err
		}
		versions, err := s.listIfInitialized(ctx, repo)
		if err != nil {
			return Version{}, err
		}
		curDigest, err := contentDigestOf(lockedCurrent.Doc, lockedCurrent.Assets)
		if err != nil {
			return Version{}, err
		}

		var prior *Version
		for i := range versions {
			if versions[i].Kind == KindSaved && versions[i].SourceRevisionID == baseRevisionID {
				prior = &versions[i]
				break
			}
		}
		if prior != nil &&
			lockedCurrent.Editing != nil &&
			lockedCurrent.Editing.ActionID == prior.ActionID &&
			lockedCurrent.Editing.BaseVersionID == prior.CommitID &&
			curDigest == prior.ContentDigest {
			return *prior, nil
		}
		if lockedCurrent.RevisionID != baseRevisionID {
			return Version{}, design.ErrDesignConflict
		}
		if err := s.initializeRepo(ctx, repo); err != nil {
			return Version{}, err
		}
		if lockedCurrent.Editing != nil {
			base, readErr := s.readRepoVersion(ctx, repo, lockedCurrent.Editing.BaseVersionID)
			if readErr != nil {
				return Version{}, readErr
			}
			baseDigest, digErr := contentDigestOf(base.Content.Doc, base.Content.Assets)
			if digErr != nil {
				return Version{}, digErr
			}
			if baseDigest == curDigest {
				return base.Version, nil
			}
		}

		var version Version
		if prior != nil {
			version = *prior
		} else {
			version, err = s.appendVersion(ctx, repo, lockedCurrent, KindSaved, assertHeld)
			if err != nil {
				return Version{}, err
			}
		}
		if err := assertHeld(); err != nil {
			return Version{}, err
		}
		_, err = design.SaveDesign(ctx, dataRoot, design.SaveRequest{
			SessionID:      sessionID,
			BaseRevisionID: lockedCurrent.RevisionID,
			Content:        design.Content{Doc: lockedCurrent.Doc, Assets: lockedCurrent.Assets},
			Editing: &design.EditingContext{
				BaseVersionID: version.CommitID,
				ActionID:      ActionIdentity(KindSaved, lockedCurrent.RevisionID, ""),
			},
		}, timing)
		if err != nil {
			return Version{}, err
		}
		return version, nil
	})
}

func (s *Store) RestoreVersion(
	ctx context.Context,
	dataRoot string,
	sessionID string,
	commitID string,
	baseRevisionID string,
	timing design.LockTiming,
) (design.Payload, error) {
	if err := validateSessionID(sessionID); err != nil {
		return design.Payload{}, err
	}
	if !sha1Pattern.MatchString(commitID) {
		return design.Payload{}, errors.New("invalid commitId")
	}
	if !sha256Pattern.MatchString(baseRevisionID) {
		return design.Payload{}, errors.New("invalid baseRevisionId")
	}
	repo, err := s.openRepoDir(dataRoot, sessionID)
	if err != nil {
		return design.Payload{}, err
	}
	return design.WithDesignLock(ctx, repo, timing, func(assertHeld func() error) (design.Payload, error) {
		lockedCurrent, err := design.ReadDesign(dataRoot, sessionID)
		if err != nil {
			return design.Payload{}, err
		}
		actionID := ActionIdentity("restore", baseRevisionID, commitID)
		historic, err := s.readRepoVersion(ctx, repo, commitID)
		if err != nil {
			return design.Payload{}, err
		}
		curDigest, err := contentDigestOf(lockedCurrent.Doc, lockedCurrent.Assets)
		if err != nil {
			return design.Payload{}, err
		}
		histDigest, err := contentDigestOf(historic.Content.Doc, historic.Content.Assets)
		if err != nil {
			return design.Payload{}, err
		}
		if lockedCurrent.Editing != nil &&
			lockedCurrent.Editing.BaseVersionID == commitID &&
			curDigest == histDigest &&
			(lockedCurrent.RevisionID == baseRevisionID || lockedCurrent.Editing.ActionID == actionID) {
			return lockedCurrent, nil
		}
		if lockedCurrent.RevisionID != baseRevisionID {
			return design.Payload{}, design.ErrDesignConflict
		}
		held, err := s.holdsContent(ctx, repo, lockedCurrent)
		if err != nil {
			return design.Payload{}, err
		}
		if !held {
			if _, err := s.appendVersion(ctx, repo, lockedCurrent, KindBeforeRestore, assertHeld); err != nil {
				return design.Payload{}, err
			}
		}
		if err := assertHeld(); err != nil {
			return design.Payload{}, err
		}
		return design.SaveDesign(ctx, dataRoot, design.SaveRequest{
			SessionID:      sessionID,
			BaseRevisionID: baseRevisionID,
			Content:        historic.Content,
			Editing: &design.EditingContext{
				BaseVersionID: commitID,
				ActionID:      actionID,
			},
		}, timing)
	})
}

func (s *Store) RecordBeforeAgent(
	ctx context.Context,
	dataRoot string,
	sessionID string,
	baseline design.Payload,
	timing design.LockTiming,
) (*Version, error) {
	if err := validateSessionID(sessionID); err != nil {
		return nil, err
	}
	if isBlankCanvasDoc(baseline.Doc) {
		return nil, nil
	}
	repo, err := s.openRepoDir(dataRoot, sessionID)
	if err != nil {
		return nil, err
	}
	return design.WithDesignLock(ctx, repo, timing, func(assertHeld func() error) (*Version, error) {
		if err := s.initializeRepo(ctx, repo); err != nil {
			return nil, err
		}
		held, err := s.holdsContent(ctx, repo, baseline)
		if err != nil {
			return nil, err
		}
		if held {
			return nil, nil
		}
		v, err := s.appendVersion(ctx, repo, baseline, KindBeforeAgent, assertHeld)
		if err != nil {
			return nil, err
		}
		return &v, nil
	})
}

func (s *Store) validatedRepoPath(dataRoot string, sessionID string) (string, error) {
	if err := validateSessionID(sessionID); err != nil {
		return "", err
	}
	absRoot, err := filepath.Abs(dataRoot)
	if err != nil {
		return "", err
	}
	rootHandle, err := os.OpenRoot(absRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return filepath.Join(absRoot, design.ChatsDirName, sessionID, HistoryRepoName), nil
		}
		return "", err
	}
	defer rootHandle.Close()

	chatsInfo, err := rootHandle.Lstat(design.ChatsDirName)
	if err != nil {
		if os.IsNotExist(err) {
			return filepath.Join(absRoot, design.ChatsDirName, sessionID, HistoryRepoName), nil
		}
		return "", err
	}
	if chatsInfo.Mode()&os.ModeSymlink != 0 || !chatsInfo.IsDir() {
		return "", errors.New("Design chats directory cannot be a symlink")
	}
	chatsRoot, err := rootHandle.OpenRoot(design.ChatsDirName)
	if err != nil {
		return "", err
	}
	defer chatsRoot.Close()

	chatInfo, err := chatsRoot.Lstat(sessionID)
	if err != nil {
		if os.IsNotExist(err) {
			return filepath.Join(absRoot, design.ChatsDirName, sessionID, HistoryRepoName), nil
		}
		return "", err
	}
	if chatInfo.Mode()&os.ModeSymlink != 0 || !chatInfo.IsDir() {
		return "", errors.New("Design workspace cannot be a symlink")
	}
	chatRoot, err := chatsRoot.OpenRoot(sessionID)
	if err != nil {
		return "", err
	}
	defer chatRoot.Close()

	if repoInfo, repoErr := chatRoot.Lstat(HistoryRepoName); repoErr == nil {
		if repoInfo.Mode()&os.ModeSymlink != 0 || !repoInfo.IsDir() {
			return "", errors.New("Design history directory is redirected")
		}
		repoRoot, openErr := chatRoot.OpenRoot(HistoryRepoName)
		if openErr != nil {
			return "", errors.New("Design history directory is redirected")
		}
		layoutErr := validateBareRepoLayout(repoRoot)
		_ = repoRoot.Close()
		if layoutErr != nil {
			return "", layoutErr
		}
	} else if !os.IsNotExist(repoErr) {
		return "", repoErr
	}
	return filepath.Join(absRoot, design.ChatsDirName, sessionID, HistoryRepoName), nil
}

func (s *Store) openRepoDir(dataRoot string, sessionID string) (string, error) {
	if err := validateSessionID(sessionID); err != nil {
		return "", err
	}
	absRoot, err := filepath.Abs(dataRoot)
	if err != nil {
		return "", err
	}
	rootHandle, err := os.OpenRoot(absRoot)
	if err != nil {
		return "", err
	}
	defer rootHandle.Close()

	chatsInfo, err := rootHandle.Lstat(design.ChatsDirName)
	if err != nil {
		return "", err
	}
	if chatsInfo.Mode()&os.ModeSymlink != 0 || !chatsInfo.IsDir() {
		return "", errors.New("Design chats directory cannot be a symlink")
	}
	chatsRoot, err := rootHandle.OpenRoot(design.ChatsDirName)
	if err != nil {
		return "", err
	}
	defer chatsRoot.Close()

	chatInfo, err := chatsRoot.Lstat(sessionID)
	if err != nil {
		return "", err
	}
	if chatInfo.Mode()&os.ModeSymlink != 0 || !chatInfo.IsDir() {
		return "", errors.New("Design workspace cannot be a symlink")
	}
	chatRoot, err := chatsRoot.OpenRoot(sessionID)
	if err != nil {
		return "", err
	}
	defer chatRoot.Close()

	if mkErr := chatRoot.Mkdir(HistoryRepoName, 0o755); mkErr != nil && !os.IsExist(mkErr) {
		return "", mkErr
	}
	repoInfo, err := chatRoot.Lstat(HistoryRepoName)
	if err != nil {
		return "", err
	}
	if repoInfo.Mode()&os.ModeSymlink != 0 || !repoInfo.IsDir() {
		return "", errors.New("Design history directory is redirected")
	}
	repoRoot, err := chatRoot.OpenRoot(HistoryRepoName)
	if err != nil {
		return "", errors.New("Design history directory is redirected")
	}
	layoutErr := validateBareRepoLayout(repoRoot)
	_ = repoRoot.Close()
	if layoutErr != nil {
		return "", layoutErr
	}
	return filepath.Join(absRoot, design.ChatsDirName, sessionID, HistoryRepoName), nil
}

func (s *Store) initializeRepo(ctx context.Context, repo string) error {
	hasObjects, err := dirExistsNoSymlink(filepath.Join(repo, "objects"))
	if err != nil {
		return err
	}
	if hasObjects {
		return nil
	}
	_, err = s.runGit(ctx, repo, []string{"init", "--bare", "--template=", "--object-format=sha1", "."}, nil)
	return err
}

func (s *Store) listIfInitialized(ctx context.Context, repo string) ([]Version, error) {
	hasObjects, err := dirExistsNoSymlink(filepath.Join(repo, "objects"))
	if err != nil || !hasObjects {
		return []Version{}, err
	}
	return s.listRepo(ctx, repo)
}

func (s *Store) headOID(ctx context.Context, repo string) (string, error) {
	out, err := s.runGit(ctx, repo, []string{"for-each-ref", "--format=%(objectname)", HistoryRef}, nil)
	if err != nil {
		return "", err
	}
	trimmed := strings.TrimSpace(out)
	if trimmed == "" {
		return "", nil
	}
	if !sha1Pattern.MatchString(trimmed) {
		return "", fmt.Errorf("invalid head commit id %q", trimmed)
	}
	return trimmed, nil
}

func (s *Store) listRepo(ctx context.Context, repo string) ([]Version, error) {
	head, err := s.headOID(ctx, repo)
	if err != nil || head == "" {
		return []Version{}, err
	}
	out, err := s.runGit(ctx, repo, []string{
		"log", "--reverse", "--first-parent", "--format=%H%x09%ct%x09%s%x09%b", HistoryRef, "--",
	}, nil)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	versions := make([]Version, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 3 {
			return nil, errors.New("Invalid design history entry")
		}
		hash := parts[0]
		secStr := parts[1]
		kind := parts[2]
		body := ""
		if len(parts) == 4 {
			body = strings.TrimSpace(parts[3])
		}
		if !sha1Pattern.MatchString(hash) || !validKinds[kind] {
			return nil, errors.New("Invalid design history entry")
		}
		sec, parseErr := strconv.ParseInt(secStr, 10, 64)
		if parseErr != nil || sec < 0 {
			return nil, errors.New("Invalid design history timestamp")
		}
		v := Version{
			CommitID:  hash,
			Number:    len(versions) + 1,
			CreatedAt: time.Unix(sec, 0).UTC().Format("2006-01-02T15:04:05.000Z"),
			Kind:      kind,
		}
		if body != "" {
			var det versionDetails
			if jsonErr := json.Unmarshal([]byte(body), &det); jsonErr != nil {
				return nil, fmt.Errorf("Invalid design history metadata: %w", jsonErr)
			}
			v.BaseVersionID = det.BaseVersionID
			v.ContentDigest = det.ContentDigest
			v.SourceRevisionID = det.SourceRevisionID
			v.ActionID = det.ActionID
		}
		versions = append(versions, v)
	}
	return versions, nil
}

func (s *Store) readRepoVersion(ctx context.Context, repo string, commitID string) (ReadVersionResult, error) {
	versions, err := s.listRepo(ctx, repo)
	if err != nil {
		return ReadVersionResult{}, err
	}
	var entry *Version
	for i := range versions {
		if versions[i].CommitID == commitID {
			entry = &versions[i]
			break
		}
	}
	if entry == nil {
		return ReadVersionResult{}, errors.New("Design version not found")
	}
	raw, err := s.runGit(ctx, repo, []string{"show", commitID + ":" + design.DesignFileName}, nil)
	if err != nil {
		return ReadVersionResult{}, err
	}
	var content design.Content
	if err := json.Unmarshal([]byte(raw), &content); err != nil {
		return ReadVersionResult{}, errors.New("Invalid design version content")
	}
	if content.Assets == nil {
		content.Assets = map[string]string{}
	}
	if _, _, err := design.ValidateContent(content); err != nil {
		return ReadVersionResult{}, errors.New("Invalid design version content")
	}
	return ReadVersionResult{Content: content, Version: *entry}, nil
}

func (s *Store) holdsContent(ctx context.Context, repo string, payload design.Payload) (bool, error) {
	canon, err := design.CanonicalContentBytes(payload.Doc, payload.Assets)
	if err != nil {
		return false, err
	}
	blobOut, err := s.runGit(ctx, repo, []string{"hash-object", "--stdin"}, canon)
	if err != nil {
		return false, err
	}
	blob := strings.TrimSpace(blobOut)
	head, err := s.headOID(ctx, repo)
	if err != nil || head == "" {
		return false, err
	}
	reachable, err := s.runGit(ctx, repo, []string{"rev-list", "--objects", HistoryRef, "--"}, nil)
	if err != nil {
		return false, err
	}
	for _, line := range strings.Split(reachable, "\n") {
		if field := strings.SplitN(line, " ", 2)[0]; field == blob {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) appendVersion(
	ctx context.Context,
	repo string,
	payload design.Payload,
	kind string,
	assertHeld func() error,
) (Version, error) {
	parent, err := s.headOID(ctx, repo)
	if err != nil {
		return Version{}, err
	}
	canon, err := design.CanonicalContentBytes(payload.Doc, payload.Assets)
	if err != nil {
		return Version{}, err
	}
	blobOut, err := s.runGit(ctx, repo, []string{"hash-object", "-w", "--stdin"}, canon)
	if err != nil {
		return Version{}, err
	}
	blob := strings.TrimSpace(blobOut)
	if !sha1Pattern.MatchString(blob) {
		return Version{}, errors.New("invalid blob oid")
	}
	treeIn := fmt.Sprintf("100644 blob %s\t%s\n", blob, design.DesignFileName)
	treeOut, err := s.runGit(ctx, repo, []string{"mktree"}, []byte(treeIn))
	if err != nil {
		return Version{}, err
	}
	tree := strings.TrimSpace(treeOut)
	if !sha1Pattern.MatchString(tree) {
		return Version{}, errors.New("invalid tree oid")
	}

	details := versionDetails{
		ContentDigest:    design.DigestHex(canon),
		SourceRevisionID: payload.RevisionID,
		ActionID:         ActionIdentity(kind, payload.RevisionID, ""),
	}
	if payload.Editing != nil {
		details.BaseVersionID = payload.Editing.BaseVersionID
	}
	detailsJSON, _ := json.Marshal(details)
	msg := fmt.Sprintf("%s\n\n%s\n", kind, string(detailsJSON))

	args := []string{"commit-tree", tree}
	if parent != "" {
		args = append(args, "-p", parent)
	}
	commitOut, err := s.runGit(ctx, repo, args, []byte(msg))
	if err != nil {
		return Version{}, err
	}
	commit := strings.TrimSpace(commitOut)
	if !sha1Pattern.MatchString(commit) {
		return Version{}, errors.New("invalid commit oid")
	}

	if err := assertHeld(); err != nil {
		return Version{}, err
	}
	oldRef := parent
	if oldRef == "" {
		oldRef = ZeroOID
	}
	if _, err := s.runGit(ctx, repo, []string{"update-ref", HistoryRef, commit, oldRef}, nil); err != nil {
		return Version{}, err
	}
	versions, err := s.listRepo(ctx, repo)
	if err != nil || len(versions) == 0 {
		if err != nil {
			return Version{}, err
		}
		return Version{}, errors.New("Design version disappeared")
	}
	return versions[len(versions)-1], nil
}

func (s *Store) runGit(ctx context.Context, repo string, args []string, stdin []byte) (string, error) {
	timeout := s.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	if ok, checkErr := dirExistsNoSymlink(repo); checkErr != nil || !ok {
		if checkErr != nil {
			return "", checkErr
		}
		return "", errors.New("Design history directory does not exist")
	}
	repoRoot, openErr := os.OpenRoot(repo)
	if openErr != nil {
		return "", openErr
	}
	layoutErr := validateBareRepoLayout(repoRoot)
	_ = repoRoot.Close()
	if layoutErr != nil {
		return "", layoutErr
	}
	bin := s.GitBinary
	if bin == "" {
		bin = "git"
	}
	isInit := len(args) > 0 && args[0] == "init"
	baseArgs := []string{"-c", "core.hooksPath=" + os.DevNull, "-c", "core.symlinks=false"}
	if !isInit {
		baseArgs = append([]string{"--git-dir", "."}, baseArgs...)
	}
	fullArgs := append(baseArgs, args...)
	cmd := exec.CommandContext(runCtx, bin, fullArgs...)
	cmd.Dir = repo
	cmd.Env = isolatedGitEnv(!isInit)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s failed: %w (%s)", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

func isolatedGitEnv(pinRepoDirs bool) []string {
	env := make([]string, 0, len(os.Environ())+12)
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "GIT_") {
			continue
		}
		env = append(env, kv)
	}
	env = append(env,
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_CONFIG_GLOBAL="+os.DevNull,
		"GIT_TERMINAL_PROMPT=0",
		"GIT_AUTHOR_NAME=Molly",
		"GIT_AUTHOR_EMAIL=molly@localhost",
		"GIT_COMMITTER_NAME=Molly",
		"GIT_COMMITTER_EMAIL=molly@localhost",
	)
	if pinRepoDirs {
		env = append(env,
			"GIT_DIR=.",
			"GIT_COMMON_DIR=.",
			"GIT_OBJECT_DIRECTORY=./objects",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES=",
		)
	}
	return env
}

func validateBareRepoLayout(repoRoot *os.Root) error {
	for _, forbidden := range []string{
		"commondir",
		".git",
		"objects/info/alternates",
		"objects/info/http-alternates",
	} {
		if _, err := repoRoot.Lstat(forbidden); err == nil {
			return fmt.Errorf("Design history repository contains forbidden %s entry", forbidden)
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	return walkRepoDirNoSymlinks(repoRoot, ".", 0)
}

func walkRepoDirNoSymlinks(root *os.Root, relDir string, depth int) error {
	if depth > 8 {
		return errors.New("Design history repository nesting exceeds limit")
	}
	dirFile, err := root.Open(relDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	entries, err := dirFile.ReadDir(-1)
	_ = dirFile.Close()
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		childRel := name
		if relDir != "." {
			childRel = relDir + "/" + name
		}
		lowerRel := strings.ToLower(childRel)
		if lowerRel == "commondir" || lowerRel == ".git" ||
			lowerRel == "objects/info/alternates" || lowerRel == "objects/info/http-alternates" {
			return fmt.Errorf("Design history repository cannot use %s", childRel)
		}
		info, lstatErr := root.Lstat(childRel)
		if lstatErr != nil {
			if os.IsNotExist(lstatErr) {
				continue
			}
			return lstatErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("Design history directory is redirected")
		}
		if info.IsDir() {
			if err := walkRepoDirNoSymlinks(root, childRel, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func dirExistsNoSymlink(path string) (bool, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return false, errors.New("Design history directory is redirected")
	}
	return true, nil
}

func contentDigestOf(doc json.RawMessage, assets map[string]string) (string, error) {
	canon, err := design.CanonicalContentBytes(doc, assets)
	if err != nil {
		return "", err
	}
	return design.DigestHex(canon), nil
}

func isBlankCanvasDoc(doc json.RawMessage) bool {
	var parsed struct {
		Elements []json.RawMessage `json:"elements"`
	}
	if err := json.Unmarshal(doc, &parsed); err != nil {
		return false
	}
	return len(parsed.Elements) == 0
}
