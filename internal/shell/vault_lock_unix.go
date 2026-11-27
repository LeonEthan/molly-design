//go:build darwin || linux

package shell

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockVault(f *os.File) error {
	err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if err == unix.EWOULDBLOCK {
		return os.ErrExist
	}
	return err
}
