package shell

import (
	"golang.org/x/sys/windows"
	"os"
)

func lockVault(f *os.File) error {
	err := windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{})
	if err == windows.ERROR_LOCK_VIOLATION {
		return os.ErrExist
	}
	return err
}
