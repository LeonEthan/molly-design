package security

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type PathRoot struct {
	Dir               string
	RejectSymlinkRoot bool
}

type ResolvedScopedFile struct {
	RootDir      string
	RelPath      string
	AbsolutePath string
}

func IsWithin(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	if rel == "." || rel == "" {
		return false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return !filepath.IsAbs(rel)
}

func ResolveAllowedFile(target string, baseDir string, roots []PathRoot, requireAbs bool) (ResolvedScopedFile, error) {
	if strings.TrimSpace(target) == "" {
		return ResolvedScopedFile{}, errors.New("path must not be empty")
	}
	if requireAbs && !filepath.IsAbs(target) {
		return ResolvedScopedFile{}, fmt.Errorf("path must be absolute: %s", target)
	}
	candidate := target
	if !filepath.IsAbs(candidate) {
		if baseDir == "" {
			return ResolvedScopedFile{}, errors.New("relative path requires a base directory")
		}
		candidate = filepath.Join(baseDir, candidate)
	}
	resolvedCandidate, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return ResolvedScopedFile{}, fmt.Errorf("resolve target path: %w", err)
	}
	resolvedCandidate, err = filepath.Abs(resolvedCandidate)
	if err != nil {
		return ResolvedScopedFile{}, fmt.Errorf("normalize target path: %w", err)
	}
	info, err := os.Lstat(resolvedCandidate)
	if err != nil {
		return ResolvedScopedFile{}, fmt.Errorf("stat target path: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ResolvedScopedFile{}, fmt.Errorf("target path is not a regular file: %s", target)
	}

	for _, root := range roots {
		if strings.TrimSpace(root.Dir) == "" {
			continue
		}
		absRoot, absErr := filepath.Abs(root.Dir)
		if absErr != nil {
			continue
		}
		if root.RejectSymlinkRoot {
			rootStat, lstatErr := os.Lstat(absRoot)
			if lstatErr != nil || rootStat.Mode()&os.ModeSymlink != 0 || !rootStat.IsDir() {
				continue
			}
		}
		resolvedRoot, evalErr := filepath.EvalSymlinks(absRoot)
		if evalErr != nil {
			continue
		}
		if root.RejectSymlinkRoot && resolvedRoot != absRoot {
			continue
		}
		if IsWithin(resolvedRoot, resolvedCandidate) {
			rel, relErr := filepath.Rel(resolvedRoot, resolvedCandidate)
			if relErr != nil {
				continue
			}
			return ResolvedScopedFile{
				RootDir:      resolvedRoot,
				RelPath:      rel,
				AbsolutePath: resolvedCandidate,
			}, nil
		}
	}
	return ResolvedScopedFile{}, fmt.Errorf("path is outside allowed directories: %s", target)
}

func ResolveAllowedFilePath(target string, baseDir string, roots []PathRoot, requireAbs bool) (string, error) {
	resolved, err := ResolveAllowedFile(target, baseDir, roots, requireAbs)
	if err != nil {
		return "", err
	}
	return resolved.AbsolutePath, nil
}

func OpenPathRoot(root PathRoot) (*os.Root, string, error) {
	if strings.TrimSpace(root.Dir) == "" {
		return nil, "", errors.New("root directory must not be empty")
	}
	absRoot, err := filepath.Abs(root.Dir)
	if err != nil {
		return nil, "", fmt.Errorf("normalize root directory: %w", err)
	}
	if root.RejectSymlinkRoot {
		parentDir := filepath.Dir(absRoot)
		baseName := filepath.Base(absRoot)
		if parentDir == absRoot || baseName == "" || baseName == "." || baseName == string(filepath.Separator) {
			return nil, "", fmt.Errorf("invalid root directory: %s", root.Dir)
		}
		parentRoot, err := os.OpenRoot(parentDir)
		if err != nil {
			return nil, "", fmt.Errorf("open parent root directory: %w", err)
		}
		defer parentRoot.Close()

		info, err := parentRoot.Lstat(baseName)
		if err != nil {
			return nil, "", err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return nil, "", fmt.Errorf("root directory cannot be a symlink: %s", root.Dir)
		}
		childRoot, err := parentRoot.OpenRoot(baseName)
		if err != nil {
			return nil, "", err
		}
		canonical, evalErr := filepath.EvalSymlinks(absRoot)
		if evalErr != nil {
			canonical = absRoot
		}
		return childRoot, canonical, nil
	}

	rootHandle, err := os.OpenRoot(absRoot)
	if err != nil {
		return nil, "", fmt.Errorf("open root directory: %w", err)
	}
	canonical, evalErr := filepath.EvalSymlinks(absRoot)
	if evalErr != nil {
		canonical = absRoot
	}
	return rootHandle, canonical, nil
}

func ReadBoundedFileFromRoot(root *os.Root, relPath string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, errors.New("maxBytes must be positive")
	}
	file, err := root.Open(relPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return readBoundedFromOpenFile(file, maxBytes)
}

func ReadAllowedFileBounded(target string, baseDir string, roots []PathRoot, requireAbs bool, maxBytes int64) (string, []byte, error) {
	if strings.TrimSpace(target) == "" {
		return "", nil, errors.New("path must not be empty")
	}
	if requireAbs && !filepath.IsAbs(target) {
		return "", nil, fmt.Errorf("path must be absolute: %s", target)
	}
	if maxBytes <= 0 {
		return "", nil, errors.New("maxBytes must be positive")
	}
	candidate := target
	if !filepath.IsAbs(candidate) {
		if baseDir == "" {
			return "", nil, errors.New("relative path requires a base directory")
		}
		candidate = filepath.Join(baseDir, candidate)
	}
	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return "", nil, fmt.Errorf("normalize target path: %w", err)
	}
	resolvedCandidate, evalCandidateErr := filepath.EvalSymlinks(absCandidate)
	if evalCandidateErr == nil {
		if absResolved, absErr := filepath.Abs(resolvedCandidate); absErr == nil {
			resolvedCandidate = absResolved
		}
	}

	var matchedNotExist error
	for _, root := range roots {
		if strings.TrimSpace(root.Dir) == "" {
			continue
		}
		absRoot, absErr := filepath.Abs(root.Dir)
		if absErr != nil {
			continue
		}
		rootHandle, canonicalRoot, openErr := OpenPathRoot(root)
		if openErr != nil {
			continue
		}
		data, resolvedAbs, matched, readErr := tryReadWithinOpenRoot(rootHandle, absRoot, canonicalRoot, absCandidate, resolvedCandidate, evalCandidateErr == nil, maxBytes)
		_ = rootHandle.Close()
		if matched {
			if readErr != nil {
				if os.IsNotExist(readErr) {
					matchedNotExist = readErr
					continue
				}
				return "", nil, readErr
			}
			return resolvedAbs, data, nil
		}
	}
	if matchedNotExist != nil {
		return "", nil, matchedNotExist
	}
	return "", nil, fmt.Errorf("path is outside allowed directories: %s", target)
}

