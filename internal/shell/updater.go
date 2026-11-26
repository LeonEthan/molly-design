package shell

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

const (
	DefaultSparkleAppcastURL     = "https://github.com/LeonEthan/molly-design/releases/latest/download/appcast.xml"
	DefaultWindowsUpdateFeedURL  = "https://github.com/LeonEthan/molly-design/releases/latest/download/latest.yml"
	DefaultWindowsPublisher      = "Leon Ethan"
	SparklePublicKeyPlaceholder  = "SPARKLE_ED_PUBLIC_KEY_PLACEHOLDER"
	UpdaterDisabledReasonDefault = "experimental_mygo_shell"
)

type UpdaterPhase string

const (
	UpdaterPhaseIdle        UpdaterPhase = "idle"
	UpdaterPhaseChecking    UpdaterPhase = "checking"
	UpdaterPhaseDownloading UpdaterPhase = "downloading"
	UpdaterPhaseDownloaded  UpdaterPhase = "downloaded"
	UpdaterPhaseUpToDate    UpdaterPhase = "up_to_date"
	UpdaterPhaseError       UpdaterPhase = "error"
	UpdaterPhaseDisabled    UpdaterPhase = "disabled"
)

type UpdaterState struct {
	Phase             UpdaterPhase `json:"phase"`
	CurrentVersion    string       `json:"currentVersion"`
	AvailableVersion  string       `json:"availableVersion,omitempty"`
	DownloadedVersion string       `json:"downloadedVersion,omitempty"`
	ReleaseName       string       `json:"releaseName,omitempty"`
	ReleaseDate       string       `json:"releaseDate,omitempty"`
	ReleaseNotes      string       `json:"releaseNotes,omitempty"`
	Percent           *float64     `json:"percent,omitempty"`
	BytesPerSecond    *float64     `json:"bytesPerSecond,omitempty"`
	Transferred       *int64       `json:"transferred,omitempty"`
	Total             *int64       `json:"total,omitempty"`
	CheckedAtMs       *int64       `json:"checkedAtMs,omitempty"`
	Error             string       `json:"error,omitempty"`
	DisabledReason    string       `json:"disabledReason,omitempty"`
}

type CheckForUpdateResult struct {
	Started bool   `json:"started"`
	Error   string `json:"error,omitempty"`
}

type QuitAndInstallUpdateResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

type UpdaterService interface {
	GetState() UpdaterState
	CheckForUpdates(ctx context.Context) CheckForUpdateResult
	QuitAndInstall(ctx context.Context) QuitAndInstallUpdateResult
	Close()
}

type UpdaterHooks struct {
	OnStateChange     func(UpdaterState)
	PrepareToRelaunch func(context.Context) error
	AbortRelaunch     func()
	Quit              func()
	RunOnMain         func(func())
}

type DesktopUpdaterConfig struct {
	CurrentVersion    string
	DataDir           string
	InstallationMode  string
	AllowLoopbackHTTP bool
	Hooks             UpdaterHooks
}

type disabledUpdater struct {
	currentVersion string
	reason         string
	errorCode      string
}

func newDisabledUpdater(currentVersion, reason, errorCode string) UpdaterService {
	if reason == "" {
		reason = UpdaterDisabledReasonDefault
	}
	if errorCode == "" {
		errorCode = "updater_disabled_in_experimental_mygo_shell"
	}
	return &disabledUpdater{
		currentVersion: currentVersion,
		reason:         reason,
		errorCode:      errorCode,
	}
}

func (u *disabledUpdater) GetState() UpdaterState {
	return UpdaterState{
		Phase:          UpdaterPhaseDisabled,
		CurrentVersion: u.currentVersion,
		DisabledReason: u.reason,
	}
}

func (u *disabledUpdater) CheckForUpdates(context.Context) CheckForUpdateResult {
	return CheckForUpdateResult{
		Started: false,
		Error:   u.errorCode,
	}
}

