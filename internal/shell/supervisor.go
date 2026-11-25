package shell

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
	"github.com/google/uuid"
)

type CLISupervisor struct {
	process     *os.Process
	runID       string
	root        *os.Root
	instance    string
	token       string
	coordinator string
	owned       atomic.Bool
	exited      atomic.Bool
	stdin       io.WriteCloser
	done        chan struct{}
	err         error
}

func (s *CLISupervisor) OwnsPrivateDaemon() bool {
	if s == nil || !s.owned.Load() || s.exited.Load() {
		return false
	}
	select {
	case <-s.done:
		return false
	default:
		return true
	}
}

type ownership struct {
	root    *os.Root
	release []func()
	cleanup func() error
}

func (o *ownership) close() {
	for i := len(o.release) - 1; i >= 0; i-- {
		o.release[i]()
	}
	o.root.Close()
}

func startPrivateCLI(dataDir, node, entry string) (*CLISupervisor, error) {
	root, _, err := security.OpenPathRoot(security.PathRoot{Dir: dataDir, RejectSymlinkRoot: true})
	if err != nil {
		return nil, err
	}
	o := &ownership{root: root}
	handedOff := false
	defer func() {
		if !handedOff {
			if o.cleanup != nil {
				_ = o.cleanup()
			}
			o.close()
		}
	}()
	if err = root.MkdirAll("run", 0700); err != nil {
		return nil, err
	}
	s := &CLISupervisor{instance: uuid.NewString(), token: randomHex(32), coordinator: randomHex(32), done: make(chan struct{})}
	for s.coordinator == s.token {
		s.coordinator = randomHex(32)
	}
	runID := uuid.NewString()
	if err = prepareOwnership(o, s.instance, runID); err != nil {
		return nil, err
	}
	cmd := exec.Command(node, entry, "start")
	cmd.Env = supervisedEnv(os.Environ(), dataDir, runID)
	s.stdin, err = cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err = startOwnedProcess(cmd, o); err != nil {
		s.stdin.Close()
		return nil, err
	}
	s.runID = runID
	s.process = cmd.Process
	s.root = root
	handedOff = true
	go func() {
		defer close(s.done)
		defer o.close()
		s.err = cmd.Wait()
		s.exited.Store(true)
		s.owned.Store(false)
		s.stdin.Close()
		if o.cleanup != nil {
			s.err = errors.Join(s.err, o.cleanup())
		}
	}()
	err = json.NewEncoder(s.stdin).Encode(map[string]any{"type": "lody/supervisor-hello", "token": s.token, "coordinatorToken": s.coordinator, "supervisorPid": os.Getpid(), "supervisorInstanceId": s.instance})
	if err != nil {
		return nil, errors.Join(err, s.Close())
	}
	return s, nil
}

func (s *CLISupervisor) Close() error {
	s.owned.Store(false)
	s.stdin.Close()
	select {
	case <-s.done:
	case <-time.After(5 * time.Second):
		if err := terminateOwnedCLI(s.process, s.runID); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
		select {
		case <-s.done:
		case <-time.After(5 * time.Second):
			return errors.New("private_cli_shutdown_unconfirmed")
		}

	}
	return s.err
}

func scrubSensitiveChildEnv(env []string) []string {
	out := make([]string, 0, len(env))
	for _, v := range env {
		key, _, _ := strings.Cut(v, "=")
		key = strings.ToUpper(key)
		if (strings.HasPrefix(key, "MOLLY_") || strings.HasPrefix(key, "LODY_") || strings.HasPrefix(key, "MCP_")) && strings.HasSuffix(key, "_TOKEN") {
			continue
		}
		out = append(out, v)
	}
	return out
}

