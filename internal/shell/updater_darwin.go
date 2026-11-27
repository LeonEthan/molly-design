//go:build darwin

package shell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
)

const (
	spuUserUpdateChoiceSkip    int64 = 0
	spuUserUpdateChoiceInstall int64 = 1
	spuUserUpdateChoiceDismiss int64 = 2

	spuUserUpdateStageInstalling int64 = 2
)

type objcBlockABI struct {
	isa        uintptr
	flags      uint32
	reserved   uint32
	invoke     uintptr
	descriptor uintptr
}

var loadDarwinLibC = sync.OnceValue(func() struct {
	memcpy         func(dst unsafe.Pointer, src uintptr, n uintptr)
	strlen         func(src uintptr) uintptr
	msgSendBool    func(self objc.ID, sel objc.SEL) bool
	msgSendOutBool func(self objc.ID, sel objc.SEL, errOut *objc.ID) bool
} {
	var api struct {
		memcpy         func(dst unsafe.Pointer, src uintptr, n uintptr)
		strlen         func(src uintptr) uintptr
		msgSendBool    func(self objc.ID, sel objc.SEL) bool
		msgSendOutBool func(self objc.ID, sel objc.SEL, errOut *objc.ID) bool
	}
	if lib, err := purego.Dlopen("/usr/lib/libSystem.B.dylib", purego.RTLD_GLOBAL|purego.RTLD_NOW); err == nil {
		purego.RegisterLibFunc(&api.memcpy, lib, "memcpy")
		purego.RegisterLibFunc(&api.strlen, lib, "strlen")
	}
	if libObjC, err := purego.Dlopen("/usr/lib/libobjc.A.dylib", purego.RTLD_GLOBAL|purego.RTLD_NOW); err == nil {
		purego.RegisterLibFunc(&api.msgSendBool, libObjC, "objc_msgSend")
		purego.RegisterLibFunc(&api.msgSendOutBool, libObjC, "objc_msgSend")
	}
	return api
})

func readBlockInvoke(block objc.Block) uintptr {
	if block == 0 {
		return 0
	}
	api := loadDarwinLibC()
	if api.memcpy == nil {
		return 0
	}
	var layout objcBlockABI
	api.memcpy(unsafe.Pointer(&layout), uintptr(block), unsafe.Sizeof(layout))
	return layout.invoke
}

func invokeObjCBlockVoid(block objc.Block) {
	if invoke := readBlockInvoke(block); invoke != 0 {
		_, _, _ = purego.SyscallN(invoke, uintptr(block))
	}
}

func invokeObjCBlockArg(block objc.Block, arg uintptr) {
	if invoke := readBlockInvoke(block); invoke != 0 {
		_, _, _ = purego.SyscallN(invoke, uintptr(block), arg)
	}
}

type SparkleBundleConfig struct {
	BundleID      string
	FeedURL       string
	PublicEDKey   string
	FrameworkPath string
}

