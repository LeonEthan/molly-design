//go:build windows

package shell

import "os/exec"

func configureWorkerProcessGroup(_ *exec.Cmd) {}

func killWorkerProcessGroup(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}
