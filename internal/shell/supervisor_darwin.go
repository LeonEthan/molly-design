package shell

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/ebitengine/purego"
	"golang.org/x/sys/unix"
)

func darwinRunEnvironment(args []byte, id string) bool {
	if len(args) < 4 {
		return false
	}
	count := binary.NativeEndian.Uint32(args)
	args = args[4:]
	_, args, ok := bytes.Cut(args, []byte{0})
	if !ok {
		return false
	}
	args = bytes.TrimLeft(args, "\x00")
	for ; count > 0; count-- {
		_, args, ok = bytes.Cut(args, []byte{0})
		if !ok {
			return false
		}
	}
	target := []byte("MOLLY_SUPERVISOR_RUN_ID=" + id)
	for len(args) > 0 {
		var item []byte
		item, args, ok = bytes.Cut(args, []byte{0})
		if len(item) == 0 || !ok {
			return false
		}
		if bytes.Equal(item, target) {
			return true
		}
	}
	return false
}

func darwinMatch(p unix.KinfoProc, id string) bool {
	if p.Eproc.Ucred.Uid != uint32(os.Getuid()) || p.Proc.P_pid <= 1 || int(p.Proc.P_pid) == os.Getpid() {
		return false
	}
	args, err := unix.SysctlRaw("kern.procargs2", int(p.Proc.P_pid))

	return err == nil && darwinRunEnvironment(args, id)
}

func matchingPIDs(id string) ([]int, error) {
	ps, err := unix.SysctlKinfoProcSlice("kern.proc.uid", os.Getuid())
	if err != nil {
		return nil, err
	}
	var found []int
	for _, p := range ps {
		if darwinMatch(p, id) {
			found = append(found, int(p.Proc.P_pid))
		}
	}
	return found, nil
}

type darwinProcessAPI struct {
	self     func() uint32
	taskName func(uint32, int32, *uint32) int32
	info     func(uint32, uint32, *[8]uint32, *uint32) int32
	release  func(uint32, uint32) int32
	signal   func(*[8]uint32, int32) int32
}

var processAPI = sync.OnceValues(func() (*darwinProcessAPI, error) {
	lib, err := purego.Dlopen("/usr/lib/libSystem.B.dylib", purego.RTLD_LOCAL|purego.RTLD_NOW)
	if err != nil {
		return nil, err
	}
	var api darwinProcessAPI
	for symbol, dest := range map[string]any{"mach_task_self": &api.self, "task_name_for_pid": &api.taskName, "task_info": &api.info, "mach_port_deallocate": &api.release, "proc_signal_with_audittoken": &api.signal} {
		ptr, err := purego.Dlsym(lib, symbol)
		if err != nil {
			return nil, err
		}
		purego.RegisterFunc(dest, ptr)
	}
	return &api, nil
})

func darwinProcessExiting(pid int) bool {
	const exiting = 0x00002000
	const zombie = 5
	p, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		return errors.Is(err, unix.ESRCH) || !processAlive(pid)
	}
	return p.Proc.P_pid != int32(pid) || p.Proc.P_flag&exiting != 0 || p.Proc.P_stat == zombie
}

func killMatching(pid int, id string) error {
	api, err := processAPI()
	if err != nil {
		return err
	}
	self := api.self()
	var task uint32
	if status := api.taskName(self, int32(pid), &task); status != 0 {
		if darwinProcessExiting(pid) {
			return nil
		}
		return fmt.Errorf("open process identity: mach error %d", status)
	}
	defer api.release(self, task)
	var token [8]uint32
	count := uint32(len(token))
	if status := api.info(task, 15, &token, &count); status != 0 || count != 8 {
		if darwinProcessExiting(pid) {
			return nil
		}
		return fmt.Errorf("read process identity: mach error %d", status)
	}
	p, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		if errors.Is(err, unix.ESRCH) || !processAlive(pid) {
			return nil
		}
		return err
	}
	if !darwinMatch(*p, id) {
		return nil
	}
	if status := api.signal(&token, int32(unix.SIGKILL)); status != 0 && processAlive(pid) {
		return fmt.Errorf("signal verified process: %d", status)
	}
	return nil
}

func matchesPeer(fd, pid int) bool {
	peer, err := unix.GetsockoptInt(fd, unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	return err == nil && peer == pid
}
