//go:build windows

package shell

import (
	"os"
	"path/filepath"
	"strings"
)

func newPlatformUpdater(cfg DesktopUpdaterConfig) UpdaterService {
	feedURL := strings.TrimSpace(os.Getenv("MOLLY_WINDOWS_UPDATE_FEED_URL"))
	allowLoopback := cfg.AllowLoopbackHTTP
	if feedURL == "" {
		exe, err := os.Executable()
		if err != nil {
			return newDisabledUpdater(cfg.CurrentVersion, UpdaterDisabledReasonDefault, "updater_disabled_in_experimental_mygo_shell")
		}
		appUpdateYML := filepath.Join(filepath.Dir(exe), "resources", "app-update.yml")
		if _, statErr := os.Stat(appUpdateYML); statErr != nil {
			return newDisabledUpdater(cfg.CurrentVersion, UpdaterDisabledReasonDefault, "updater_disabled_in_experimental_mygo_shell")
		}
		feedURL = DefaultWindowsUpdateFeedURL
	} else if os.Getenv("MOLLY_UPDATER_ALLOW_LOOPBACK_HTTP") == "1" {
		allowLoopback = true
	}

	downloadDir := ""
	if cfg.DataDir != "" {
		downloadDir = filepath.Join(cfg.DataDir, "updater-cache")
	}
	u, err := NewNSISUpdater(NSISUpdaterConfig{
		CurrentVersion:    cfg.CurrentVersion,
		FeedURL:           feedURL,
		ExpectedPublisher: DefaultWindowsPublisher,
		DownloadDir:       downloadDir,
		AllowLoopbackHTTP: allowLoopback,
		Hooks:             cfg.Hooks,
	})
	if err != nil {
		return newDisabledUpdater(cfg.CurrentVersion, err.Error(), "updater_disabled")
	}
	return u
}
