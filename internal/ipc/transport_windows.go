//go:build windows

package ipc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modKernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procGetNamedPipeClientProcID = modKernel32.NewProc("GetNamedPipeClientProcessId")
	procGetNamedPipeServerProcID = modKernel32.NewProc("GetNamedPipeServerProcessId")
)

type pipeAddr string

func (a pipeAddr) Network() string { return "pipe" }
func (a pipeAddr) String() string  { return string(a) }

type namedPipeListener struct {
	name          string
	sd            *windows.SECURITY_DESCRIPTOR
	closeEvent    windows.Handle
	mu            sync.Mutex
	closed        bool
	firstInstance bool
	acceptWG      sync.WaitGroup
}

func listenLocal(pipeName string) (net.Listener, error) {
	if !strings.HasPrefix(pipeName, `\\.\pipe\`) {
		return nil, fmt.Errorf("windows ipc address must be a named pipe (\\\\.\\pipe\\...): %s", pipeName)
	}
	sd, err := windows.SecurityDescriptorFromString("D:(A;;GA;;;OW)")
	if err != nil {
		return nil, fmt.Errorf("create owner-only pipe security descriptor: %w", err)
	}
	closeEv, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("create listener close event: %w", err)
	}
	return &namedPipeListener{
		name:          pipeName,
		sd:            sd,
		closeEvent:    closeEv,
		firstInstance: true,
	}, nil
}

func (l *namedPipeListener) Accept() (net.Conn, error) {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil, net.ErrClosed
	}
	l.acceptWG.Add(1)
	defer l.acceptWG.Done()
	openMode := uint32(windows.PIPE_ACCESS_DUPLEX | windows.FILE_FLAG_OVERLAPPED)
	if l.firstInstance {
		openMode |= windows.FILE_FLAG_FIRST_PIPE_INSTANCE
		l.firstInstance = false
	}
	l.mu.Unlock()

	namePtr, err := windows.UTF16PtrFromString(l.name)
	if err != nil {
		return nil, err
	}
	sa := windows.SecurityAttributes{
		Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		SecurityDescriptor: l.sd,
	}
	handle, err := windows.CreateNamedPipe(
		namePtr,
		openMode,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|windows.PIPE_REJECT_REMOTE_CLIENTS,
		windows.PIPE_UNLIMITED_INSTANCES,
		64*1024,
		64*1024,
		0,
		&sa,
	)
	if err != nil {
		return nil, err
	}

	ev, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	defer windows.CloseHandle(ev)

	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		_ = windows.CloseHandle(handle)
		return nil, net.ErrClosed
	}
	l.mu.Unlock()

	var ov windows.Overlapped
	ov.HEvent = ev
	err = windows.ConnectNamedPipe(handle, &ov)
	if errors.Is(err, windows.ERROR_IO_PENDING) {
		waitRes, waitErr := windows.WaitForMultipleObjects([]windows.Handle{ev, l.closeEvent}, false, windows.INFINITE)
		if waitErr != nil {
			_ = windows.CancelIoEx(handle, &ov)
			var n uint32
			_ = windows.GetOverlappedResult(handle, &ov, &n, true)
			_ = windows.CloseHandle(handle)
			return nil, waitErr
		}
		if waitRes == windows.WAIT_OBJECT_0+1 {
			_ = windows.CancelIoEx(handle, &ov)
			var n uint32
			_ = windows.GetOverlappedResult(handle, &ov, &n, true)
			_ = windows.CloseHandle(handle)
			return nil, net.ErrClosed
		}
		var n uint32
		err = windows.GetOverlappedResult(handle, &ov, &n, false)
	}

	l.mu.Lock()
	wasClosed := l.closed
	l.mu.Unlock()
	if wasClosed {
		_ = windows.CloseHandle(handle)
		return nil, net.ErrClosed
	}
	if err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	return newNamedPipeConn(handle, pipeAddr(l.name))
}

func (l *namedPipeListener) Close() error {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil
	}
	l.closed = true
	closeEv := l.closeEvent
	l.mu.Unlock()

	if closeEv != 0 {
		_ = windows.SetEvent(closeEv)
	}
	l.acceptWG.Wait()
	if closeEv != 0 {
		_ = windows.CloseHandle(closeEv)
	}
	return nil
}

func (l *namedPipeListener) Addr() net.Addr {
	return pipeAddr(l.name)
}

type namedPipeConn struct {
	handle          windows.Handle
	addr            pipeAddr
	closeEvent      windows.Handle
	readDeadlineEv  windows.Handle
	writeDeadlineEv windows.Handle
	mu              sync.Mutex
	closed          bool
	readDeadline    time.Time
	writeDeadline   time.Time
	ioWG            sync.WaitGroup
	once            sync.Once
}

func newNamedPipeConn(handle windows.Handle, addr pipeAddr) (*namedPipeConn, error) {
	closeEv, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	readEv, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		_ = windows.CloseHandle(closeEv)
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	writeEv, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		_ = windows.CloseHandle(readEv)
		_ = windows.CloseHandle(closeEv)
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	return &namedPipeConn{
		handle:          handle,
		addr:            addr,
		closeEvent:      closeEv,
		readDeadlineEv:  readEv,
		writeDeadlineEv: writeEv,
	}, nil
}

func (c *namedPipeConn) Read(b []byte) (int, error) {
	return c.doOverlapped(true, b)
}

func (c *namedPipeConn) Write(b []byte) (int, error) {
	return c.doOverlapped(false, b)
}

func (c *namedPipeConn) doOverlapped(isRead bool, b []byte) (int, error) {
	deadlineEv := c.writeDeadlineEv
	if isRead {
		deadlineEv = c.readDeadlineEv
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return 0, net.ErrClosed
	}
	c.ioWG.Add(1)
	defer c.ioWG.Done()
	dl := c.writeDeadline
	if isRead {
		dl = c.readDeadline
	}
	c.mu.Unlock()

	if !dl.IsZero() && time.Until(dl) <= 0 {
		return 0, os.ErrDeadlineExceeded
	}

	ev, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(ev)

	var ov windows.Overlapped
	ov.HEvent = ev
	var n uint32
	if isRead {
		err = windows.ReadFile(c.handle, b, &n, &ov)
	} else {
		err = windows.WriteFile(c.handle, b, &n, &ov)
	}
	if err == nil {
		return int(n), nil
	}
	if !errors.Is(err, windows.ERROR_IO_PENDING) {
		if isRead && errors.Is(err, windows.ERROR_BROKEN_PIPE) {
			return int(n), io.EOF
		}
		return int(n), err
	}

	for {
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			_ = windows.CancelIoEx(c.handle, &ov)
			_ = windows.GetOverlappedResult(c.handle, &ov, &n, true)
			return int(n), net.ErrClosed
		}
		dl = c.writeDeadline
		if isRead {
			dl = c.readDeadline
		}
		c.mu.Unlock()

		waitMs := uint32(windows.INFINITE)
		if !dl.IsZero() {
			rem := time.Until(dl)
			if rem <= 0 {
				_ = windows.CancelIoEx(c.handle, &ov)
				_ = windows.GetOverlappedResult(c.handle, &ov, &n, true)
				return int(n), os.ErrDeadlineExceeded
			}
			ms := rem.Milliseconds()
			if ms <= 0 {
				ms = 1
			}
			if ms > 0x7fffffff {
				ms = 0x7fffffff
			}
			waitMs = uint32(ms)
		}

		waitRes, waitErr := windows.WaitForMultipleObjects([]windows.Handle{ev, c.closeEvent, deadlineEv}, false, waitMs)
		if waitErr != nil {
			_ = windows.CancelIoEx(c.handle, &ov)
			_ = windows.GetOverlappedResult(c.handle, &ov, &n, true)
			return int(n), waitErr
		}
		switch waitRes {
		case windows.WAIT_OBJECT_0:
			resErr := windows.GetOverlappedResult(c.handle, &ov, &n, false)
			if isRead && errors.Is(resErr, windows.ERROR_BROKEN_PIPE) {
				return int(n), io.EOF
			}
			return int(n), resErr
		case windows.WAIT_OBJECT_0 + 1:
			_ = windows.CancelIoEx(c.handle, &ov)
			_ = windows.GetOverlappedResult(c.handle, &ov, &n, true)
			return int(n), net.ErrClosed
		case windows.WAIT_OBJECT_0 + 2:
			continue
		case uint32(windows.WAIT_TIMEOUT):
			_ = windows.CancelIoEx(c.handle, &ov)
			_ = windows.GetOverlappedResult(c.handle, &ov, &n, true)
			return int(n), os.ErrDeadlineExceeded
		default:
			_ = windows.CancelIoEx(c.handle, &ov)
			_ = windows.GetOverlappedResult(c.handle, &ov, &n, true)
			return int(n), errors.New("unexpected wait result on named pipe")
		}
	}
}

func (c *namedPipeConn) Close() error {
	var err error
	c.once.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		_ = windows.SetEvent(c.closeEvent)
		_ = windows.CancelIoEx(c.handle, nil)
		c.ioWG.Wait()
		err = windows.CloseHandle(c.handle)
		_ = windows.CloseHandle(c.readDeadlineEv)
		_ = windows.CloseHandle(c.writeDeadlineEv)
		_ = windows.CloseHandle(c.closeEvent)
	})
	return err
}

func (c *namedPipeConn) LocalAddr() net.Addr  { return c.addr }
func (c *namedPipeConn) RemoteAddr() net.Addr { return c.addr }

func (c *namedPipeConn) SetDeadline(t time.Time) error {
	c.mu.Lock()
	c.readDeadline = t
	c.writeDeadline = t
	closed := c.closed
	c.mu.Unlock()
	if !closed {
		_ = windows.SetEvent(c.readDeadlineEv)
		_ = windows.SetEvent(c.writeDeadlineEv)
	}
	return nil
}

func (c *namedPipeConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	c.readDeadline = t
	closed := c.closed
	c.mu.Unlock()
	if !closed {
		_ = windows.SetEvent(c.readDeadlineEv)
	}
	return nil
}

func (c *namedPipeConn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	c.writeDeadline = t
	closed := c.closed
	c.mu.Unlock()
	if !closed {
		_ = windows.SetEvent(c.writeDeadlineEv)
	}
	return nil
}

func verifyPeer(conn net.Conn) error {
	pc, ok := conn.(*namedPipeConn)
	if !ok {
		return errors.New("expected windows named pipe connection")
	}
	var pid uint32
	r1, _, err := procGetNamedPipeClientProcID.Call(uintptr(pc.handle), uintptr(unsafe.Pointer(&pid)))
	if r1 == 0 {
		return fmt.Errorf("get pipe client pid: %w", err)
	}
	return verifyProcessSameUserSID(pid)
}

func verifyServerPipeOwner(handle windows.Handle) error {
	var pid uint32
	r1, _, err := procGetNamedPipeServerProcID.Call(uintptr(handle), uintptr(unsafe.Pointer(&pid)))
	if r1 == 0 {
		return fmt.Errorf("get pipe server pid: %w", err)
	}
	return verifyProcessSameUserSID(pid)
}

func verifyProcessSameUserSID(peerPID uint32) error {
	selfSID, err := processUserSID(windows.CurrentProcess())
	if err != nil {
		return fmt.Errorf("read current user SID: %w", err)
	}
	peerProc, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, peerPID)
	if err != nil {
		return fmt.Errorf("open peer process %d: %w", peerPID, err)
	}
	defer windows.CloseHandle(peerProc)

	peerSID, err := processUserSID(peerProc)
	if err != nil {
		return fmt.Errorf("read peer process SID: %w", err)
	}
	if !windows.EqualSid(selfSID, peerSID) {
		return errors.New("peer process SID does not match current user SID")
	}
	return nil
}

func processUserSID(proc windows.Handle) (*windows.SID, error) {
	var tok windows.Token
	if err := windows.OpenProcessToken(proc, windows.TOKEN_QUERY, &tok); err != nil {
		return nil, err
	}
	defer tok.Close()
	user, err := tok.GetTokenUser()
	if err != nil {
		return nil, err
	}
	return user.User.Sid.Copy()
}

func dialLocal(_ context.Context, pipeName string) (net.Conn, error) {
	namePtr, err := windows.UTF16PtrFromString(pipeName)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(
		namePtr,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_OVERLAPPED|windows.SECURITY_SQOS_PRESENT|windows.SECURITY_IDENTIFICATION,
		0,
	)
	if err != nil {
		return nil, err
	}
	if err := verifyServerPipeOwner(handle); err != nil {
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	return newNamedPipeConn(handle, pipeAddr(pipeName))
}