func supervisedEnv(env []string, dataDir, runID string) []string {
	extra := map[string]string{
		"MOLLY_SUPERVISOR_TRANSPORT":      "stdin",
		"MOLLY_DATA_DIR":                  dataDir,
		"MOLLY_PLATFORM":                  "local",
		"MOLLY_PROFILE":                   "experimental",
		"MOLLY_ISOLATED_DATA_ROOT_STRICT": "1",
		"MOLLY_SUPERVISOR_RUN_ID":         runID,
	}
	if runtime.GOOS == "windows" {
		extra["MOLLY_MYGO_ISOLATED_PIPES"] = "1"
	}
	out := make([]string, 0, len(env)+len(extra))
	for _, v := range scrubSensitiveChildEnv(env) {
		k, _, _ := strings.Cut(v, "=")
		k = strings.ToUpper(k)
		if runtime.GOOS == "windows" && (k == "MOLLY_E2E" || k == "LODY_E2E") {
			continue
		}
		if _, ok := extra[k]; ok || strings.HasPrefix(k, "MOLLY_SUPERVISOR_") || strings.HasPrefix(k, "LODY_SUPERVISOR_") || strings.HasSuffix(k, "COORDINATOR_TOKEN") {
			continue
		}
		out = append(out, v)
	}
	for k, v := range extra {
		out = append(out, k+"="+v)
	}
	return out
}

func checkOldDaemon(root *os.Root, lock bool) error {
	paths := []string{"daemon.pid", "run/daemon.json"}
	if lock {
		paths = append(paths, "run/daemon.lock")
	}
	for _, p := range paths {
		raw, err := security.ReadBoundedFileFromRoot(root, p, 1<<20)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		var pid int
		if strings.HasSuffix(p, ".json") || bytes.HasPrefix(bytes.TrimSpace(raw), []byte("{")) {
			var state struct {
				PID int `json:"pid"`
			}
			err = json.Unmarshal(raw, &state)
			pid = state.PID
		} else {
			line, _, _ := bytes.Cut(raw, []byte{'\n'})
			pid, err = strconv.Atoi(strings.TrimSpace(string(line)))
		}
		if err != nil || pid <= 0 || processAlive(pid) {
			return fmt.Errorf("daemon_owner_unresolved: %s", p)
		}
	}
	return nil
}

type identityTarget struct {
	name  string
	value []byte
	valid func([]byte) bool
}

func identityTargets(root *os.Root) ([]identityTarget, error) {
	id := uuid.NewString()
	local, _ := json.Marshal(map[string]string{"userId": "local:" + strings.ReplaceAll(id, "-", ""), "createdAt": time.Now().UTC().Format(time.RFC3339Nano)})
	raw, err := security.ReadBoundedFileFromRoot(root, "credentials.json", 1<<20)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	migrated := credentialMachineID(raw)
	machine := migrated
	if machine == "" {
		machine = uuid.NewString()
	}
	return []identityTarget{{"local-identity.json", local, func(b []byte) bool {
		var v map[string]any
		if json.Unmarshal(b, &v) != nil {
			return false
		}
		user, _ := v["userId"].(string)
		_, timestamp := v["createdAt"].(string)
		return strings.HasPrefix(user, "local:") && timestamp
	}}, {"machine-id", []byte(machine), func(b []byte) bool {
		v := strings.TrimSpace(string(b))
		return v != "" && (migrated == "" || v == migrated)
	}}}, nil
}

func credentialMachineID(raw []byte) string {
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil || v["version"] != float64(3) {
		return ""
	}
	user, _ := v["user"].(map[string]any)
	machine, _ := v["machine"].(map[string]any)
	_, hasToken := v["token"].(string)
	_, hasID := user["id"].(string)
	_, hasEmail := user["email"].(string)
	_, hasName := machine["machineName"].(string)
	if !hasToken || !hasID || !hasEmail || !hasName {
		return ""
	}
	if val, ok := v["createdAt"]; ok {
		if _, ok = val.(string); !ok {
			return ""
		}
	}
	if val := user["name"]; val != nil {
		if _, ok := val.(string); !ok {
			return ""
		}
	}
	id, _ := machine["machineId"].(string)
	return strings.TrimSpace(id)
}

func publishRootFile(root *os.Root, name string, b []byte, replace bool) error {
	suffix := randomHex(8)
	tmp := filepath.Join(filepath.Dir(name), "."+suffix+".tmp")
	f, err := root.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(tmp)
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err != nil {
		return err
	}
	if replace {
		return root.Rename(tmp, name)
	}
	return root.Link(tmp, name)
}

type durableParentLock interface {
	io.Writer
	Sync() error
}

