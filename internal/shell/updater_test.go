package shell

import (
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type stubLockHandle struct {
	closed bool
}

func (h *stubLockHandle) Close() error {
	h.closed = true
	return nil
}

type stubNSISVerifier struct {
	err        error
	publisher  string
	path       string
	lastHandle *stubLockHandle
}

func (v *stubNSISVerifier) VerifyInstaller(_ context.Context, installerPath, expectedPublisher string) error {
	v.path = installerPath
	v.publisher = expectedPublisher
	return v.err
}

func (v *stubNSISVerifier) LockAndVerifyInstaller(_ context.Context, installerPath, expectedSHA512, expectedPublisher string) (io.Closer, error) {
	v.path = installerPath
	v.publisher = expectedPublisher
	if err := verifyFileSHA512Base64(installerPath, expectedSHA512); err != nil {
		return nil, err
	}
	if v.err != nil {
		return nil, fmt.Errorf("installer_signature_invalid:%w", v.err)
	}
	h := &stubLockHandle{}
	v.lastHandle = h
	return h, nil
}

type stubNSISLauncher struct {
	err      error
	launched string
}

func (l *stubNSISLauncher) LaunchSilentInstaller(installerPath string) error {
	l.launched = installerPath
	return l.err
}

func sha512Base64(data []byte) string {
	sum := sha512.Sum512(data)
	return base64.StdEncoding.EncodeToString(sum[:])
}

func TestUpdaterValidationHelpers(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString(make([]byte, 32))
	if err := validateSparklePublicKey(validKey); err != nil {
		t.Fatalf("expected valid 32-byte key to pass, got %v", err)
	}
	for _, bad := range []string{"", SparklePublicKeyPlaceholder, "not-base64!", base64.StdEncoding.EncodeToString([]byte("short"))} {
		if err := validateSparklePublicKey(bad); err == nil {
			t.Fatalf("expected key %q to fail validation", bad)
		}
	}

	if _, err := validateUpdateFeedURL(DefaultSparkleAppcastURL, false); err != nil {
		t.Fatalf("expected default HTTPS feed to pass, got %v", err)
	}
	if _, err := validateUpdateFeedURL("http://127.0.0.1:4371/appcast.xml", false); err == nil {
		t.Fatal("expected HTTP loopback feed to fail without allowLoopbackHTTP")
	}
	if _, err := validateUpdateFeedURL("http://127.0.0.1:4371/appcast.xml", true); err != nil {
		t.Fatalf("expected HTTP loopback feed to pass with allowLoopbackHTTP, got %v", err)
	}
	if _, err := validateUpdateFeedURL("http://example.com/appcast.xml", true); err == nil {
		t.Fatal("expected non-loopback HTTP feed to fail even with allowLoopbackHTTP")
	}
	if _, err := validateUpdateFeedURL("https://user:pass@example.com/latest.yml", false); err == nil {
		t.Fatal("expected feed URL with userinfo to fail")
	}

	if compareSemver("0.2.1", "0.2.0") <= 0 {
		t.Fatal("expected 0.2.1 > 0.2.0")
	}
	if compareSemver("0.2.0", "0.2.0") != 0 {
		t.Fatal("expected 0.2.0 == 0.2.0")
	}
	if compareSemver("0.2.0", "0.2.0-beta.1") <= 0 {
		t.Fatal("expected stable 0.2.0 > prerelease 0.2.0-beta.1")
	}
	if compareSemver("0.2.0-beta.2", "0.2.0-beta.10") >= 0 {
		t.Fatal("expected 0.2.0-beta.2 < 0.2.0-beta.10")
	}
}

func TestParseNSISLatestYML(t *testing.T) {
	payload := []byte("installer-bytes")
	digest := sha512Base64(payload)
	raw := fmt.Sprintf(`version: 0.3.0
files:
  - url: MollyDesign-0.3.0-x64-setup.exe
    sha512: %s
    size: %d
path: MollyDesign-0.3.0-x64-setup.exe
sha512: %s
releaseDate: '2026-11-26T00:00:00.000Z'
`, digest, len(payload), digest)

	m, err := ParseNSISLatestYML([]byte(raw))
	if err != nil {
		t.Fatalf("ParseNSISLatestYML: %v", err)
	}
	if m.Version != "0.3.0" || m.Path != "MollyDesign-0.3.0-x64-setup.exe" || m.SHA512 != digest || m.Size != int64(len(payload)) || m.ReleaseDate != "2026-11-26T00:00:00.000Z" {
		t.Fatalf("unexpected parsed manifest: %+v", m)
	}

	for _, bad := range []string{
		fmt.Sprintf("version: 0.3.0\npath: ../evil.exe\nsha512: %s\n", digest),
		fmt.Sprintf("version: 0.3.0\npath: https://evil.example/setup.exe\nsha512: %s\n", digest),
		fmt.Sprintf("version: 0.3.0\npath: script.bat\nsha512: %s\n", digest),
		"version: 0.3.0\npath: setup.exe\nsha512: not-valid-sha512\n",
		fmt.Sprintf("path: setup.exe\nsha512: %s\n", digest),
	} {
		if _, err := ParseNSISLatestYML([]byte(bad)); err == nil {
			t.Fatalf("expected invalid latest.yml to fail:\n%s", bad)
		}
	}
}

func TestNSISUpdaterLifecycleAndBridgeIPC(t *testing.T) {
	installerBytes := []byte("MZ-synthetic-molly-nsis-installer-payload-0.3.0")
	digest := sha512Base64(installerBytes)
	const installerName = "MollyDesign-0.3.0-x64-setup.exe"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest.yml":
			fmt.Fprintf(w, "version: 0.3.0\npath: %s\nsha512: %s\nreleaseDate: '2026-11-26T12:00:00Z'\n", installerName, digest)
		case "/" + installerName:
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(installerBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	clockNow := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	verifier := &stubNSISVerifier{}
	launcher := &stubNSISLauncher{}
	var prepared, quitCalled bool
	var mu sync.Mutex
	var pushed []UpdaterState

	updater, err := NewNSISUpdater(NSISUpdaterConfig{
		CurrentVersion:    "0.2.0",
		FeedURL:           srv.URL + "/latest.yml",
		ExpectedPublisher: DefaultWindowsPublisher,
		DownloadDir:       t.TempDir(),
		AllowLoopbackHTTP: true,
		HTTPClient:        srv.Client(),
		Verifier:          verifier,
		Launcher:          launcher,
		Now:               func() time.Time { return clockNow },
		Hooks: UpdaterHooks{
			PrepareToRelaunch: func(context.Context) error {
				prepared = true
				return nil
			},
			Quit: func() {
				quitCalled = true
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer updater.Close()

	bridge := NewMollyBridge(BridgeConfig{
		AppVersion: "0.2.0",
		DataDir:    t.TempDir(),
		Updater:    updater,
		OnEmitPush: func(channel string, payload any) {
			if channel != "updater.state" {
				return
			}
			if st, ok := payload.(UpdaterState); ok {
				mu.Lock()
				pushed = append(pushed, st)
				mu.Unlock()
			}
		},
	})
	updater.cfg.Hooks.OnStateChange = func(st UpdaterState) {
		_ = bridge.EmitToWorkbench("updater.state", st)
	}

	gen := bridge.CurrentDocGeneration()
	rawCheck, err := bridge.Invoke(t.Context(), gen, "updater.checkForUpdates", nil)
	if err != nil {
		t.Fatal(err)
	}
	checkRes := rawCheck.(CheckForUpdateResult)
	if !checkRes.Started || checkRes.Error != "" {
		t.Fatalf("unexpected check result: %+v", checkRes)
	}

	rawState, err := bridge.Invoke(t.Context(), gen, "updater.getState", nil)
	if err != nil {
		t.Fatal(err)
	}
	state := rawState.(UpdaterState)
	if state.Phase != UpdaterPhaseDownloaded || state.DownloadedVersion != "0.3.0" || state.AvailableVersion != "0.3.0" {
		t.Fatalf("unexpected downloaded state: %+v", state)
	}
	if verifier.publisher != DefaultWindowsPublisher {
		t.Fatalf("expected publisher %q, got %q", DefaultWindowsPublisher, verifier.publisher)
	}

	rawInstall, err := bridge.Invoke(t.Context(), gen, "updater.quitAndInstall", nil)
	if err != nil {
		t.Fatal(err)
	}
	installRes := rawInstall.(QuitAndInstallUpdateResult)
	if !installRes.OK || !prepared || !quitCalled || filepath.Base(launcher.launched) != installerName {
		t.Fatalf("unexpected install outcome: res=%+v prepared=%v quit=%v launched=%q", installRes, prepared, quitCalled, launcher.launched)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(pushed) < 3 || pushed[0].Phase != UpdaterPhaseChecking || pushed[len(pushed)-1].Phase != UpdaterPhaseDownloaded {
		b, _ := json.Marshal(pushed)
		t.Fatalf("unexpected pushed state sequence: %s", string(b))
	}
}

func TestNSISUpdaterUpToDateAndRejectionPaths(t *testing.T) {
	t.Run("up_to_date", func(t *testing.T) {
		digest := sha512Base64([]byte("same"))
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprintf(w, "version: 0.2.0\npath: MollyDesign-0.2.0-x64-setup.exe\nsha512: %s\n", digest)
		}))
		defer srv.Close()

		u, err := NewNSISUpdater(NSISUpdaterConfig{
			CurrentVersion:    "0.2.0",
			FeedURL:           srv.URL + "/latest.yml",
			DownloadDir:       t.TempDir(),
			AllowLoopbackHTTP: true,
			HTTPClient:        srv.Client(),
			Verifier:          &stubNSISVerifier{},
			Launcher:          &stubNSISLauncher{},
		})
		if err != nil {
			t.Fatal(err)
		}
		if res := u.CheckForUpdates(t.Context()); !res.Started {
			t.Fatalf("expected check to succeed, got %+v", res)
		}
		if st := u.GetState(); st.Phase != UpdaterPhaseUpToDate {
			t.Fatalf("expected up_to_date, got %+v", st)
		}
	})

	t.Run("rejects_sha512_tampering_and_removes_file", func(t *testing.T) {
		goodDigest := sha512Base64([]byte("expected-payload"))
		dlDir := t.TempDir()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/latest.yml" {
				fmt.Fprintf(w, "version: 0.3.0\npath: MollyDesign-0.3.0-x64-setup.exe\nsha512: %s\n", goodDigest)
				return
			}
			_, _ = w.Write([]byte("tampered-payload"))
		}))
		defer srv.Close()

		u, err := NewNSISUpdater(NSISUpdaterConfig{
			CurrentVersion:    "0.2.0",
			FeedURL:           srv.URL + "/latest.yml",
			DownloadDir:       dlDir,
			AllowLoopbackHTTP: true,
			HTTPClient:        srv.Client(),
			Verifier:          &stubNSISVerifier{},
			Launcher:          &stubNSISLauncher{},
		})
		if err != nil {
			t.Fatal(err)
		}
		res := u.CheckForUpdates(t.Context())
		if res.Started || !strings.Contains(res.Error, "installer_sha512_mismatch") {
			t.Fatalf("expected sha512 mismatch error, got %+v", res)
		}
		if st := u.GetState(); st.Phase != UpdaterPhaseError {
			t.Fatalf("expected error phase, got %+v", st)
		}
		entries, _ := os.ReadDir(dlDir)
		if len(entries) != 0 {
			t.Fatalf("tampered file left behind in download dir: %d entries", len(entries))
		}
	})

	t.Run("rejects_invalid_signature_and_removes_file", func(t *testing.T) {
		payload := []byte("unsigned-installer")
		dlDir := t.TempDir()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/latest.yml" {
				fmt.Fprintf(w, "version: 0.3.0\npath: MollyDesign-0.3.0-x64-setup.exe\nsha512: %s\n", sha512Base64(payload))
				return
			}
			_, _ = w.Write(payload)
		}))
		defer srv.Close()

		u, err := NewNSISUpdater(NSISUpdaterConfig{
			CurrentVersion:    "0.2.0",
			FeedURL:           srv.URL + "/latest.yml",
			DownloadDir:       dlDir,
			AllowLoopbackHTTP: true,
			HTTPClient:        srv.Client(),
			Verifier:          &stubNSISVerifier{err: errors.New("publisher_mismatch")},
			Launcher:          &stubNSISLauncher{},
		})
		if err != nil {
			t.Fatal(err)
		}
		res := u.CheckForUpdates(t.Context())
		if res.Started || !strings.Contains(res.Error, "installer_signature_invalid") {
			t.Fatalf("expected signature invalid error, got %+v", res)
		}
		entries, _ := os.ReadDir(dlDir)
		if len(entries) != 0 {
			t.Fatalf("unverified file left behind in download dir: %d entries", len(entries))
		}
	})

	t.Run("failed_relaunch_preserves_downloaded_phase_for_retry_and_catches_toctou", func(t *testing.T) {
		payload := []byte("signed-installer-payload")
		dlDir := t.TempDir()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/latest.yml" {
				fmt.Fprintf(w, "version: 0.3.0\npath: MollyDesign-0.3.0-x64-setup.exe\nsha512: %s\n", sha512Base64(payload))
				return
			}
			_, _ = w.Write(payload)
		}))
		defer srv.Close()

		aborted := false
		launcher := &stubNSISLauncher{err: errors.New("launch_failed")}
		u, err := NewNSISUpdater(NSISUpdaterConfig{
			CurrentVersion:    "0.2.0",
			FeedURL:           srv.URL + "/latest.yml",
			DownloadDir:       dlDir,
			AllowLoopbackHTTP: true,
			HTTPClient:        srv.Client(),
			Verifier:          &stubNSISVerifier{},
			Launcher:          launcher,
			Hooks: UpdaterHooks{
				AbortRelaunch: func() { aborted = true },
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if res := u.CheckForUpdates(t.Context()); !res.Started {
			t.Fatalf("download failed: %+v", res)
		}
		res := u.QuitAndInstall(t.Context())
		if res.OK || !aborted {
			t.Fatalf("expected failed launch to abort relaunch, got res=%+v aborted=%v", res, aborted)
		}
		if st := u.GetState(); st.Phase != UpdaterPhaseDownloaded || st.Error != "launch_failed" {
			t.Fatalf("expected downloaded phase preserved for retry, got %+v", st)
		}

		// Simulate disk tampering before retry: QuitAndInstall must fail closed.
		launcher.err = nil
		if err := os.WriteFile(filepath.Join(dlDir, "MollyDesign-0.3.0-x64-setup.exe"), []byte("corrupted"), 0o600); err != nil {
			t.Fatal(err)
		}
		retry := u.QuitAndInstall(t.Context())
		if retry.OK || !strings.Contains(retry.Error, "installer_sha512_mismatch") {
			t.Fatalf("expected TOCTOU tampering to fail closed, got %+v", retry)
		}
	})

	t.Run("holds_installer_lock_across_relaunch_hook_and_launch", func(t *testing.T) {
		payload := []byte("signed-locked-installer")
		dlDir := t.TempDir()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/latest.yml" {
				fmt.Fprintf(w, "version: 0.3.0\npath: MollyDesign-0.3.0-x64-setup.exe\nsha512: %s\n", sha512Base64(payload))
				return
			}
			_, _ = w.Write(payload)
		}))
		defer srv.Close()

		verifier := &stubNSISVerifier{}
		lockOpenDuringPrepare := false
		lockOpenDuringLaunch := false
		launcher := &stubNSISLauncher{}
		u, err := NewNSISUpdater(NSISUpdaterConfig{
			CurrentVersion:    "0.2.0",
			FeedURL:           srv.URL + "/latest.yml",
			DownloadDir:       dlDir,
			AllowLoopbackHTTP: true,
			HTTPClient:        srv.Client(),
			Verifier:          verifier,
			Launcher:          launcher,
			Hooks: UpdaterHooks{
				PrepareToRelaunch: func(context.Context) error {
					lockOpenDuringPrepare = verifier.lastHandle != nil && !verifier.lastHandle.closed
					return nil
				},
				Quit: func() {
					lockOpenDuringLaunch = verifier.lastHandle != nil && !verifier.lastHandle.closed
				},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if res := u.CheckForUpdates(t.Context()); !res.Started {
			t.Fatalf("download failed: %+v", res)
		}
		if res := u.QuitAndInstall(t.Context()); !res.OK {
			t.Fatalf("QuitAndInstall failed: %+v", res)
		}
		if !lockOpenDuringPrepare || !lockOpenDuringLaunch || !verifier.lastHandle.closed {
			t.Fatalf("expected installer handle held during prepare/launch and closed after: prepare=%v launch=%v closed=%v",
				lockOpenDuringPrepare, lockOpenDuringLaunch, verifier.lastHandle.closed)
		}
	})

	t.Run("rejects_redirects_to_disallowed_scheme_or_non_loopback_http", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "http://example.com/evil-latest.yml", http.StatusFound)
		}))
		defer srv.Close()

		u, err := NewNSISUpdater(NSISUpdaterConfig{
			CurrentVersion:    "0.2.0",
			FeedURL:           srv.URL + "/latest.yml",
			DownloadDir:       t.TempDir(),
			AllowLoopbackHTTP: true,
			HTTPClient:        srv.Client(),
			Verifier:          &stubNSISVerifier{},
			Launcher:          &stubNSISLauncher{},
		})
		if err != nil {
			t.Fatal(err)
		}
		res := u.CheckForUpdates(t.Context())
		if res.Started || !strings.Contains(res.Error, "update_redirect_rejected") {
			t.Fatalf("expected redirect to non-loopback HTTP to be rejected, got %+v", res)
		}
	})
}

