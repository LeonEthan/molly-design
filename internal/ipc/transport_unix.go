//go:build unix

package ipc

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type unixSocketListener struct {
	net.Listener
	path  string
	dev   uint64
	ino   uint64
	hasID bool
	once  sync.Once
}

func (l *unixSocketListener) Close() error {
	var err error
	l.once.Do(func() {
		if ul, ok := l.Listener.(*net.UnixListener); ok {
			ul.SetUnlinkOnClose(false)
		}
		err = l.Listener.Close()
		lockFile, lockErr := os.OpenFile(l.path+".lock", os.O_CREATE|os.O_RDWR, 0o600)
		if lockErr != nil {
			return
		}
		defer lockFile.Close()
		if flockErr := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX); flockErr != nil {
			return
		}
		defer func() { _ = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN) }()
		if info, statErr := os.Lstat(l.path); statErr == nil && info.Mode()&os.ModeSocket != 0 {
			if !l.hasID {
				_ = os.Remove(l.path)
			} else if st, ok := info.Sys().(*syscall.Stat_t); ok && uint64(st.Dev) == l.dev && st.Ino == l.ino {
				_ = os.Remove(l.path)
			}
		}
	})
	return err
}

func listenLocal(socketPath string) (net.Listener, error) {
	if socketPath == "" {
		return nil, errors.New("socket path must not be empty")
	}
	dir := filepath.Dir(socketPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create socket directory: %w", err)
	}
	if err := verifyPrivateSocketDir(dir); err != nil {
		return nil, err
	}
	lockPath := socketPath + ".lock"
	lockFile, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open socket bind lock: %w", err)
	}
	defer lockFile.Close()
	if err := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX); err != nil {
		return nil, fmt.Errorf("acquire socket bind lock: %w", err)
	}
	defer func() { _ = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN) }()

	if info, err := os.Lstat(socketPath); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("refusing to replace non-socket path: %s", socketPath)
		}
		if probe, dialErr := net.DialTimeout("unix", socketPath, 200*time.Millisecond); dialErr == nil {
			_ = probe.Close()
			return nil, fmt.Errorf("ipc socket already active: %s", socketPath)
		}
		if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("remove stale socket: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("listen unix socket: %w", err)
	}
	if ul, ok := ln.(*net.UnixListener); ok {
		ul.SetUnlinkOnClose(false)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = ln.Close()
		_ = os.Remove(socketPath)
		return nil, fmt.Errorf("chmod unix socket: %w", err)
	}
	wrapped := &unixSocketListener{
		Listener: ln,
		path:     socketPath,
	}
	if info, statErr := os.Lstat(socketPath); statErr == nil {
		if st, ok := info.Sys().(*syscall.Stat_t); ok {
			wrapped.dev = uint64(st.Dev)
			wrapped.ino = st.Ino
			wrapped.hasID = true
		}
	}
	return wrapped, nil
}

func verifyPrivateSocketDir(dir string) error {
	info, err := os.Lstat(dir)
	if err != nil {
		return fmt.Errorf("stat socket directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("socket directory must be a real directory: %s", dir)
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return errors.New("unable to verify socket directory ownership")
	}
	if int(st.Uid) != os.Geteuid() {
		return fmt.Errorf("socket directory uid %d does not match process euid %d", st.Uid, os.Geteuid())
	}
	if info.Mode().Perm()&0o077 != 0 {
		if err := os.Chmod(dir, 0o700); err != nil {
			return fmt.Errorf("tighten socket directory permissions: %w", err)
		}
	}
	return nil
}

func dialLocal(ctx context.Context, socketPath string) (net.Conn, error) {
	var d net.Dialer
	return d.DialContext(ctx, "unix", socketPath)
}
