package shell

import (
	"bufio"
	"context"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxLatestYMLBytes     = 1 << 20
	maxNSISInstallerBytes = 512 << 20
)

type NSISLatestManifest struct {
	Version     string
	Path        string
	SHA512      string
	ReleaseDate string
	Size        int64
}

type NSISLockedInstaller interface {
	io.Closer
	Path() string
}

type NSISSignatureVerifier interface {
	VerifyInstaller(ctx context.Context, installerPath string, expectedPublisher string) error
	LockAndVerifyInstaller(ctx context.Context, installerPath, expectedSHA512, expectedPublisher string) (NSISLockedInstaller, error)
}

type NSISInstallerLauncher interface {
	LaunchSilentInstaller(installerPath string) error
}

type NSISUpdaterConfig struct {
	CurrentVersion    string
	FeedURL           string
	ExpectedPublisher string
	DownloadDir       string
	AllowLoopbackHTTP bool
	HTTPClient        *http.Client
	Verifier          NSISSignatureVerifier
	Launcher          NSISInstallerLauncher
	Now               func() time.Time
	Hooks             UpdaterHooks
}

type NSISUpdater struct {
	cfg NSISUpdaterConfig

	mu                  sync.Mutex
	state               UpdaterState
	checkInFlight       bool
	installInFlight     bool
	downloadedPath      string
	downloadedSHA512B64 string
	cancelDownload      context.CancelFunc
	closed              bool
}

func NewNSISUpdater(cfg NSISUpdaterConfig) (*NSISUpdater, error) {
	if _, err := validateUpdateFeedURL(cfg.FeedURL, cfg.AllowLoopbackHTTP); err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.CurrentVersion) == "" {
		return nil, errors.New("current_version_required")
	}
	if strings.TrimSpace(cfg.ExpectedPublisher) == "" {
		cfg.ExpectedPublisher = DefaultWindowsPublisher
	}
	if cfg.DownloadDir == "" {
		cfg.DownloadDir = filepath.Join(os.TempDir(), "molly-updater")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 10 * time.Minute}
	}
	cfg.HTTPClient = cloneClientWithRedirectPolicy(cfg.HTTPClient, cfg.AllowLoopbackHTTP)
	if cfg.Verifier == nil {
		cfg.Verifier = defaultNSISSignatureVerifier{}
	}
	if cfg.Launcher == nil {
		cfg.Launcher = defaultNSISInstallerLauncher{}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &NSISUpdater{
		cfg: cfg,
		state: UpdaterState{
			Phase:          UpdaterPhaseIdle,
			CurrentVersion: cfg.CurrentVersion,
		},
	}, nil
}

func (u *NSISUpdater) GetState() UpdaterState {
	u.mu.Lock()
	defer u.mu.Unlock()
	return cloneUpdaterState(u.state)
}

func (u *NSISUpdater) CheckForUpdates(ctx context.Context) CheckForUpdateResult {
	u.mu.Lock()
	if u.closed {
		u.mu.Unlock()
		return CheckForUpdateResult{Started: false, Error: "updater_closed"}
	}
	if u.checkInFlight {
		u.mu.Unlock()
		return CheckForUpdateResult{Started: false, Error: "check_in_progress"}
	}
	if !shouldResetPhaseForManualCheck(u.state.Phase) {
		snap := cloneUpdaterState(u.state)
		u.mu.Unlock()
		u.emit(snap)
		return CheckForUpdateResult{Started: false}
	}
	u.checkInFlight = true
	nowMs := u.cfg.Now().UnixMilli()
	u.state = UpdaterState{
		Phase:          UpdaterPhaseChecking,
		CurrentVersion: u.cfg.CurrentVersion,
		CheckedAtMs:    &nowMs,
	}
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	u.emit(snap)

	if ctx == nil {
		ctx = context.Background()
	}
	runCtx, cancel := context.WithCancel(ctx)
	u.mu.Lock()
	if u.closed {
		u.checkInFlight = false
		u.mu.Unlock()
		cancel()
		return CheckForUpdateResult{Started: false, Error: "updater_closed"}
	}
	u.cancelDownload = cancel
	u.mu.Unlock()

	defer func() {
		cancel()
		u.mu.Lock()
		u.cancelDownload = nil
		u.checkInFlight = false
		u.mu.Unlock()
	}()

	if err := u.checkAndDownload(runCtx); err != nil {
		u.recordError(err.Error())
		return CheckForUpdateResult{Started: false, Error: err.Error()}
	}
	return CheckForUpdateResult{Started: true}
}

