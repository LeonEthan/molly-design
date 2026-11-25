//go:build !windows

package shell

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSweepEnvironment(t *testing.T) {
	id := uuid.NewString()
	cmd := exec.Command(os.Args[0], "-test.run=^TestRunIDChild$")
	cmd.Env = append(os.Environ(), "MOLLY_SUPERVISOR_RUN_ID="+id, "MOLLY_RUN_ID_TEST_CHILD=1")
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	if _, err = bufio.NewReader(out).ReadString('\n'); err != nil {
		t.Fatal(err)
	}

	pids, err := matchingPIDs(id)
	if err != nil || len(pids) != 1 || pids[0] != cmd.Process.Pid {
		t.Fatalf("matching processes %v, err %v", pids, err)
	}
	if err = killMatching(cmd.Process.Pid, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if !processAlive(cmd.Process.Pid) {
		t.Fatal("unrelated process killed")
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	if err = sweepRunSubtree(id); err != nil {
		t.Fatal(err)
	}
	if <-done == nil {
		t.Fatal("marked subprocess exited normally")
	}
}

func TestPrivateCLIHello(t *testing.T) {
	dir := t.TempDir()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node unavailable")
	}
	script := filepath.Join(t.TempDir(), "hello.cjs")
	child := `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('node:readline').createInterface({input: process.stdin}).once('line', line => {
  const hello = JSON.parse(line);
  const env = process.env;
  assert.equal(env.MOLLY_PROFILE, 'experimental');
  assert.equal(env.MOLLY_ISOLATED_DATA_ROOT_STRICT, '1');
  assert.equal(env.MOLLY_DATA_DIR, %q);
  assert.equal(env.MOLLY_SUPERVISOR_TRANSPORT, 'stdin');
  assert.ok(!Object.values(env).includes('synthetic-child-secret'));
  assert.equal(hello.type, 'lody/supervisor-hello');
  assert.equal(hello.supervisorPid, process.ppid);
  assert.match(hello.supervisorInstanceId, /^[0-9a-f-]{36}$/);
  assert.notEqual(hello.token, hello.coordinatorToken);
  for (const token of [hello.token, hello.coordinatorToken]) {
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.ok(![...process.argv, ...Object.values(env)].some(value => value.includes(token)));
  }
  fs.writeFileSync(path.join(__dirname, 'child-run-id'), env.MOLLY_SUPERVISOR_RUN_ID);
  process.exit(0);
});`
	if err = os.WriteFile(script, []byte(fmt.Sprintf(child, dir)), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MOLLY_PROFILE", "stable")
	injectChildTokens(t)
	s, err := startPrivateCLI(dir, node, script)
	if err != nil {
		t.Fatal(err)
	}
	<-s.done
	if s.err != nil {
		t.Fatal(s.err)
	}
	runID, err := os.ReadFile(filepath.Join(filepath.Dir(script), "child-run-id"))
	if err != nil || s.runID == "" || string(runID) != s.runID {
		t.Fatalf("child run ID %q, want %q (read error %v)", runID, s.runID, err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if s.OwnsPrivateDaemon() {
		t.Fatal("dead CLI still owned")
	}
	if _, err = os.Stat(filepath.Join(dir, "run", "supervisor-active-run.json")); !os.IsNotExist(err) {
		t.Fatal(err)
	}
	for _, name := range []string{"local-identity.json", "machine-id"} {
		f, err := os.Open(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(f)
		f.Close()
		if err != nil || strings.TrimSpace(string(raw)) == "" {
			t.Fatal(name, err)
		}
	}
}

func TestRunIDChild(t *testing.T) {
	if os.Getenv("MOLLY_RUN_ID_TEST_CHILD") != "1" {
		return
	}
	fmt.Println("ready")
	io.Copy(io.Discard, os.Stdin)
}

func TestCoordinatorHeadersAtPrivatePeer(t *testing.T) {
	dir, err := os.MkdirTemp("", "rpc")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "ctl")
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	token := randomHex(32)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Molly-Coordinator-Token") != token || r.URL.Path != "/machine-rpc" {
			http.Error(w, "unauthorized", 403)
			return
		}
		io.WriteString(w, `{"ok":true,"result":true}`)
	})}
	go srv.Serve(ln)
	defer srv.Close()
	self, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	defer self.Release()
	s := &CLISupervisor{process: self, coordinator: token}
	b := NewMollyBridge(BridgeConfig{Supervisor: s, ControlSocketPath: path})
	for _, method := range []string{"harness/host", "design/canvas-host", "design/render-host", "mcp/catalog-entry", "browser/host", "browser/pause-all"} {
		var result bool
		s.owned.Store(true)
		if err := b.coordinatorRPC(context.Background(), s, "m", "w", method, nil, &result); err != nil || !result {
			t.Fatal(method, err)
		}
		s.owned.Store(false)
		if err := b.coordinatorRPC(context.Background(), s, "m", "w", method, nil, &result); err == nil {
			t.Fatal("unowned daemon accepted")
		}
	}
}

