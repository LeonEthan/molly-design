//go:build !windows

package security

import (
	"errors"
	"syscall"
)

func vaultPIDDead(pid int) bool { return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) }
