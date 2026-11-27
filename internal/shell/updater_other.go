//go:build !darwin && !windows

package shell

func newPlatformUpdater(cfg DesktopUpdaterConfig) UpdaterService {
	return newDisabledUpdater(cfg.CurrentVersion, UpdaterDisabledReasonDefault, "updater_disabled_in_experimental_mygo_shell")
}
