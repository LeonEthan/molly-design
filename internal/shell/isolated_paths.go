package shell

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/LeonEthan/molly-design/internal/security"
)

const experimentalMarker = ".molly-mygo-experimental"

func canonicalDirectory(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("missing_data_directory")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	ancestor := abs
	for {
		_, err = os.Lstat(ancestor)
		if err == nil {
			break
		}
		if !errors.Is(err, fs.ErrNotExist) || ancestor == filepath.Dir(ancestor) {
			return "", err
		}
		ancestor = filepath.Dir(ancestor)
	}
	real, err := filepath.EvalSymlinks(ancestor)
	if err != nil {
		return "", err
	}
	tail, err := filepath.Rel(ancestor, abs)
	if err != nil {
		return "", err
	}
	return filepath.Join(real, tail), nil
}

func randomHex(n int) string { b := make([]byte, n); rand.Read(b); return hex.EncodeToString(b) }

func canonicalEndpoints(canonical string) (string, int) {
	h := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(h[:8]), 20000 + int(binary.BigEndian.Uint32(h[:4])%40000)
}

func containsDirectory(parent, child string) bool {
	info, _ := os.Stat(parent)
	for {
		if parent == child || ((runtime.GOOS == "darwin" || runtime.GOOS == "windows") && strings.EqualFold(parent, child)) {
			return true
		}
		if info != nil {
			if candidate, e := os.Stat(child); e == nil && os.SameFile(info, candidate) {
				return true
			}
		}
		next := filepath.Dir(child)
		if child == next {
			return false
		}
		child = next
	}
}

func ValidateIsolatedShellPaths(dataDir string) error {
	canonical, err := canonicalDirectory(dataDir)
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	protected := []string{filepath.Join(home, ".molly"), filepath.Join(home, ".lody"), filepath.Join(home, ".molly-preview"), filepath.Join(config, "Molly Design"), filepath.Join(config, "Molly Preview"), os.Getenv("MOLLY_ELECTRON_USER_DATA_DIR"), os.Getenv("LODY_ELECTRON_USER_DATA_DIR")}
	for _, path := range protected {
		if strings.TrimSpace(path) == "" {
			continue
		}
		target, err := canonicalDirectory(path)
		if err != nil {
			return err
		}
		if containsDirectory(target, canonical) || containsDirectory(canonical, target) {
			return errors.New("refusing_non_experimental_data_dir")
		}
	}
	if err = os.MkdirAll(dataDir, 0700); err != nil {
		return err
	}
	root, _, err := security.OpenPathRoot(security.PathRoot{Dir: dataDir, RejectSymlinkRoot: true})
	if err != nil {
		return err
	}
	defer root.Close()
	entries, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		info, err := root.Lstat(entry.Name())
		if err != nil {
			return err
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			return errors.New("isolated_data_path_symlink")
		}
	}
	if len(entries) != 0 {
		marker, err := root.Lstat(experimentalMarker)
		if err != nil || !marker.Mode().IsRegular() {
			return errors.New("refusing_non_experimental_data_dir")
		}
	}
	if runtime.GOOS != "windows" {
		if err := probeVolume(root, canonical); err != nil {
			return fmt.Errorf("unsupported_data_dir_filesystem: %w", err)
		}
	}
	if len(entries) == 0 {
		f, err := root.OpenFile(experimentalMarker, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err == nil {
			if err = f.Close(); err != nil {
				return err
			}
		} else if !errors.Is(err, fs.ErrExist) {
			return err
		}
	}
	marker, err := root.Lstat(experimentalMarker)
	if err != nil || !marker.Mode().IsRegular() || (runtime.GOOS != "windows" && marker.Mode().Perm() != 0600) {
		return errors.New("refusing_non_experimental_data_dir")
	}
	return nil
}

func probeVolume(root *os.Root, path string) error {
	name := ".probe-" + randomHex(5)
	f, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(name)
	info, err := f.Stat()
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if info.Mode().Perm() != 0600 {
		return errors.New("private mode unsupported")
	}
	if err = root.Link(name, name+".link"); err != nil {
		return err
	}
	defer root.Remove(name + ".link")
	socket, err := net.Listen("unix", filepath.Join(path, name+".s"))
	if err != nil {
		return err
	}
	return socket.Close()
}
