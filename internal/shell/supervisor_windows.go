package shell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func processAlive(pid int) bool {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return !errors.Is(err, windows.ERROR_INVALID_PARAMETER)
	}
	defer windows.CloseHandle(h)
	status, err := windows.WaitForSingleObject(h, 0)
	return err != nil || status != windows.WAIT_OBJECT_0
}

func openWindows(path string, access, share, disposition uint32) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(p, access, share, nil, disposition, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}

func legacyPipes() error {
	suffix := windowsUserPipeScope()
	var pipes []string
	for _, ns := range []string{"molly", "molly-preview", "lody"} {
		for _, kind := range []string{"agent-host", "control", "probe"} {
			pipes = append(pipes, `\\.\pipe\`+ns+"-"+kind+"-"+suffix)
		}
	}
	if os.Getenv("MOLLY_E2E") == "1" || os.Getenv("LODY_E2E") == "1" {
		for _, key := range []string{"MOLLY_E2E_LOCAL_CLI_HOST_PIPE", "LODY_E2E_LOCAL_CLI_HOST_PIPE"} {
			if p := os.Getenv(key); p != "" {
				pipes = append(pipes, p)
			}
		}
	}
	waitNamedPipe := windows.NewLazySystemDLL("kernel32.dll").NewProc("WaitNamedPipeW")
	for _, p := range pipes {
		if !strings.HasPrefix(p, `\\.\pipe\`) {
			return errors.New("invalid_legacy_pipe_name")
		}
		name, err := windows.UTF16PtrFromString(p)
		if err != nil {
			return err
		}
		ok, _, why := waitNamedPipe.Call(uintptr(unsafe.Pointer(name)), 1)
		if ok != 0 || !errors.Is(why, windows.ERROR_FILE_NOT_FOUND) {
			return errors.New("legacy_daemon_pipe_in_use")
		}
	}

	return nil
}

func prepareOwnership(o *ownership, instance, runID string) error {
	preflight := func(lock bool) error {
		if err := checkOldDaemon(o.root, lock); err != nil {
			return err
		}
		return legacyPipes()
	}
	if err := preflight(true); err != nil {
		return err
	}
	dir := o.root.Name()
	owner, err := openWindows(filepath.Join(dir, "run", "daemon-owner.lock"), windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, windows.OPEN_ALWAYS)
	if err != nil {
		return err
	}
	o.release = append(o.release, func() { owner.Close() })
	if err = windows.LockFileEx(windows.Handle(owner.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{}); err != nil {
		return err
	}
	if err = preflight(true); err != nil {
		return err
	}
	lock := filepath.Join(dir, "run", "daemon.lock")
	if err = removeStaleParentLock(lock); err != nil {
		return err
	}
	f, err := openWindows(lock, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ, windows.CREATE_NEW)
	if err != nil {
		return err
	}
	o.release = append(o.release, func() {
		owned, err := f.Stat()
		f.Close()
		if err != nil {
			return
		}
		current, err := openWindows(lock, windows.DELETE|windows.GENERIC_READ, windows.FILE_SHARE_READ, windows.OPEN_EXISTING)
		if err != nil {
			return
		}
		defer current.Close()
		info, err := current.Stat()
		if err == nil && os.SameFile(owned, info) {
			deletePending := byte(1)
			windows.SetFileInformationByHandle(windows.Handle(current.Fd()), windows.FileDispositionInfo, &deletePending, 1)
		}
	})
	if err = finishParentOwnership(o, f, instance, func() error { return preflight(false) }, func(t identityTarget) (io.Closer, error) { return holdWindowsIdentity(dir, t) }); err != nil {
		return err
	}
	return holdWindowsHostPipe(o, instance)
}

func removeStaleParentLock(path string) error {
	f, err := openWindows(path, windows.DELETE|windows.GENERIC_READ, windows.FILE_SHARE_READ, windows.OPEN_EXISTING)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 1024))
	if err != nil {
		return err
	}
	line, _, _ := strings.Cut(string(raw), "\n")
	pid, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || pid <= 0 || processAlive(pid) {
		return errors.New("daemon_owner_unresolved")
	}
	deletePending := byte(1)
	return windows.SetFileInformationByHandle(windows.Handle(f.Fd()), windows.FileDispositionInfo, &deletePending, 1)
}

func holdWindowsIdentity(dir string, t identityTarget) (*os.File, error) {
	target := filepath.Join(dir, t.name)
	return publishHeldIdentity(t, identityFiles{
		open: func() (*os.File, error) {
			return openWindows(target, windows.GENERIC_READ, windows.FILE_SHARE_READ, windows.OPEN_EXISTING)
		},
		temp: func() (*os.File, error) {
			return openWindows(filepath.Join(dir, "."+randomHex(12)+".tmp"), windows.GENERIC_READ|windows.GENERIC_WRITE|windows.DELETE, windows.FILE_SHARE_READ, windows.CREATE_NEW)
		},
		move: func(f *os.File, replace bool) error { return renameWindowsHandle(f, target, replace) },
		retryAccess: func(err error, attempt int) bool {
			if !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
				return false
			}
			time.Sleep(time.Duration(attempt+1) * time.Millisecond)
			return true
		},
	})
}

func renameWindowsHandle(f *os.File, target string, replace bool) error {
	name, err := windows.UTF16FromString(target)
	if err != nil {
		return err
	}
	type header struct {
		Replace uint32
		Root    windows.Handle
		Length  uint32
		Name    uint16
	}
	var layout header
	size := int(unsafe.Offsetof(layout.Name)) + len(name)*2
	buf := make([]byte, size)
	h := (*header)(unsafe.Pointer(&buf[0]))
	if replace {
		h.Replace = 1
	}
	h.Length = uint32((len(name) - 1) * 2)
	copy(unsafe.Slice(&h.Name, len(name)), name)
	return windows.SetFileInformationByHandle(windows.Handle(f.Fd()), windows.FileRenameInfo, &buf[0], uint32(size))
}

func startOwnedProcess(cmd *exec.Cmd, o *ownership) error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	o.release = append(o.release, func() { windows.CloseHandle(job) })
	var limits windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return err
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_SUSPENDED}
	if err = cmd.Start(); err != nil {
		return err
	}
	resumed := false
	defer func() {
		if !resumed {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	if err = windows.AssignProcessToJobObject(job, h); err != nil {
		return err
	}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(snapshot)
	var th windows.ThreadEntry32
	th.Size = uint32(unsafe.Sizeof(th))
	var primary uint32
	for err = windows.Thread32First(snapshot, &th); err == nil; err = windows.Thread32Next(snapshot, &th) {
		if th.OwnerProcessID != uint32(cmd.Process.Pid) {
			continue
		}
		if primary != 0 {
			return errors.New("ambiguous suspended CLI thread")
		}
		primary = th.ThreadID
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) || primary == 0 {
		return fmt.Errorf("find suspended CLI thread: %w", err)
	}
	thread, err := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, primary)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(thread)
	if _, err = windows.ResumeThread(thread); err != nil {
		return err
	}
	resumed = true
	return nil
}

type ownedPipe struct {
	*os.File
	addr net.Addr
}

func (p *ownedPipe) LocalAddr() net.Addr { return p.addr }

func (p *ownedPipe) RemoteAddr() net.Addr { return p.addr }

var serverPID = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetNamedPipeServerProcessId")

func dialOwnedCLI(ctx context.Context, path string, pid int) (net.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OVERLAPPED|windows.SECURITY_SQOS_PRESENT|windows.SECURITY_IDENTIFICATION, 0)
	if err != nil {
		return nil, err
	}
	var peer uint32
	ok, _, _ := serverPID.Call(uintptr(h), uintptr(unsafe.Pointer(&peer)))
	if ok == 0 || int(peer) != pid {
		windows.CloseHandle(h)
		return nil, errors.New("private_daemon_peer_mismatch")
	}
	return &ownedPipe{os.NewFile(uintptr(h), path), &net.UnixAddr{Name: path, Net: "pipe"}}, nil
}

func holdWindowsHostPipe(o *ownership, instance string) error {
	scope, _, err := dataDirectoryScope(o.root.Name())
	if err != nil {
		return err
	}
	name, err := windows.UTF16PtrFromString(`\\.\pipe\` + installationNamespace() + "-agent-host-" + windowsUserPipeScope() + "-" + scope)
	if err != nil {
		return err
	}
	sd, err := windows.SecurityDescriptorFromString("D:(A;;GA;;;OW)")
	if err != nil {
		return err
	}
	sa := windows.SecurityAttributes{SecurityDescriptor: sd}
	sa.Length = uint32(unsafe.Sizeof(sa))
	h, err := windows.CreateNamedPipe(name, windows.PIPE_ACCESS_DUPLEX|windows.FILE_FLAG_FIRST_PIPE_INSTANCE|windows.FILE_FLAG_OVERLAPPED, windows.PIPE_REJECT_REMOTE_CLIENTS, 1, 8192, 8192, 0, &sa)
	if err != nil {
		return err
	}
	stop, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		windows.CloseHandle(h)
		return err
	}
	event, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		windows.CloseHandle(h)
		windows.CloseHandle(stop)
		return err
	}
	done := make(chan struct{})
	o.release = append(o.release, func() {
		windows.SetEvent(stop)
		<-done
		windows.CloseHandle(h)
		windows.CloseHandle(stop)
		windows.CloseHandle(event)
	})
	record, _ := json.Marshal(map[string]any{"version": 1, "pid": os.Getpid(), "mode": "electron", "instanceId": instance, "startedAtMs": time.Now().UnixMilli()})
	record = append(record, '\n')
	go func() {
		defer close(done)
		wait := func(ov *windows.Overlapped, err error) bool {
			if err == nil {
				return true
			}
			if !errors.Is(err, windows.ERROR_IO_PENDING) {
				return false
			}
			status, waitErr := windows.WaitForMultipleObjects([]windows.Handle{stop, event}, false, windows.INFINITE)
			if waitErr != nil || status != windows.WAIT_OBJECT_0+1 {
				windows.CancelIoEx(h, ov)
			}
			var n uint32
			return windows.GetOverlappedResult(h, ov, &n, true) == nil && status == windows.WAIT_OBJECT_0+1
		}
		for {
			if status, _ := windows.WaitForSingleObject(stop, 0); status == windows.WAIT_OBJECT_0 {
				return
			}
			ov := windows.Overlapped{HEvent: event}
			windows.ResetEvent(event)
			err := windows.ConnectNamedPipe(h, &ov)
			if !errors.Is(err, windows.ERROR_PIPE_CONNECTED) && !wait(&ov, err) {
				return
			}
			windows.ResetEvent(event)
			ov = windows.Overlapped{HEvent: event}
			var n uint32
			if wait(&ov, windows.WriteFile(h, record, &n, &ov)) {
				var input [256]byte
				windows.ResetEvent(event)
				ov = windows.Overlapped{HEvent: event}
				wait(&ov, windows.ReadFile(h, input[:], &n, &ov))
			}
			windows.DisconnectNamedPipe(h)
		}
	}()
	return nil
}

func terminateOwnedCLI(p *os.Process, _ string) error { return p.Kill() }