func openTestIdentityTemp(dir string) (*os.File, error) { return os.CreateTemp(dir, ".new") }

func moveTestIdentity(f *os.File, target string, _ bool) error { return os.Rename(f.Name(), target) }

func TestPrivatePeerConfirmsStdinIdentity(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "molly")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node unavailable")
	}
	js := filepath.Join(t.TempDir(), "cli.cjs")
	source := `const http=require('node:http'),path=require('node:path'),rl=require('node:readline').createInterface({input:process.stdin});
 rl.once('line',line=>{const hello=JSON.parse(line);const server=http.createServer((req,res)=>res.end(JSON.stringify({supervisor:{pid:hello.supervisorPid,instanceId:hello.supervisorInstanceId,launchMode:'electron'}})));server.listen(path.join(process.env.MOLLY_DATA_DIR,'probe'));rl.on('close',()=>server.close())});`
	if err = os.WriteFile(js, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	if err = ValidateIsolatedShellPaths(dir); err != nil {
		t.Fatal(err)
	}
	s, err := startPrivateCLI(dir, node, js)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.OwnsPrivateDaemon() {
		t.Fatal("claimed ownership before peer confirmation")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = s.confirmPrivateDaemon(ctx, filepath.Join(dir, "probe")); err != nil {
		t.Fatal(err)
	}
	if !s.OwnsPrivateDaemon() {
		t.Fatal("confirmed daemon unavailable")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRecoverySweepsPriorGeneration(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	o := &ownership{root: root}
	defer o.close()
	if err = root.Mkdir("run", 0700); err != nil {
		t.Fatal(err)
	}
	prev := uuid.NewString()
	cmd := exec.Command(os.Args[0], "-test.run=^TestRunIDChild$")
	cmd.Env = append(os.Environ(), "MOLLY_SUPERVISOR_RUN_ID="+prev, "MOLLY_RUN_ID_TEST_CHILD=1")
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	if _, err = bufio.NewReader(out).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	if err = publishRootFile(root, "run/supervisor-active-run.json", []byte(fmt.Sprintf(`{"runId":%q}`, prev)), true); err != nil {
		t.Fatal(err)
	}
	next := uuid.NewString()
	if err = prepareOwnership(o, uuid.NewString(), next); err != nil {
		t.Fatal(err)
	}
	if <-done == nil {
		t.Fatal("previous generation survived")
	}
	b, err := root.ReadFile("run/supervisor-active-run.json")
	if err != nil || !strings.Contains(string(b), next) {
		t.Fatal("new record missing", err)
	}
	if err = o.cleanup(); err != nil {
		t.Fatal(err)
	}
}

func TestStartRefusesLiveOwnerRecords(t *testing.T) {
	for _, name := range []string{"daemon.pid", "run/daemon.json", "run/daemon.lock"} {
		t.Run(name, func(t *testing.T) {
			root, err := os.OpenRoot(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			o := &ownership{root: root}
			defer o.close()
			if err = root.Mkdir("run", 0700); err != nil {
				t.Fatal(err)
			}
			body := fmt.Sprintf(`{"pid":%d}`, os.Getpid())
			if name == "run/daemon.lock" {
				body = fmt.Sprintf("%d\n", os.Getpid())
			}
			if err = root.WriteFile(name, []byte(body), 0600); err != nil {
				t.Fatal(err)
			}
			if err = prepareOwnership(o, uuid.NewString(), uuid.NewString()); err == nil {
				t.Fatal("accepted live owner")
			}
			got, err := root.ReadFile(name)
			if err != nil || string(got) != body {
				t.Fatal("owner record changed", err)
			}
			if _, err = root.Stat("machine-id"); !os.IsNotExist(err) {
				t.Fatal("published identity despite live owner")
			}
		})
	}
}
