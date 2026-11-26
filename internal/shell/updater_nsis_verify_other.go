//go:build !windows

package shell

import (
	"context"
	"errors"
)

type defaultNSISSignatureVerifier struct{}

func (defaultNSISSignatureVerifier) VerifyInstaller(context.Context, string, string) error {
	return errors.New("windows_authenticode_unavailable_on_host")
}

type defaultNSISInstallerLauncher struct{}

func (defaultNSISInstallerLauncher) LaunchSilentInstaller(string) error {
	return errors.New("windows_nsis_launcher_unavailable_on_host")
}
