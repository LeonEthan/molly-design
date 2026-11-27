//go:build windows

package shell

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/LeonEthan/molly-design/internal/security"
	"github.com/egoist/mygo"
)

const nativeTestEnv = "MOLLY_TEST_NATIVE_SHELL"

func TestMain(m *testing.M) {
	if os.Getenv(nativeTestEnv) != "1" {
		os.Exit(m.Run())
	}
	code := make(chan int, 1)
	mygo.App.OnWindowAllClosed(func() {})
	mygo.App.OnReady(func() { go func() { code <- m.Run(); mygo.App.Quit() }() })
	if err := mygo.App.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(<-code)
}

func runNativeWindowsEnvOverrideProbe(t *testing.T, envKey, envVal string) {
	t.Helper()
	if os.Getenv(nativeTestEnv) != "1" {
		ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v", "-test.timeout=75s")
		cmd.Env = append(os.Environ(), nativeTestEnv+"=1", envKey+"="+envVal)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v\n%s", err, out)
		}
		t.Logf("%s", out)
		return
	}
	proxy, err := security.NewPublicEgressProxy(nil)
	if err != nil {
		t.Fatal(err)
	}
	var host *mygoPublicBrowserHost
	var openErr error
	mygo.RunOnMain(func() {
		host, openErr = openMygoPublicBrowserSession(proxy, nil)
	})
	if openErr == nil {
		host.CloseAll()
		t.Fatalf("expected %s override to be rejected fail-closed", envKey)
	}
	if !strings.Contains(openErr.Error(), "WebView2 environment overrides") {
		t.Fatalf("unexpected error for %s: %v", envKey, openErr)
	}
}

func TestG4PublicBrowserRejectsWindowsAdditionalArgsOverride(t *testing.T) {
	runNativeWindowsEnvOverrideProbe(t, "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--proxy-server=direct://")
}

func TestG4PublicBrowserRejectsWindowsUserDataFolderOverride(t *testing.T) {
	runNativeWindowsEnvOverrideProbe(t, "WEBVIEW2_USER_DATA_FOLDER", t.TempDir())
}