func ReadSparkleBundleConfig(executablePath string, allowLoopbackHTTP bool) (SparkleBundleConfig, error) {
	if executablePath == "" {
		var err error
		executablePath, err = os.Executable()
		if err != nil {
			return SparkleBundleConfig{}, err
		}
	}
	if realExe, err := filepath.EvalSymlinks(executablePath); err == nil {
		executablePath = realExe
	}
	contentsDir := filepath.Dir(filepath.Dir(executablePath))
	plistPath := filepath.Join(contentsDir, "Info.plist")
	if _, err := os.Stat(plistPath); err != nil {
		return SparkleBundleConfig{}, errors.New("sparkle_not_in_app_bundle")
	}
	frameworkPath := filepath.Join(contentsDir, "Frameworks", "Sparkle.framework", "Sparkle")
	if _, err := os.Stat(frameworkPath); err != nil {
		return SparkleBundleConfig{}, errors.New("sparkle_framework_missing")
	}

	readPlistKey := func(key string) (string, error) {
		out, err := exec.Command("/usr/bin/plutil", "-extract", key, "raw", "-o", "-", plistPath).Output()
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(out)), nil
	}

	bundleID, err := readPlistKey("CFBundleIdentifier")
	if err != nil || bundleID == "" {
		return SparkleBundleConfig{}, errors.New("sparkle_bundle_id_missing")
	}
	feedURL, err := readPlistKey("SUFeedURL")
	if err != nil {
		return SparkleBundleConfig{}, errors.New("sparkle_feed_url_missing")
	}
	if _, err := validateUpdateFeedURL(feedURL, allowLoopbackHTTP); err != nil {
		return SparkleBundleConfig{}, err
	}
	publicKey, err := readPlistKey("SUPublicEDKey")
	if err != nil {
		return SparkleBundleConfig{}, errors.New("sparkle_public_key_missing")
	}
	if err := validateSparklePublicKey(publicKey); err != nil {
		return SparkleBundleConfig{}, err
	}
	return SparkleBundleConfig{
		BundleID:      bundleID,
		FeedURL:       feedURL,
		PublicEDKey:   publicKey,
		FrameworkPath: frameworkPath,
	}, nil
}

var (
	sparkleLoadMu        sync.Mutex
	sparkleFrameworkOnce bool
	sparkleDriverClass   objc.Class
	sparkleDelegateClass objc.Class
	activeSparkleMu      sync.RWMutex
	activeSparkle        *SparkleUpdater
)

type SparkleUpdater struct {
	cfg   SparkleBundleConfig
	hooks UpdaterHooks
	now   func() time.Time

	mu              sync.Mutex
	state           UpdaterState
	updaterID       objc.ID
	userDriverID    objc.ID
	delegateID      objc.ID
	expectedLen     uint64
	receivedLen     uint64
	updateVersion   string
	installWhenRdy  bool
	readyReplyBlock objc.Block
	checkCancelBlk  objc.Block
	installInFlight bool
	relaunchPending bool
	closed          bool
}

func newPlatformUpdater(cfg DesktopUpdaterConfig) UpdaterService {
	allowLoopback := cfg.AllowLoopbackHTTP || os.Getenv("MOLLY_UPDATER_ALLOW_LOOPBACK_HTTP") == "1"
	bundleCfg, err := ReadSparkleBundleConfig("", allowLoopback)
	if err != nil {
		return newDisabledUpdater(cfg.CurrentVersion, UpdaterDisabledReasonDefault, "updater_disabled_in_experimental_mygo_shell")
	}
	u, err := NewSparkleUpdater(cfg.CurrentVersion, bundleCfg, cfg.Hooks)
	if err != nil {
		return newDisabledUpdater(cfg.CurrentVersion, err.Error(), "updater_disabled")
	}
	return u
}

func LoadSparkleFramework(frameworkPath string) error {
	sparkleLoadMu.Lock()
	defer sparkleLoadMu.Unlock()
	if sparkleFrameworkOnce {
		return nil
	}
	if _, err := purego.Dlopen(frameworkPath, purego.RTLD_NOW|purego.RTLD_GLOBAL); err != nil {
		return fmt.Errorf("dlopen_sparkle:%w", err)
	}
	if objc.GetClass("SPUUpdater") == 0 {
		return errors.New("sparkle_spuupdater_class_missing")
	}
	if err := registerSparkleObjCClasses(); err != nil {
		return err
	}
	sparkleFrameworkOnce = true
	return nil
}

