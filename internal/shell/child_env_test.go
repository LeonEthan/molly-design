package shell

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func injectChildTokens(t *testing.T) {
	t.Helper()
	for _, name := range []string{"MOLLY_CORE_IPC_TOKEN", "MOLLY_SUPERVISOR_TOKEN", "LODY_SUPERVISOR_TOKEN", "MOLLY_COORDINATOR_TOKEN", "MOLLY_MCP_HTTP_TOKEN", "MCP_HTTP_TOKEN", "MOLLY_MCP_TOOL_AUTH_TOKEN"} {
		t.Setenv(name, "synthetic-child-secret")
	}
}
func TestWorkerChildEnvironment(t *testing.T) {
	injectChildTokens(t)
	node, e := exec.LookPath("node")
	if e != nil {
		t.Fatal(e)
	}
	script := filepath.Join(t.TempDir(), "env.cjs")
	if e = os.WriteFile(script, []byte(`require('node:readline').createInterface({input:process.stdin}).on('line',()=>console.log(JSON.stringify({ok:true,value:Object.values(process.env).includes("synthetic-child-secret")})))`), 0600); e != nil {
		t.Fatal(e)
	}
	for _, dir := range []string{"", t.TempDir()} {
		w := NewDesignWorkerClientWithDataDir(node, script, dir)
		defer w.Close()
		raw, e := w.Request(t.Context(), map[string]any{})
		if e != nil || string(raw) != "false" {
			t.Fatal(string(raw), e)
		}
	}
}
