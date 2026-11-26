//go:build darwin

package shell

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ebitengine/purego/objc"
)

func TestReadSparkleBundleConfigValidation(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString(make([]byte, 32))

	makeApp := func(t *testing.T, plist string, withFramework bool) string {
		t.Helper()
		root := t.TempDir()
		contents := filepath.Join(root, "Molly.app", "Contents")
		exePath := filepath.Join(contents, "MacOS", "Molly")
		if err := os.MkdirAll(filepath.Dir(exePath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(exePath, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(plist), 0o644); err != nil {
			t.Fatal(err)
		}
		if withFramework {
			fwBin := filepath.Join(contents, "Frameworks", "Sparkle.framework", "Sparkle")
			if err := os.MkdirAll(filepath.Dir(fwBin), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(fwBin, []byte("stub"), 0o755); err != nil {
				t.Fatal(err)
			}
		}
		return exePath
	}

	validPlist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.molly-design.app</string>
  <key>SUFeedURL</key><string>https://github.com/LeonEthan/molly-design/releases/latest/download/appcast.xml</string>
  <key>SUPublicEDKey</key><string>` + validKey + `</string>
</dict></plist>`

	exe := makeApp(t, validPlist, true)
	cfg, err := ReadSparkleBundleConfig(exe, false)
	if err != nil {
		t.Fatalf("expected valid Sparkle bundle config, got %v", err)
	}
	if cfg.BundleID != "dev.molly-design.app" || cfg.PublicEDKey != validKey {
		t.Fatalf("unexpected bundle config: %+v", cfg)
	}

	placeholderPlist := `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.molly-design.app</string>
  <key>SUFeedURL</key><string>https://github.com/LeonEthan/molly-design/releases/latest/download/appcast.xml</string>
  <key>SUPublicEDKey</key><string>` + SparklePublicKeyPlaceholder + `</string>
</dict></plist>`
	if _, err := ReadSparkleBundleConfig(makeApp(t, placeholderPlist, true), false); err == nil {
		t.Fatal("expected placeholder SUPublicEDKey to be rejected")
	}

	if _, err := ReadSparkleBundleConfig(makeApp(t, validPlist, false), false); err == nil {
		t.Fatal("expected missing Sparkle.framework to be rejected")
	}
}

func TestSparklePureGoFrameworkLoadAndBlockInvoke(t *testing.T) {
	// Verify ABI-level Objective-C block invocation with zero cgo.
	calledVoid := false
	voidBlk := objc.NewBlock(func(_ objc.Block) {
		calledVoid = true
	})
	defer voidBlk.Release()
	invokeObjCBlockVoid(voidBlk)
	if !calledVoid {
		t.Fatal("invokeObjCBlockVoid did not invoke Objective-C block")
	}

	var gotChoice int64 = -1
	choiceBlk := objc.NewBlock(func(_ objc.Block, choice int64) {
		gotChoice = choice
	})
	defer choiceBlk.Release()
	invokeObjCBlockArg(choiceBlk, uintptr(spuUserUpdateChoiceInstall))
	if gotChoice != spuUserUpdateChoiceInstall {
		t.Fatalf("expected choice %d, got %d", spuUserUpdateChoiceInstall, gotChoice)
	}

	vendoredFramework := filepath.Join("..", "..", "apps", "electron", "node_modules", "electron-sparkle-updater", "native", "vendor", "Sparkle.framework", "Versions", "B", "Sparkle")
	if _, err := os.Stat(vendoredFramework); err != nil {
		t.Skipf("vendored Sparkle.framework not present: %v", err)
	}
	if err := LoadSparkleFramework(vendoredFramework); err != nil {
		t.Fatalf("LoadSparkleFramework failed: %v", err)
	}
	if objc.GetClass("SPUUpdater") == 0 {
		t.Fatal("SPUUpdater class missing after dlopen")
	}
	if objc.GetClass("SUUpdatePermissionResponse") == 0 {
		t.Fatal("SUUpdatePermissionResponse class missing after dlopen")
	}
	if sparkleDriverClass == 0 || sparkleDelegateClass == 0 {
		t.Fatal("Molly Sparkle ObjC classes were not registered")
	}
}

func TestSparkleCycleCompletionSettlesCheckingAndAbortsPendingRelaunch(t *testing.T) {
	var aborted bool
	u := &SparkleUpdater{
		now: time.Now,
		hooks: UpdaterHooks{
			AbortRelaunch: func() { aborted = true },
		},
		state: UpdaterState{
			Phase:          UpdaterPhaseChecking,
			CurrentVersion: "0.2.0",
		},
	}

	// Silent cycle completion with nil error must settle checking -> up_to_date.
	u.handleUpdateCycleFinished("")
	if st := u.GetState(); st.Phase != UpdaterPhaseUpToDate {
		t.Fatalf("expected checking to settle to up_to_date, got %+v", st)
	}

	// Cycle completion with error must settle checking -> error.
	u.state.Phase = UpdaterPhaseChecking
	u.handleUpdateCycleFinished("network_timeout")
	if st := u.GetState(); st.Phase != UpdaterPhaseError || st.Error != "network_timeout" {
		t.Fatalf("expected checking to settle to error, got %+v", st)
	}

	// Pending relaunch failure must preserve downloaded state and trigger AbortRelaunch.
	u.state = UpdaterState{
		Phase:             UpdaterPhaseDownloaded,
		CurrentVersion:    "0.2.0",
		DownloadedVersion: "0.2.1",
	}
	u.relaunchPending = true
	u.handleUpdateCycleFinished("install_aborted")
	if !aborted {
		t.Fatal("expected AbortRelaunch to run when Sparkle cycle ends during pending relaunch")
	}
	if st := u.GetState(); st.Phase != UpdaterPhaseDownloaded || st.Error != "install_aborted" {
		t.Fatalf("expected downloaded phase preserved with error, got %+v", st)
	}
}