func tryReadWithinOpenRoot(
	rootHandle *os.Root,
	absRoot string,
	canonicalRoot string,
	absCandidate string,
	resolvedCandidate string,
	hasResolved bool,
	maxBytes int64,
) ([]byte, string, bool, error) {
	if IsWithin(absRoot, absCandidate) {
		rel, err := filepath.Rel(absRoot, absCandidate)
		if err == nil {
			data, readErr := ReadBoundedFileFromRoot(rootHandle, rel, maxBytes)
			if readErr == nil {
				outPath := absCandidate
				if hasResolved {
					outPath = resolvedCandidate
				}
				return data, outPath, true, nil
			}
			if os.IsNotExist(readErr) {
				return nil, "", true, readErr
			}
		}
	}
	if hasResolved && IsWithin(canonicalRoot, resolvedCandidate) {
		rel, err := filepath.Rel(canonicalRoot, resolvedCandidate)
		if err == nil {
			data, readErr := ReadBoundedFileFromRoot(rootHandle, rel, maxBytes)
			return data, resolvedCandidate, true, readErr
		}
	}
	return nil, "", false, nil
}

func ReadBoundedFileInRoot(rootDir string, relPath string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, errors.New("maxBytes must be positive")
	}
	root, err := os.OpenRoot(rootDir)
	if err != nil {
		return nil, fmt.Errorf("open root directory: %w", err)
	}
	defer root.Close()
	return ReadBoundedFileFromRoot(root, relPath, maxBytes)
}

func ReadBoundedRegularFile(path string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, errors.New("maxBytes must be positive")
	}
	file, err := openRegularNoFollow(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return readBoundedFromOpenFile(file, maxBytes)
}

func readBoundedFromOpenFile(file *os.File, maxBytes int64) ([]byte, error) {
	before, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat file: %w", err)
	}
	if !before.Mode().IsRegular() {
		return nil, errors.New("refusing to read non-regular file")
	}
	if before.Size() > maxBytes {
		return nil, fmt.Errorf("file exceeds maximum allowed size of %d bytes", maxBytes)
	}

	limited := io.LimitReader(file, maxBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("file exceeds maximum allowed size of %d bytes", maxBytes)
	}

	after, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("restat file: %w", err)
	}
	if !after.Mode().IsRegular() || after.Size() != int64(len(data)) || !after.ModTime().Equal(before.ModTime()) {
		return nil, errors.New("file changed while reading")
	}
	return data, nil
}