func finishParentOwnership(o *ownership, lock durableParentLock, instance string, recheck func() error, hold func(identityTarget) (io.Closer, error)) error {
	if _, err := fmt.Fprintf(lock, "%d\n%s\n", os.Getpid(), instance); err != nil {
		return err
	}
	if err := lock.Sync(); err != nil {
		return err
	}
	if err := recheck(); err != nil {
		return err
	}
	return withIdentityLocks(o.root, func(target identityTarget) error {
		held, err := hold(target)
		if err != nil {
			return err
		}
		o.release = append(o.release, func() { held.Close() })
		return nil
	})
}

func withIdentityLocks(root *os.Root, publish func(identityTarget) error) error {
	for _, name := range []string{"local-identity.json", "machine-id"} {
		lock := name + ".init.lock"
		f, err := acquireIdentityLock(root, lock)
		if err != nil {
			return err
		}
		defer func() { f.Close(); root.Remove(lock) }()
		if _, err := root.Lstat(name + ".wx-pending"); err == nil {
			return errors.New("uncommitted_identity")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	targets, err := identityTargets(root)
	if err != nil {
		return err
	}
	for _, target := range targets {
		if err = publish(target); err != nil {
			return err
		}
	}
	return nil
}

func acquireIdentityLock(root *os.Root, name string) (*os.File, error) {
	create := func(path string) (*os.File, error) {
		f, err := root.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return nil, err
		}
		if _, err = fmt.Fprint(f, os.Getpid()); err != nil {
			f.Close()
			root.Remove(path)
			return nil, err
		}
		return f, nil
	}
	f, err := create(name)
	if !errors.Is(err, os.ErrExist) {
		return f, err
	}
	guard, err := create(name + ".reap")
	if err != nil {
		return nil, err
	}
	defer func() { guard.Close(); root.Remove(name + ".reap") }()
	current, err := security.ReadBoundedFileFromRoot(root, name, 128)
	if errors.Is(err, os.ErrNotExist) {
		return create(name)
	}
	if err != nil {
		return nil, err
	}
	pid, err := strconv.Atoi(string(current))
	if err != nil || pid <= 0 || processAlive(pid) {
		return nil, errors.New("identity_lock_busy")
	}
	if err = root.Remove(name); err != nil {
		return nil, err
	}
	return create(name)
}

func (s *CLISupervisor) confirmPrivateDaemon(ctx context.Context, probe string) error {
	client := s.privateClient(probe)
	retry := time.NewTicker(100 * time.Millisecond)
	defer retry.Stop()
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://localhost/state", nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err == nil {
			var state struct {
				Supervisor struct {
					PID                    int
					InstanceId, LaunchMode string
				}
			}
			err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&state)
			resp.Body.Close()
			if resp.StatusCode == 200 && err == nil {
				if state.Supervisor.PID != os.Getpid() || state.Supervisor.InstanceId != s.instance || state.Supervisor.LaunchMode != "electron" {
					return errors.New("private_daemon_handshake_mismatch")
				}
				s.owned.Store(true)
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.done:
			return errors.Join(errors.New("private_daemon_exited_before_ready"), s.err)
		case <-retry.C:
		}
	}
}

type identityFiles struct {
	open, temp  func() (*os.File, error)
	move        func(*os.File, bool) error
	retryAccess func(error, int) bool
}

func publishHeldIdentity(t identityTarget, files identityFiles) (*os.File, error) {
	for attempt := 0; attempt < 8; attempt++ {
		existing, err := files.open()
		replace := err == nil
		if replace {
			info, err := existing.Stat()
			if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
				existing.Close()
				return nil, errors.New("invalid_identity_file")
			}
			b, err := io.ReadAll(existing)
			if err != nil {
				existing.Close()
				return nil, err
			}
			if t.valid(b) {
				return existing, nil
			}
			existing.Close()
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		f, err := files.temp()
		if err != nil {
			return nil, err
		}
		if _, err = f.Write(t.value); err == nil {
			err = f.Sync()
		}
		if err == nil {
			err = files.move(f, replace)
		}
		if err == nil {
			return f, nil
		}
		f.Close()
		os.Remove(f.Name())
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if replace && files.retryAccess(err, attempt) {
			continue
		}
		return nil, err
	}
	return nil, errors.New("identity_publication_contention")
}