func NewSparkleUpdater(currentVersion string, bundleCfg SparkleBundleConfig, hooks UpdaterHooks) (*SparkleUpdater, error) {
	if err := validateSparklePublicKey(bundleCfg.PublicEDKey); err != nil {
		return nil, err
	}
	if err := LoadSparkleFramework(bundleCfg.FrameworkPath); err != nil {
		return nil, err
	}
	u := &SparkleUpdater{
		cfg:   bundleCfg,
		hooks: hooks,
		now:   time.Now,
		state: UpdaterState{
			Phase:          UpdaterPhaseIdle,
			CurrentVersion: currentVersion,
		},
	}

	var initErr error
	start := func() {
		activeSparkleMu.Lock()
		activeSparkle = u
		activeSparkleMu.Unlock()

		userDriver := objc.ID(sparkleDriverClass).Send(objc.RegisterName("alloc")).Send(objc.RegisterName("init"))
		delegate := objc.ID(sparkleDelegateClass).Send(objc.RegisterName("alloc")).Send(objc.RegisterName("init"))
		mainBundle := objc.ID(objc.GetClass("NSBundle")).Send(objc.RegisterName("mainBundle"))
		updater := objc.ID(objc.GetClass("SPUUpdater")).Send(objc.RegisterName("alloc")).Send(
			objc.RegisterName("initWithHostBundle:applicationBundle:userDriver:delegate:"),
			mainBundle,
			mainBundle,
			userDriver,
			delegate,
		)
		if updater == 0 {
			initErr = errors.New("sparkle_init_failed")
			return
		}
		api := loadDarwinLibC()
		if api.msgSendOutBool == nil {
			initErr = errors.New("sparkle_objc_msgsend_unavailable")
			return
		}
		var nsErr objc.ID
		started := api.msgSendOutBool(updater, objc.RegisterName("startUpdater:"), &nsErr)
		if !started {
			msg := "sparkle_start_failed"
			if nsErr != 0 {
				if desc := nsStringToGo(nsErr.Send(objc.RegisterName("localizedDescription"))); desc != "" {
					msg = desc
				}
			}
			initErr = errors.New(msg)
			return
		}
		u.mu.Lock()
		u.updaterID = updater
		u.userDriverID = userDriver
		u.delegateID = delegate
		u.mu.Unlock()
	}

	if hooks.RunOnMain != nil {
		hooks.RunOnMain(start)
	} else {
		start()
	}
	if initErr != nil {
		return nil, initErr
	}
	return u, nil
}

func (u *SparkleUpdater) GetState() UpdaterState {
	u.mu.Lock()
	defer u.mu.Unlock()
	return cloneUpdaterState(u.state)
}

func (u *SparkleUpdater) CheckForUpdates(context.Context) CheckForUpdateResult {
	u.mu.Lock()
	if u.closed || u.updaterID == 0 {
		u.mu.Unlock()
		return CheckForUpdateResult{Started: false, Error: "updater_disabled"}
	}
	if !shouldResetPhaseForManualCheck(u.state.Phase) {
		snap := cloneUpdaterState(u.state)
		u.mu.Unlock()
		u.emit(snap)
		return CheckForUpdateResult{Started: false}
	}
	updater := u.updaterID
	u.mu.Unlock()

	var (
		canCheck bool
		inFlight bool
	)
	checkAndTrigger := func() {
		api := loadDarwinLibC()
		if api.msgSendBool != nil {
			canCheck = api.msgSendBool(updater, objc.RegisterName("canCheckForUpdates"))
			inFlight = api.msgSendBool(updater, objc.RegisterName("sessionInProgress"))
		}
		if !canCheck || inFlight {
			return
		}
		nowMs := u.now().UnixMilli()
		u.mu.Lock()
		u.state = UpdaterState{
			Phase:          UpdaterPhaseChecking,
			CurrentVersion: u.state.CurrentVersion,
			CheckedAtMs:    &nowMs,
		}
		snap := cloneUpdaterState(u.state)
		u.mu.Unlock()
		u.emit(snap)
		updater.Send(objc.RegisterName("checkForUpdates"))
	}
	if u.hooks.RunOnMain != nil {
		u.hooks.RunOnMain(checkAndTrigger)
	} else {
		checkAndTrigger()
	}
	if !canCheck || inFlight {
		return CheckForUpdateResult{Started: false, Error: "check_in_progress"}
	}
	return CheckForUpdateResult{Started: true}
}