func (u *NSISUpdater) checkAndDownload(ctx context.Context) error {
	feedURL, err := validateUpdateFeedURL(u.cfg.FeedURL, u.cfg.AllowLoopbackHTTP)
	if err != nil {
		return err
	}
	manifest, err := u.fetchLatestManifest(ctx, feedURL)
	if err != nil {
		return err
	}
	if compareSemver(manifest.Version, u.cfg.CurrentVersion) <= 0 {
		nowMs := u.cfg.Now().UnixMilli()
		u.setState(UpdaterState{
			Phase:          UpdaterPhaseUpToDate,
			CurrentVersion: u.cfg.CurrentVersion,
			CheckedAtMs:    &nowMs,
		})
		return nil
	}

	installerURL, err := resolveNSISAssetURL(feedURL, manifest.Path, u.cfg.AllowLoopbackHTTP)
	if err != nil {
		return err
	}

	nowMs := u.cfg.Now().UnixMilli()
	u.setState(UpdaterState{
		Phase:            UpdaterPhaseDownloading,
		CurrentVersion:   u.cfg.CurrentVersion,
		AvailableVersion: manifest.Version,
		ReleaseDate:      manifest.ReleaseDate,
		CheckedAtMs:      &nowMs,
	})

	finalPath, err := u.downloadAndVerify(ctx, installerURL, manifest)
	if err != nil {
		return err
	}

	doneMs := u.cfg.Now().UnixMilli()
	pct := 100.0
	u.mu.Lock()
	u.downloadedPath = finalPath
	u.downloadedSHA512B64 = manifest.SHA512
	u.state = UpdaterState{
		Phase:             UpdaterPhaseDownloaded,
		CurrentVersion:    u.cfg.CurrentVersion,
		AvailableVersion:  manifest.Version,
		DownloadedVersion: manifest.Version,
		ReleaseDate:       manifest.ReleaseDate,
		Percent:           &pct,
		CheckedAtMs:       &doneMs,
	}
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	u.emit(snap)
	return nil
}

func (u *NSISUpdater) fetchLatestManifest(ctx context.Context, feedURL *url.URL) (NSISLatestManifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL.String(), nil)
	if err != nil {
		return NSISLatestManifest{}, err
	}
	resp, err := u.cfg.HTTPClient.Do(req)
	if err != nil {
		return NSISLatestManifest{}, fmt.Errorf("fetch_latest_yml:%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return NSISLatestManifest{}, fmt.Errorf("fetch_latest_yml_status:%d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxLatestYMLBytes+1))
	if err != nil {
		return NSISLatestManifest{}, fmt.Errorf("read_latest_yml:%w", err)
	}
	if len(raw) > maxLatestYMLBytes {
		return NSISLatestManifest{}, errors.New("latest_yml_too_large")
	}
	return ParseNSISLatestYML(raw)
}

