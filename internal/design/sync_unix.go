//go:build unix

package design

import (
	"os"
	"syscall"
)

func syncDirectory(dir string) error {
	f, err := os.OpenFile(dir, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