func (u *disabledUpdater) QuitAndInstall(context.Context) QuitAndInstallUpdateResult {
	return QuitAndInstallUpdateResult{
		OK:    false,
		Error: u.errorCode,
	}
}

func (u *disabledUpdater) Close() {}

func NewDesktopUpdater(cfg DesktopUpdaterConfig) UpdaterService {
	if strings.EqualFold(strings.TrimSpace(cfg.InstallationMode), "preview") {
		return newDisabledUpdater(cfg.CurrentVersion, "preview_channel_disabled", "updater_disabled")
	}
	return newPlatformUpdater(cfg)
}

func validateSparklePublicKey(raw string) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == SparklePublicKeyPlaceholder {
		return errors.New("sparkle_public_key_missing_or_placeholder")
	}
	decoded, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil || len(decoded) != 32 {
		return errors.New("sparkle_public_key_invalid_ed25519")
	}
	return nil
}

func validateUpdateFeedURL(raw string, allowLoopbackHTTP bool) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("update_feed_url_empty")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("update_feed_url_invalid")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https":
		return parsed, nil
	case "http":
		if !allowLoopbackHTTP {
			return nil, errors.New("update_feed_url_requires_https")
		}
		host := strings.ToLower(parsed.Hostname())
		if host != "127.0.0.1" && host != "localhost" && host != "::1" {
			return nil, errors.New("update_feed_url_http_requires_loopback")
		}
		return parsed, nil
	default:
		return nil, fmt.Errorf("update_feed_url_unsupported_scheme:%s", parsed.Scheme)
	}
}

type parsedSemver struct {
	major int
	minor int
	patch int
	pre   []string
}

func parseSemver(raw string) (parsedSemver, bool) {
	s := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "v"))
	if s == "" {
		return parsedSemver{}, false
	}
	if plus := strings.IndexByte(s, '+'); plus >= 0 {
		s = s[:plus]
	}
	var pre []string
	if dash := strings.IndexByte(s, '-'); dash >= 0 {
		preStr := s[dash+1:]
		s = s[:dash]
		if preStr != "" {
			pre = strings.Split(preStr, ".")
		}
	}
	parts := strings.Split(s, ".")
	if len(parts) < 1 || len(parts) > 3 {
		return parsedSemver{}, false
	}
	nums := [3]int{}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return parsedSemver{}, false
		}
		nums[i] = n
	}
	return parsedSemver{major: nums[0], minor: nums[1], patch: nums[2], pre: pre}, true
}

func compareSemver(a, b string) int {
	pa, okA := parseSemver(a)
	pb, okB := parseSemver(b)
	if !okA || !okB {
		return strings.Compare(strings.TrimSpace(a), strings.TrimSpace(b))
	}
	if pa.major != pb.major {
		return cmpInt(pa.major, pb.major)
	}
	if pa.minor != pb.minor {
		return cmpInt(pa.minor, pb.minor)
	}
	if pa.patch != pb.patch {
		return cmpInt(pa.patch, pb.patch)
	}
	if len(pa.pre) == 0 && len(pb.pre) == 0 {
		return 0
	}
	if len(pa.pre) == 0 {
		return 1
	}
	if len(pb.pre) == 0 {
		return -1
	}
	for i := 0; i < len(pa.pre) && i < len(pb.pre); i++ {
		na, errA := strconv.Atoi(pa.pre[i])
		nb, errB := strconv.Atoi(pb.pre[i])
		switch {
		case errA == nil && errB == nil:
			if na != nb {
				return cmpInt(na, nb)
			}
		case errA == nil && errB != nil:
			return -1
		case errA != nil && errB == nil:
			return 1
		default:
			if c := strings.Compare(pa.pre[i], pb.pre[i]); c != 0 {
				return c
			}
		}
	}
	return cmpInt(len(pa.pre), len(pb.pre))
}

func cmpInt(a, b int) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func shouldResetPhaseForManualCheck(phase UpdaterPhase) bool {
	return phase != UpdaterPhaseChecking && phase != UpdaterPhaseDownloading && phase != UpdaterPhaseDownloaded
}
