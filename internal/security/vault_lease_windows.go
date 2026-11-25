package security

import (
	"errors"
	"golang.org/x/sys/windows"
)

func vaultPIDDead(pid int) bool {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return errors.Is(err, windows.ERROR_INVALID_PARAMETER)
	}
	defer windows.CloseHandle(h)
	status, err := windows.WaitForSingleObject(h, 0)
	return err == nil && status == windows.WAIT_OBJECT_0
}
