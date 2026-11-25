//go:build darwin || linux

package shell

import (
	"context"
	"errors"
	"net"
)

func dialOwnedCLI(ctx context.Context, path string, pid int) (net.Conn, error) {
	var d net.Dialer
	c, err := d.DialContext(ctx, "unix", path)
	if err != nil {
		return nil, err
	}
	raw, err := c.(*net.UnixConn).SyscallConn()
	matches := false
	if err == nil {
		err = raw.Control(func(fd uintptr) { matches = matchesPeer(int(fd), pid) })
	}
	if err != nil || !matches {
		c.Close()
		return nil, errors.New("private_daemon_peer_mismatch")
	}
	return c, nil
}
