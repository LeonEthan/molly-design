package fonts

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unicode"

	"github.com/LeonEthan/molly-design/internal/security"
	"github.com/go-text/typesetting/font"
	ot "github.com/go-text/typesetting/font/opentype"
	"github.com/go-text/typesetting/font/opentype/tables"
)

const MaxFontFileBytes = 64 << 20

var (
	ErrFaceNotFound = errors.New("font face not found")
	allowedFontExts = map[string]bool{
		".ttf": true,
		".otf": true,
		".ttc": true,
	}
)

func SystemFontDirectories() []string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		dirs := []string{"/System/Library/Fonts", "/Library/Fonts"}
		if home != "" {
			dirs = append(dirs, filepath.Join(home, "Library", "Fonts"))
		}
		return dirs
	case "windows":
		var dirs []string
		if winDir := os.Getenv("WINDIR"); winDir != "" {
			dirs = append(dirs, filepath.Join(winDir, "Fonts"))
		}
		if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
			dirs = append(dirs, filepath.Join(localAppData, "Microsoft", "Windows", "Fonts"))
		}
		return dirs
	default:
		dirs := []string{"/usr/share/fonts", "/usr/local/share/fonts"}
		if home != "" {
			dirs = append(dirs,
				filepath.Join(home, ".local", "share", "fonts"),
				filepath.Join(home, ".fonts"),
			)
		}
		return dirs
	}
}

func ResolveAllowedFont(filePath string, workdir string, extraSystemDirs []string) (security.ResolvedScopedFile, error) {
	if !filepath.IsAbs(filePath) {
		return security.ResolvedScopedFile{}, errors.New("Font file path must be absolute.")
	}
	resolved, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		return security.ResolvedScopedFile{}, errors.New("Font path is outside the system font directories and this design session.")
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return security.ResolvedScopedFile{}, errors.New("Font path is outside the system font directories and this design session.")
	}

	rootDirs := make([]string, 0, 8)
	if strings.TrimSpace(workdir) != "" {
		rootDirs = append(rootDirs, workdir)
	}
	sysDirs := extraSystemDirs
	if len(sysDirs) == 0 {
		sysDirs = SystemFontDirectories()
	}
	rootDirs = append(rootDirs, sysDirs...)

	var matchedRoot string
	for _, d := range rootDirs {
		if strings.TrimSpace(d) == "" {
			continue
		}
		resolvedRoot, evalErr := filepath.EvalSymlinks(d)
		if evalErr != nil {
			continue
		}
		if security.IsWithin(resolvedRoot, resolved) {
			matchedRoot = resolvedRoot
			break
		}
	}
	if matchedRoot == "" {
		return security.ResolvedScopedFile{}, errors.New("Font path is outside the system font directories and this design session.")
	}
	if !hasAllowedFontExtension(filePath) || !hasAllowedFontExtension(resolved) {
		return security.ResolvedScopedFile{}, errors.New("Font file must be .ttf, .otf or .ttc.")
	}
	info, statErr := os.Stat(resolved)
	if statErr != nil || !info.Mode().IsRegular() {
		return security.ResolvedScopedFile{}, errors.New("Font path must be a regular file.")
	}
	rel, relErr := filepath.Rel(matchedRoot, resolved)
	if relErr != nil {
		return security.ResolvedScopedFile{}, errors.New("Font path is outside the system font directories and this design session.")
	}
	return security.ResolvedScopedFile{
		RootDir:      matchedRoot,
		RelPath:      rel,
		AbsolutePath: resolved,
	}, nil
}

