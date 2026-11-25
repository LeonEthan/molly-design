package shell

import (
	"bytes"
	"errors"
	"io"
	"os"
	"strconv"
	"syscall"

	"golang.org/x/sys/unix"
)

func linuxMatch(pid int, id string) bool {
	if pid <= 1 || pid == os.Getpid() {
		return false
	}
	path := "/proc/" + strconv.Itoa(pid) + "/environ"
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		return false
	}
	b, err := io.ReadAll(f)
	return err == nil && bytes.Contains(append([]byte{0}, b...), []byte("\x00MOLLY_SUPERVISOR_RUN_ID="+id+"\x00"))
}

func matchingPIDs(id string) ([]int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var found []int
	for _, e := range entries {
		p, err := strconv.Atoi(e.Name())
		if err == nil && linuxMatch(p, id) {
			found = append(found, p)
		}
	}
	return found, nil
}

func killMatching(pid int, id string) error {
	fd, err := unix.PidfdOpen(pid, 0)
	if errors.Is(err, unix.ESRCH) {
		return nil
	}
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	if !linuxMatch(pid, id) {
		return nil
	}
	err = unix.PidfdSendSignal(fd, unix.SIGKILL, nil, 0)
	if errors.Is(err, unix.ESRCH) {
		return nil
	}
	return err
}

func matchesPeer(fd, pid int) bool {
	cred, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	return err == nil && int(cred.Pid) == pid
}
