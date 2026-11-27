//go:build darwin

package ipc

import (
	"errors"
	"fmt"
	"net"
	"os"

	"golang.org/x/sys/unix"
)

func verifyPeer(conn net.Conn) error {
	uc, ok := conn.(*net.UnixConn)
	if !ok {
		return errors.New("expected unix domain connection")
	}
	raw, err := uc.SyscallConn()
	if err != nil {
		return fmt.Errorf("syscall conn: %w", err)
	}
	var cred *unix.Xucred
	var sockErr error
	if err := raw.Control(func(fd uintptr) {
		cred, sockErr = unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	}); err != nil {
		return fmt.Errorf("raw control: %w", err)
	}
	if sockErr != nil {
		return fmt.Errorf("read peer credentials: %w", sockErr)
	}
	if int(cred.Uid) != os.Geteuid() {
		return fmt.Errorf("peer uid %d does not match process euid %d", cred.Uid, os.Geteuid())
	}
	return nil
}