func (u *SparkleUpdater) QuitAndInstall(ctx context.Context) QuitAndInstallUpdateResult {
	u.mu.Lock()
	if u.closed || u.updaterID == 0 {
		u.mu.Unlock()
		return QuitAndInstallUpdateResult{OK: false, Error: "updater_disabled"}
	}
	if u.state.Phase != UpdaterPhaseDownloaded {
		u.mu.Unlock()
		return QuitAndInstallUpdateResult{OK: false, Error: "update_not_downloaded"}
	}
	if u.installInFlight || u.relaunchPending {
		u.mu.Unlock()
		return QuitAndInstallUpdateResult{OK: false, Error: "update_install_in_progress"}
	}
	u.installInFlight = true
	u.mu.Unlock()

	defer func() {
		u.mu.Lock()
		u.installInFlight = false
		u.mu.Unlock()
	}()

	if ctx == nil {
		ctx = context.Background()
	}
	if u.hooks.PrepareToRelaunch != nil {
		if err := u.hooks.PrepareToRelaunch(ctx); err != nil {
			if u.hooks.AbortRelaunch != nil {
				u.hooks.AbortRelaunch()
			}
			u.recordError(err.Error())
			return QuitAndInstallUpdateResult{OK: false, Error: err.Error()}
		}
	}

	u.mu.Lock()
	u.relaunchPending = true
	u.mu.Unlock()

	install := func() {
		u.mu.Lock()
		reply := u.readyReplyBlock
		u.readyReplyBlock = 0
		updater := u.updaterID
		if reply == 0 {
			u.installWhenRdy = true
		}
		u.mu.Unlock()

		if reply != 0 {
			invokeObjCBlockArg(reply, uintptr(spuUserUpdateChoiceInstall))
			reply.Release()
			return
		}
		if updater != 0 {
			updater.Send(objc.RegisterName("checkForUpdates"))
		}
	}
	if u.hooks.RunOnMain != nil {
		u.hooks.RunOnMain(install)
	} else {
		install()
	}
	return QuitAndInstallUpdateResult{OK: true}
}

func (u *SparkleUpdater) Close() {
	u.mu.Lock()
	u.closed = true
	reply := u.readyReplyBlock
	u.readyReplyBlock = 0
	cancelBlk := u.checkCancelBlk
	u.checkCancelBlk = 0
	u.mu.Unlock()
	if reply != 0 {
		reply.Release()
	}
	if cancelBlk != 0 {
		cancelBlk.Release()
	}
	activeSparkleMu.Lock()
	if activeSparkle == u {
		activeSparkle = nil
	}
	activeSparkleMu.Unlock()
}

func (u *SparkleUpdater) emit(state UpdaterState) {
	if u.hooks.OnStateChange != nil {
		u.hooks.OnStateChange(state)
	}
}

func (u *SparkleUpdater) recordError(msg string) {
	nowMs := u.now().UnixMilli()
	u.mu.Lock()
	next := cloneUpdaterState(u.state)
	if next.DownloadedVersion != "" && u.readyReplyBlock != 0 {
		next.Phase = UpdaterPhaseDownloaded
	} else {
		next.Phase = UpdaterPhaseError
	}
	next.Error = msg
	next.CheckedAtMs = &nowMs
	u.state = next
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	u.emit(snap)
}

func currentSparkleUpdater() *SparkleUpdater {
	activeSparkleMu.RLock()
	defer activeSparkleMu.RUnlock()
	return activeSparkle
}

func nsStringToGo(id objc.ID) string {
	if id == 0 {
		return ""
	}
	ptr := id.Send(objc.RegisterName("UTF8String"))
	if ptr == 0 {
		return ""
	}
	return cStringToGo(uintptr(ptr))
}