func ReadAllowedFont(filePath string, workdir string, extraSystemDirs []string) ([]byte, error) {
	if !filepath.IsAbs(filePath) {
		return nil, errors.New("Font file path must be absolute.")
	}
	roots := make([]security.PathRoot, 0, 8)
	if strings.TrimSpace(workdir) != "" {
		roots = append(roots, security.PathRoot{Dir: workdir})
	}
	sysDirs := extraSystemDirs
	if len(sysDirs) == 0 {
		sysDirs = SystemFontDirectories()
	}
	for _, d := range sysDirs {
		if strings.TrimSpace(d) != "" {
			roots = append(roots, security.PathRoot{Dir: d})
		}
	}
	resolvedAbs, data, err := security.ReadAllowedFileBounded(filePath, workdir, roots, true, MaxFontFileBytes)
	if err != nil {
		if strings.Contains(err.Error(), "non-regular") {
			return nil, errors.New("Font path must be a regular file.")
		}
		return nil, errors.New("Font path is outside the system font directories and this design session.")
	}
	if !hasAllowedFontExtension(filePath) || !hasAllowedFontExtension(resolvedAbs) {
		return nil, errors.New("Font file must be .ttf, .otf or .ttc.")
	}
	return data, nil
}

func ResolveAllowedFontPath(filePath string, workdir string, extraSystemDirs []string) (string, error) {
	scoped, err := ResolveAllowedFont(filePath, workdir, extraSystemDirs)
	if err != nil {
		return "", err
	}
	return scoped.AbsolutePath, nil
}

func hasAllowedFontExtension(p string) bool {
	return allowedFontExts[strings.ToLower(filepath.Ext(p))]
}

func NormalizeFaceName(name string) string {
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range strings.ToLower(name) {
		if unicode.IsSpace(r) || r == '-' || r == '_' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

const (
	nameIDFamily             tables.NameID = 1
	nameIDSubfamily          tables.NameID = 2
	nameIDFull               tables.NameID = 4
	nameIDPostscript         tables.NameID = 6
	nameIDPreferredFamily    tables.NameID = 16
	nameIDPreferredSubfamily tables.NameID = 17
)

func LoadMatchedFace(fontBytes []byte, requestedFace string) (*font.Face, error) {
	want := NormalizeFaceName(requestedFace)
	if want == "" {
		return nil, errors.New("font face name must not be empty")
	}

	loaders, err := ot.NewLoaders(bytes.NewReader(fontBytes))
	if err != nil || len(loaders) == 0 {
		return nil, fmt.Errorf("parse font file: %w", err)
	}

	nameTag := ot.MustNewTag("name")
	validTables := 0
	for _, ld := range loaders {
		rawName, tableErr := ld.RawTable(nameTag)
		if tableErr != nil {
			continue
		}
		nameTable, _, parseErr := tables.ParseName(rawName)
		if parseErr != nil {
			continue
		}
		validTables++
		if matchesOpenTypeNameTable(nameTable, want) {
			f, fontErr := font.NewFont(ld)
			if fontErr != nil {
				return nil, fmt.Errorf("load font face %q: %w", requestedFace, fontErr)
			}
			return font.NewFace(f), nil
		}
	}
	if validTables == 0 {
		return nil, errors.New("font file contains no readable name table")
	}
	return nil, fmt.Errorf("%w: %s", ErrFaceNotFound, requestedFace)
}

func matchesOpenTypeNameTable(nameTable tables.Name, wantNormalized string) bool {
	ids := []tables.NameID{
		nameIDFamily,
		nameIDFull,
		nameIDPostscript,
		nameIDPreferredFamily,
	}
	for _, id := range ids {
		if val := nameTable.Name(id); val != "" && NormalizeFaceName(val) == wantNormalized {
			return true
		}
	}
	family := nameTable.Name(nameIDFamily)
	subfamily := nameTable.Name(nameIDSubfamily)
	if family != "" && subfamily != "" && NormalizeFaceName(family+" "+subfamily) == wantNormalized {
		return true
	}
	prefFamily := nameTable.Name(nameIDPreferredFamily)
	prefSub := nameTable.Name(nameIDPreferredSubfamily)
	if prefFamily != "" && prefSub != "" && NormalizeFaceName(prefFamily+" "+prefSub) == wantNormalized {
		return true
	}
	return false
}
