//go:build unix

package security

import (
	"os"
	"syscall"
)

func openRegularNoFollow(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
}

func openFileInRootNonBlock(root *os.Root, relPath string) (*os.File, error) {
	info, err := root.Lstat(relPath)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, os.ErrInvalid
	}
	return root.OpenFile(relPath, os.O_RDONLY|syscall.O_NONBLOCK, 0)
}