func (u *NSISUpdater) downloadAndVerify(ctx context.Context, assetURL *url.URL, manifest NSISLatestManifest) (string, error) {
	if err := os.MkdirAll(u.cfg.DownloadDir, 0o700); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, assetURL.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := u.cfg.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download_installer:%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download_installer_status:%d", resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp(u.cfg.DownloadDir, "molly-nsis-*.tmp")
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()
	keep := false
	defer func() {
		if !keep {
			_ = os.Remove(tmpPath)
		}
	}()

	expectedDigest, err := decodeSHA512Base64(manifest.SHA512)
	if err != nil {
		_ = tmpFile.Close()
		return "", err
	}

	total := resp.ContentLength
	if total <= 0 && manifest.Size > 0 {
		total = manifest.Size
	}
	if total > maxNSISInstallerBytes {
		_ = tmpFile.Close()
		return "", errors.New("installer_too_large")
	}

	hasher := sha512.New()
	started := u.cfg.Now()
	var transferred int64
	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			transferred += int64(n)
			if transferred > maxNSISInstallerBytes {
				_ = tmpFile.Close()
				return "", errors.New("installer_too_large")
			}
			if _, wErr := tmpFile.Write(buf[:n]); wErr != nil {
				_ = tmpFile.Close()
				return "", wErr
			}
			_, _ = hasher.Write(buf[:n])
			u.emitDownloadProgress(manifest, transferred, total, started)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = tmpFile.Close()
			return "", fmt.Errorf("download_installer_read:%w", readErr)
		}
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return "", err
	}
	if err := tmpFile.Close(); err != nil {
		return "", err
	}

	actualDigest := hasher.Sum(nil)
	if subtle.ConstantTimeCompare(actualDigest, expectedDigest) != 1 {
		return "", errors.New("installer_sha512_mismatch")
	}
	if err := u.cfg.Verifier.VerifyInstaller(ctx, tmpPath, u.cfg.ExpectedPublisher); err != nil {
		return "", fmt.Errorf("installer_signature_invalid:%w", err)
	}

	finalPath := filepath.Join(u.cfg.DownloadDir, manifest.Path)
	_ = os.Remove(finalPath)
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return "", err
	}
	keep = true
	return finalPath, nil
}

func (u *NSISUpdater) emitDownloadProgress(manifest NSISLatestManifest, transferred, total int64, started time.Time) {
	u.mu.Lock()
	next := cloneUpdaterState(u.state)
	next.Phase = UpdaterPhaseDownloading
	next.AvailableVersion = manifest.Version
	next.ReleaseDate = manifest.ReleaseDate
	tCopy := transferred
	next.Transferred = &tCopy
	if total > 0 {
		totCopy := total
		next.Total = &totCopy
		pct := float64(transferred) / float64(total) * 100
		if pct > 100 {
			pct = 100
		}
		next.Percent = &pct
	}
	if elapsed := u.cfg.Now().Sub(started).Seconds(); elapsed > 0 {
		bps := float64(transferred) / elapsed
		next.BytesPerSecond = &bps
	}
	u.state = next
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	u.emit(snap)
}

func (u *NSISUpdater) QuitAndInstall(ctx context.Context) QuitAndInstallUpdateResult {
	u.mu.Lock()
	if u.closed {
		u.mu.Unlock()
		return QuitAndInstallUpdateResult{OK: false, Error: "updater_closed"}
	}
	if u.state.Phase != UpdaterPhaseDownloaded || u.downloadedPath == "" {
		u.mu.Unlock()
		return QuitAndInstallUpdateResult{OK: false, Error: "update_not_downloaded"}
	}
	if u.installInFlight {
		u.mu.Unlock()
		return QuitAndInstallUpdateResult{OK: false, Error: "update_install_in_progress"}
	}
	u.installInFlight = true
	installerPath := u.downloadedPath
	expectedSHA512 := u.downloadedSHA512B64
	u.mu.Unlock()

	defer func() {
		u.mu.Lock()
		u.installInFlight = false
		u.mu.Unlock()
	}()

	if ctx == nil {
		ctx = context.Background()
	}
	// Hold a read-only (deny write/delete on Windows) handle across verification,
	// relaunch preparation, and process launch so the verified installer cannot
	// be swapped in the cache directory before execution. If the cached file is
	// missing or fails integrity/signature verification, invalidate it so a new
	// manual check can re-download a clean replacement.
	lockedInstaller, err := u.cfg.Verifier.LockAndVerifyInstaller(ctx, installerPath, expectedSHA512, u.cfg.ExpectedPublisher)
	if err != nil {
		u.invalidateCachedInstaller(err.Error())
		return QuitAndInstallUpdateResult{OK: false, Error: err.Error()}
	}
	defer func() {
		if lockedInstaller != nil {
			_ = lockedInstaller.Close()
		}
	}()

	if u.cfg.Hooks.PrepareToRelaunch != nil {
		if err := u.cfg.Hooks.PrepareToRelaunch(ctx); err != nil {
			if u.cfg.Hooks.AbortRelaunch != nil {
				u.cfg.Hooks.AbortRelaunch()
			}
			u.recordError(err.Error())
			return QuitAndInstallUpdateResult{OK: false, Error: err.Error()}
		}
	}

	if err := u.cfg.Launcher.LaunchSilentInstaller(lockedInstaller.Path()); err != nil {
		if u.cfg.Hooks.AbortRelaunch != nil {
			u.cfg.Hooks.AbortRelaunch()
		}
		u.recordError(err.Error())
		return QuitAndInstallUpdateResult{OK: false, Error: err.Error()}
	}

	if u.cfg.Hooks.Quit != nil {
		u.cfg.Hooks.Quit()
	}
	return QuitAndInstallUpdateResult{OK: true}
}

