//go:build !windows

package shell

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"syscall"

	"github.com/LeonEthan/molly-design/internal/security"
	"github.com/google/uuid"
)

func processAlive(pid int) bool { return !errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) }

func startOwnedProcess(cmd *exec.Cmd, _ *ownership) error {
	configureWorkerProcessGroup(cmd)
	return cmd.Start()
}

func prepareOwnership(o *ownership, instance, runID string) error {
	f, err := o.root.OpenFile("run/daemon-owner.lock", os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	o.release = append(o.release, func() { f.Close() })
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return err
	}
	if err = holdTCPLease(o, instance); err != nil {
		return err
	}
	const active = "run/supervisor-active-run.json"
	if info, err := o.root.Lstat(active); err == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
			return errors.New("invalid_active_run")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	prior, err := security.ReadBoundedFileFromRoot(o.root, active, 1024)
	if err == nil {
		var r struct{ RunID string }
		if json.Unmarshal(prior, &r) != nil || uuid.Validate(r.RunID) != nil {
			return errors.New("invalid_active_run")
		}
		if err = sweepRunSubtree(r.RunID); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err = checkOldDaemon(o.root, true); err != nil {
		return err
	}
	err = withIdentityLocks(o.root, func(t identityTarget) error {
		for {
			existing, err := security.ReadBoundedFileFromRoot(o.root, t.name, 1<<20)
			if err == nil && t.valid(existing) {
				return nil
			}
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if err = publishRootFile(o.root, t.name, t.value, err == nil); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
		}
	})
	if err != nil {
		return err
	}
	record, _ := json.Marshal(map[string]string{"runId": runID})
	if err = publishRootFile(o.root, active, record, true); err != nil {
		return err
	}
	runDir, err := o.root.Open("run")
	if err != nil {
		return err
	}
	err = runDir.Sync()
	runDir.Close()
	if err != nil {
		return err
	}
	o.cleanup = func() error {
		if err := sweepRunSubtree(runID); err != nil {
			return err
		}
		return o.root.Remove(active)
	}
	return nil
}

func sweepRunSubtree(runID string) error {
	return sweepVerified(runID, matchingPIDs, killMatching)
}

func sweepVerified(runID string, list func(string) ([]int, error), kill func(int, string) error) error {
	if uuid.Validate(runID) != nil {
		return errors.New("invalid_run_id")
	}
	for quiet := 0; quiet < 2; {
		pids, err := list(runID)
		if err != nil {
			return err
		}
		if len(pids) == 0 {
			quiet++
			continue
		}
		quiet = 0
		for _, pid := range pids {
			if err := kill(pid, runID); err != nil {
				return err
			}
		}
	}
	return nil
}

func terminateOwnedCLI(p *os.Process, runID string) error { return killMatching(p.Pid, runID) }