func cStringToGo(ptr uintptr) string {
	if ptr == 0 {
		return ""
	}
	api := loadDarwinLibC()
	if api.memcpy == nil || api.strlen == nil {
		return ""
	}
	length := api.strlen(ptr)
	if length == 0 {
		return ""
	}
	const maxLen = 64 * 1024
	if length > maxLen {
		length = maxLen
	}
	buf := make([]byte, length)
	api.memcpy(unsafe.Pointer(&buf[0]), ptr, length)
	return string(buf)
}

func (u *SparkleUpdater) abortPendingRelaunch() bool {
	u.mu.Lock()
	pending := u.relaunchPending
	u.relaunchPending = false
	u.mu.Unlock()
	if pending && u.hooks.AbortRelaunch != nil {
		u.hooks.AbortRelaunch()
	}
	return pending
}

func (u *SparkleUpdater) handleUpdateCycleFinished(errMsg string) {
	u.retireCheckCancellation()
	abortedRelaunch := u.abortPendingRelaunch()
	nowMs := u.now().UnixMilli()
	u.mu.Lock()
	if u.state.Phase != UpdaterPhaseChecking {
		if errMsg != "" || abortedRelaunch {
			next := cloneUpdaterState(u.state)
			if errMsg != "" {
				next.Error = errMsg
			} else {
				next.Error = "update_install_canceled"
			}
			next.CheckedAtMs = &nowMs
			u.state = next
			snap := cloneUpdaterState(u.state)
			u.mu.Unlock()
			u.emit(snap)
			return
		}
		u.mu.Unlock()
		return
	}
	if errMsg != "" {
		u.state = UpdaterState{
			Phase:          UpdaterPhaseError,
			CurrentVersion: u.state.CurrentVersion,
			Error:          errMsg,
			CheckedAtMs:    &nowMs,
		}
	} else {
		u.state = UpdaterState{
			Phase:          UpdaterPhaseUpToDate,
			CurrentVersion: u.state.CurrentVersion,
			CheckedAtMs:    &nowMs,
		}
	}
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	u.emit(snap)
}