func (u *NSISUpdater) Close() {
	u.mu.Lock()
	u.closed = true
	cancel := u.cancelDownload
	u.cancelDownload = nil
	u.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (u *NSISUpdater) setState(next UpdaterState) {
	u.mu.Lock()
	u.state = next
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	u.emit(snap)
}

func (u *NSISUpdater) invalidateCachedInstaller(message string) {
	nowMs := u.cfg.Now().UnixMilli()
	u.mu.Lock()
	stalePath := u.downloadedPath
	u.downloadedPath = ""
	u.downloadedSHA512B64 = ""
	u.state = UpdaterState{
		Phase:          UpdaterPhaseError,
		CurrentVersion: u.cfg.CurrentVersion,
		Error:          message,
		CheckedAtMs:    &nowMs,
	}
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	if stalePath != "" {
		_ = os.Remove(stalePath)
	}
	u.emit(snap)
}

func (u *NSISUpdater) recordError(message string) {
	nowMs := u.cfg.Now().UnixMilli()
	u.mu.Lock()
	next := cloneUpdaterState(u.state)
	// Preserve a downloaded package so the user can retry QuitAndInstall,
	// matching Electron AppUpdaterService.recordError.
	if u.downloadedPath != "" && next.DownloadedVersion != "" {
		next.Phase = UpdaterPhaseDownloaded
	} else {
		next.Phase = UpdaterPhaseError
	}
	next.Error = message
	next.CheckedAtMs = &nowMs
	u.state = next
	snap := cloneUpdaterState(u.state)
	u.mu.Unlock()
	u.emit(snap)
}

func (u *NSISUpdater) emit(state UpdaterState) {
	if u.cfg.Hooks.OnStateChange != nil {
		u.cfg.Hooks.OnStateChange(state)
	}
}

func cloneUpdaterState(s UpdaterState) UpdaterState {
	out := s
	if s.Percent != nil {
		v := *s.Percent
		out.Percent = &v
	}
	if s.BytesPerSecond != nil {
		v := *s.BytesPerSecond
		out.BytesPerSecond = &v
	}
	if s.Transferred != nil {
		v := *s.Transferred
		out.Transferred = &v
	}
	if s.Total != nil {
		v := *s.Total
		out.Total = &v
	}
	if s.CheckedAtMs != nil {
		v := *s.CheckedAtMs
		out.CheckedAtMs = &v
	}
	return out
}

// ParseNSISLatestYML parses the electron-builder latest.yml release manifest.
func ParseNSISLatestYML(raw []byte) (NSISLatestManifest, error) {
	var m NSISLatestManifest
	var firstFileURL, firstFileSHA512 string
	var firstFileSize int64
	inFiles := false
	seenFirstFile := false

	scanner := bufio.NewScanner(strings.NewReader(string(raw)))
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			inFiles = false
			key, val, ok := splitYAMLKV(trimmed)
			if !ok {
				continue
			}
			switch key {
			case "version":
				m.Version = unquoteYAML(val)
			case "path":
				m.Path = unquoteYAML(val)
			case "sha512":
				m.SHA512 = unquoteYAML(val)
			case "releaseDate":
				m.ReleaseDate = unquoteYAML(val)
			case "files":
				inFiles = true
			}
			continue
		}
		if inFiles {
			item := strings.TrimSpace(line)
			if strings.HasPrefix(item, "- ") {
				if seenFirstFile {
					inFiles = false
					continue
				}
				seenFirstFile = true
				item = strings.TrimSpace(strings.TrimPrefix(item, "- "))
			}
			key, val, ok := splitYAMLKV(item)
			if !ok {
				continue
			}
			switch key {
			case "url":
				if firstFileURL == "" {
					firstFileURL = unquoteYAML(val)
				}
			case "sha512":
				if firstFileSHA512 == "" {
					firstFileSHA512 = unquoteYAML(val)
				}
			case "size":
				if firstFileSize == 0 {
					if n, err := strconv.ParseInt(unquoteYAML(val), 10, 64); err == nil && n > 0 {
						firstFileSize = n
					}
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return NSISLatestManifest{}, err
	}
	if m.Path == "" {
		m.Path = firstFileURL
	}
	if m.SHA512 == "" {
		m.SHA512 = firstFileSHA512
	}
	m.Size = firstFileSize

	if m.Version == "" {
		return NSISLatestManifest{}, errors.New("latest_yml_missing_version")
	}
	if err := validateNSISFilename(m.Path); err != nil {
		return NSISLatestManifest{}, err
	}
	if _, err := decodeSHA512Base64(m.SHA512); err != nil {
		return NSISLatestManifest{}, err
	}
	return m, nil
}

func splitYAMLKV(line string) (string, string, bool) {
	idx := strings.IndexByte(line, ':')
	if idx <= 0 {
		return "", "", false
	}
	return strings.TrimSpace(line[:idx]), strings.TrimSpace(line[idx+1:]), true
}

func unquoteYAML(v string) string {
	v = strings.TrimSpace(v)
	if len(v) >= 2 && ((v[0] == '\'' && v[len(v)-1] == '\'') || (v[0] == '"' && v[len(v)-1] == '"')) {
		return v[1 : len(v)-1]
	}
	return v
}

func validateNSISFilename(name string) error {
	if name == "" || strings.ContainsAny(name, `/\:?*<>|"`) || strings.Contains(name, "..") {
		return errors.New("latest_yml_invalid_installer_path")
	}
	if filepath.Base(name) != name || !strings.HasSuffix(strings.ToLower(name), ".exe") {
		return errors.New("latest_yml_invalid_installer_path")
	}
	return nil
}

func decodeSHA512Base64(raw string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil || len(decoded) != sha512.Size {
		return nil, errors.New("latest_yml_invalid_sha512")
	}
	return decoded, nil
}

func verifyFileSHA512Base64(path, expectedB64 string) error {
	expected, err := decodeSHA512Base64(expectedB64)
	if err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("installer_missing:%w", err)
	}
	defer f.Close()
	h := sha512.New()
	if _, err := io.Copy(h, io.LimitReader(f, maxNSISInstallerBytes+1)); err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(h.Sum(nil), expected) != 1 {
		return errors.New("installer_sha512_mismatch")
	}
	return nil
}

func cloneClientWithRedirectPolicy(base *http.Client, allowLoopbackHTTP bool) *http.Client {
	cloned := *base
	prevCheck := base.CheckRedirect
	cloned.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("update_redirect_limit_exceeded")
		}
		if _, err := validateUpdateFeedURL(req.URL.String(), allowLoopbackHTTP); err != nil {
			return fmt.Errorf("update_redirect_rejected:%w", err)
		}
		if prevCheck != nil {
			return prevCheck(req, via)
		}
		return nil
	}
	return &cloned
}

func resolveNSISAssetURL(feedURL *url.URL, filename string, allowLoopbackHTTP bool) (*url.URL, error) {
	if err := validateNSISFilename(filename); err != nil {
		return nil, err
	}
	rel := &url.URL{Path: filename}
	resolved := feedURL.ResolveReference(rel)
	return validateUpdateFeedURL(resolved.String(), allowLoopbackHTTP)
}
