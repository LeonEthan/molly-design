//go:build windows

package security

import (
	"errors"
	"os"
)

func openRegularNoFollow(path string) (*os.File, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("refusing to open symlink or non-regular file")
	}
	return os.Open(path)
}