func TestPrepareUpdateFlushAllowsRetrySaveAndKeepEditingWithoutStoppingServices(t *testing.T) {
	gate := NewCanvasAccessGate()
	gate.UpdateFromDaemon(nil, nil)
	ctrl := newMygoDesignController(nil, gate, nil)
	ctrl.instances[canvasInstanceKey("art-1", "host-1")] = &mygoCanvasInstance{artworkID: "art-1", hostID: "host-1"}

	// First attempt: user clicks Keep Editing -> gate stays writable and phase returns to idle.
	var sawWritableDuringConfirm bool
	rel, err := ctrl.PrepareUpdateFlush(func(_ *mygoCanvasInstance, _ string) (bool, bool) {
		sawWritableDuringConfirm = gate.IsWriteAllowed("art-1", "")
		return false, false
	})
	if err == nil || rel != nil || !sawWritableDuringConfirm || !gate.IsWriteAllowed("art-1", "") {
		t.Fatalf("expected canceled update flush to keep gate writable: err=%v rel=%v sawWritable=%v writable=%v",
			err, rel != nil, sawWritableDuringConfirm, gate.IsWriteAllowed("art-1", ""))
	}

	// Second attempt: canvas flushes clean -> gate blocks writes while updating and rollback restores it.
	rel, err = ctrl.PrepareUpdateFlush(func(_ *mygoCanvasInstance, _ string) (bool, bool) {
		if !gate.IsWriteAllowed("art-1", "") {
			t.Error("gate should remain writable while flushing before update")
		}
		return true, false
	})
	if err != nil || rel == nil || gate.IsWriteAllowed("art-1", "") {
		t.Fatalf("expected update flush to approve and freeze: err=%v writable=%v", err, gate.IsWriteAllowed("art-1", ""))
	}
	rel()
	if !gate.IsWriteAllowed("art-1", "") || ctrl.exit.phase != quitIdle {
		t.Fatalf("expected rollback to restore gate and idle phase: writable=%v phase=%v", gate.IsWriteAllowed("art-1", ""), ctrl.exit.phase)
	}
}
