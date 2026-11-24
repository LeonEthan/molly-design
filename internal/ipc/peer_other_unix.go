//go:build unix && !darwin && !linux

package ipc

import (
	"errors"
	"net"
)

func verifyPeer(conn net.Conn) error {
	if _, ok := conn.(*net.UnixConn); !ok {
		return errors.New("expected unix domain connection")
	}
	return nil
}