func registerSparkleObjCClasses() error {
	if sparkleDriverClass != 0 {
		return nil
	}
	nsObject := objc.GetClass("NSObject")
	driverCls, err := objc.RegisterClass(
		"MollySparkleUserDriver",
		nsObject,
		nil,
		nil,
		[]objc.MethodDef{
			{
				Cmd: objc.RegisterName("showUpdatePermissionRequest:reply:"),
				Fn: func(_ objc.ID, _ objc.SEL, _ objc.ID, reply objc.Block) {
					respCls := objc.GetClass("SUUpdatePermissionResponse")
					if respCls == 0 || reply == 0 {
						return
					}
					resp := objc.ID(respCls).Send(objc.RegisterName("alloc")).Send(
						objc.RegisterName("initWithAutomaticUpdateChecks:sendSystemProfile:"),
						uintptr(1),
						uintptr(0),
					)
					invokeObjCBlockArg(reply, uintptr(resp))
				},
			},
			{
				Cmd: objc.RegisterName("showUserInitiatedUpdateCheckWithCancellation:"),
				Fn: func(_ objc.ID, _ objc.SEL, cancellation objc.Block) {
					u := currentSparkleUpdater()
					if u == nil {
						return
					}
					nowMs := u.now().UnixMilli()
					u.mu.Lock()
					if u.checkCancelBlk != 0 {
						u.checkCancelBlk.Release()
					}
					if cancellation != 0 {
						u.checkCancelBlk = cancellation.Copy()
					} else {
						u.checkCancelBlk = 0
					}
					u.state = UpdaterState{
						Phase:          UpdaterPhaseChecking,
						CurrentVersion: u.state.CurrentVersion,
						CheckedAtMs:    &nowMs,
					}
					snap := cloneUpdaterState(u.state)
					u.mu.Unlock()
					u.emit(snap)
				},
			},
			{
				Cmd: objc.RegisterName("showUpdateFoundWithAppcastItem:state:reply:"),
				Fn: func(_ objc.ID, _ objc.SEL, item objc.ID, stateObj objc.ID, reply objc.Block) {
					u := currentSparkleUpdater()
					if u == nil {
						invokeObjCBlockArg(reply, uintptr(spuUserUpdateChoiceDismiss))
						return
					}
					u.retireCheckCancellation()
					api := loadDarwinLibC()
					if item != 0 && api.msgSendBool != nil && api.msgSendBool(item, objc.RegisterName("isInformationOnlyUpdate")) {
						u.recordError("informational update")
						invokeObjCBlockArg(reply, uintptr(spuUserUpdateChoiceDismiss))
						return
					}
					version := ""
					releaseName := ""
					releaseNotes := ""
					if item != 0 {
						version = nsStringToGo(item.Send(objc.RegisterName("displayVersionString")))
						if version == "" {
							version = nsStringToGo(item.Send(objc.RegisterName("versionString")))
						}
						releaseName = nsStringToGo(item.Send(objc.RegisterName("title")))
						releaseNotes = nsStringToGo(item.Send(objc.RegisterName("itemDescription")))
					}
					var stage int64
					if stateObj != 0 {
						stage = int64(stateObj.Send(objc.RegisterName("stage")))
					}
					nowMs := u.now().UnixMilli()
					u.mu.Lock()
					u.updateVersion = version
					alreadyInstalling := stage == spuUserUpdateStageInstalling && !u.installWhenRdy
					if alreadyInstalling {
						u.state = UpdaterState{
							Phase:             UpdaterPhaseDownloaded,
							CurrentVersion:    u.state.CurrentVersion,
							AvailableVersion:  version,
							DownloadedVersion: version,
							ReleaseName:       releaseName,
							ReleaseNotes:      releaseNotes,
							CheckedAtMs:       &nowMs,
						}
					} else {
						u.state = UpdaterState{
							Phase:            UpdaterPhaseDownloading,
							CurrentVersion:   u.state.CurrentVersion,
							AvailableVersion: version,
							ReleaseName:      releaseName,
							ReleaseNotes:     releaseNotes,
							CheckedAtMs:      &nowMs,
						}
					}
					snap := cloneUpdaterState(u.state)
					u.mu.Unlock()
					u.emit(snap)
					if alreadyInstalling {
						invokeObjCBlockArg(reply, uintptr(spuUserUpdateChoiceDismiss))
						return
					}
					invokeObjCBlockArg(reply, uintptr(spuUserUpdateChoiceInstall))
				},
			},
			{
				Cmd: objc.RegisterName("showUpdateReleaseNotesWithDownloadData:"),
				Fn:  func(_ objc.ID, _ objc.SEL, _ objc.ID) {},
			},
			{
				Cmd: objc.RegisterName("showUpdateReleaseNotesFailedToDownloadWithError:"),
				Fn:  func(_ objc.ID, _ objc.SEL, _ objc.ID) {},
			},
			{
				Cmd: objc.RegisterName("showUpdateNotFoundWithError:acknowledgement:"),
				Fn: func(_ objc.ID, _ objc.SEL, _ objc.ID, ack objc.Block) {
					if u := currentSparkleUpdater(); u != nil {
						u.retireCheckCancellation()
						nowMs := u.now().UnixMilli()
						u.mu.Lock()
						u.installWhenRdy = false
						if u.readyReplyBlock != 0 {
							u.readyReplyBlock.Release()
							u.readyReplyBlock = 0
						}
						u.state = UpdaterState{
							Phase:          UpdaterPhaseUpToDate,
							CurrentVersion: u.state.CurrentVersion,
							CheckedAtMs:    &nowMs,
						}
						snap := cloneUpdaterState(u.state)
						u.mu.Unlock()
						u.emit(snap)
					}
					invokeObjCBlockVoid(ack)
				},
			},
			{
				Cmd: objc.RegisterName("showUpdaterError:acknowledgement:"),
				Fn: func(_ objc.ID, _ objc.SEL, nsErr objc.ID, ack objc.Block) {
					if u := currentSparkleUpdater(); u != nil {
						u.retireCheckCancellation()
						u.abortPendingRelaunch()
						msg := "sparkle_error"
						if nsErr != 0 {
							if desc := nsStringToGo(nsErr.Send(objc.RegisterName("localizedDescription"))); desc != "" {
								msg = desc
							}
						}
						u.mu.Lock()
						u.installWhenRdy = false
						if u.readyReplyBlock != 0 {
							u.readyReplyBlock.Release()
							u.readyReplyBlock = 0
						}
						u.mu.Unlock()
						u.recordError(msg)
					}
					invokeObjCBlockVoid(ack)
				},
			},
			{
				Cmd: objc.RegisterName("showDownloadInitiatedWithCancellation:"),
				Fn: func(_ objc.ID, _ objc.SEL, _ objc.Block) {
					if u := currentSparkleUpdater(); u != nil {
						u.retireCheckCancellation()
						u.mu.Lock()
						u.receivedLen = 0
						u.expectedLen = 0
						u.mu.Unlock()
					}
				},
			},
			{
				Cmd: objc.RegisterName("showDownloadDidReceiveExpectedContentLength:"),
				Fn: func(_ objc.ID, _ objc.SEL, expected uint64) {
					if u := currentSparkleUpdater(); u != nil {
						u.mu.Lock()
						u.expectedLen = expected
						u.mu.Unlock()
					}
				},
			},
			{
				Cmd: objc.RegisterName("showDownloadDidReceiveDataOfLength:"),
				Fn: func(_ objc.ID, _ objc.SEL, length uint64) {
					u := currentSparkleUpdater()
					if u == nil {
						return
					}
					u.mu.Lock()
					u.receivedLen += length
					next := cloneUpdaterState(u.state)
					next.Phase = UpdaterPhaseDownloading
					transferred := int64(u.receivedLen)
					next.Transferred = &transferred
					if u.expectedLen > 0 {
						total := int64(u.expectedLen)
						next.Total = &total
						pct := float64(u.receivedLen) / float64(u.expectedLen) * 100
						if pct > 100 {
							pct = 100
						}
						next.Percent = &pct
					}
					u.state = next
					snap := cloneUpdaterState(u.state)
					u.mu.Unlock()
					u.emit(snap)
				},
			},
			{
				Cmd: objc.RegisterName("showDownloadDidStartExtractingUpdate"),
				Fn: func(_ objc.ID, _ objc.SEL) {
					u := currentSparkleUpdater()
					if u == nil {
						return
					}
					u.mu.Lock()
					next := cloneUpdaterState(u.state)
					next.Phase = UpdaterPhaseDownloading
					pct := 100.0
					next.Percent = &pct
					u.state = next
					snap := cloneUpdaterState(u.state)
					u.mu.Unlock()
					u.emit(snap)
				},
			},
			{
				Cmd: objc.RegisterName("showExtractionReceivedProgress:"),
				Fn:  func(_ objc.ID, _ objc.SEL, _ float64) {},
			},
			{
				Cmd: objc.RegisterName("showReadyToInstallAndRelaunch:"),
				Fn: func(_ objc.ID, _ objc.SEL, reply objc.Block) {
					u := currentSparkleUpdater()
					if u == nil {
						invokeObjCBlockArg(reply, uintptr(spuUserUpdateChoiceDismiss))
						return
					}
					u.mu.Lock()
					if u.installWhenRdy {
						u.installWhenRdy = false
						if u.readyReplyBlock != 0 {
							u.readyReplyBlock.Release()
							u.readyReplyBlock = 0
						}
						u.mu.Unlock()
						invokeObjCBlockArg(reply, uintptr(spuUserUpdateChoiceInstall))
						return
					}
					if u.readyReplyBlock != 0 {
						u.readyReplyBlock.Release()
					}
					if reply != 0 {
						u.readyReplyBlock = reply.Copy()
					}
					nowMs := u.now().UnixMilli()
					pct := 100.0
					u.state = UpdaterState{
						Phase:             UpdaterPhaseDownloaded,
						CurrentVersion:    u.state.CurrentVersion,
						AvailableVersion:  u.updateVersion,
						DownloadedVersion: u.updateVersion,
						ReleaseName:       u.state.ReleaseName,
						ReleaseDate:       u.state.ReleaseDate,
						ReleaseNotes:      u.state.ReleaseNotes,
						Percent:           &pct,
						CheckedAtMs:       &nowMs,
					}
					snap := cloneUpdaterState(u.state)
					u.mu.Unlock()
					u.emit(snap)
				},
			},
			{
				Cmd: objc.RegisterName("showInstallingUpdateWithApplicationTerminated:retryTerminatingApplication:"),
				Fn:  func(_ objc.ID, _ objc.SEL, _ bool, _ objc.Block) {},
			},
			{
				Cmd: objc.RegisterName("showUpdateInstalledAndRelaunched:acknowledgement:"),
				Fn: func(_ objc.ID, _ objc.SEL, _ bool, ack objc.Block) {
					invokeObjCBlockVoid(ack)
				},
			},
			{
				Cmd: objc.RegisterName("dismissUpdateInstallation"),
				Fn: func(_ objc.ID, _ objc.SEL) {
					if u := currentSparkleUpdater(); u != nil {
						u.retireCheckCancellation()
						abortedRelaunch := u.abortPendingRelaunch()
						u.mu.Lock()
						u.installWhenRdy = false
						if u.readyReplyBlock != 0 {
							u.readyReplyBlock.Release()
							u.readyReplyBlock = 0
						}
						u.mu.Unlock()
						if abortedRelaunch {
							u.recordError("update_install_canceled")
						}
					}
				},
			},
			{
				Cmd: objc.RegisterName("showUpdateInFocus"),
				Fn:  func(_ objc.ID, _ objc.SEL) {},
			},
		},
	)
	if err != nil {
		return fmt.Errorf("register_sparkle_user_driver:%w", err)
	}
	delegateCls, err := objc.RegisterClass(
		"MollySparkleDelegate",
		nsObject,
		nil,
		nil,
		[]objc.MethodDef{
			{
				Cmd: objc.RegisterName("updater:didFinishUpdateCycleForUpdateCheck:error:"),
				Fn: func(_ objc.ID, _ objc.SEL, _ objc.ID, _ int64, nsErr objc.ID) {
					if u := currentSparkleUpdater(); u != nil {
						errMsg := ""
						if nsErr != 0 {
							errMsg = nsStringToGo(nsErr.Send(objc.RegisterName("localizedDescription")))
							if errMsg == "" {
								errMsg = "sparkle_error"
							}
						}
						u.handleUpdateCycleFinished(errMsg)
					}
				},
			},
			{
				Cmd: objc.RegisterName("updater:didAbortWithError:"),
				Fn: func(_ objc.ID, _ objc.SEL, _ objc.ID, nsErr objc.ID) {
					if u := currentSparkleUpdater(); u != nil {
						errMsg := "sparkle_error"
						if nsErr != 0 {
							if desc := nsStringToGo(nsErr.Send(objc.RegisterName("localizedDescription"))); desc != "" {
								errMsg = desc
							}
						}
						u.handleUpdateCycleFinished(errMsg)
					}
				},
			},
		},
	)
	if err != nil {
		return fmt.Errorf("register_sparkle_delegate:%w", err)
	}
	sparkleDriverClass = driverCls
	sparkleDelegateClass = delegateCls
	return nil
}

func (u *SparkleUpdater) retireCheckCancellation() {
	u.mu.Lock()
	blk := u.checkCancelBlk
	u.checkCancelBlk = 0
	u.mu.Unlock()
	if blk != 0 {
		blk.Release()
	}
}
