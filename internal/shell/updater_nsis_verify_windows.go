//go:build windows

package shell

import (
	"context"
	"crypto/sha512"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modWintrust = windows.NewLazySystemDLL("wintrust.dll")
	modCrypt32  = windows.NewLazySystemDLL("crypt32.dll")
	modKernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procWinVerifyTrust                 = modWintrust.NewProc("WinVerifyTrust")
	procWTHelperProvDataFromStateData  = modWintrust.NewProc("WTHelperProvDataFromStateData")
	procWTHelperGetProvSignerFromChain = modWintrust.NewProc("WTHelperGetProvSignerFromChain")
	procWTHelperGetProvCertFromChain   = modWintrust.NewProc("WTHelperGetProvCertFromChain")
	procCertGetNameStringW             = modCrypt32.NewProc("CertGetNameStringW")
	procRtlMoveMemory                  = modKernel32.NewProc("RtlMoveMemory")
)

type winGUID struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

var winTrustActionGenericVerifyV2 = winGUID{
	Data1: 0x00aac56b,
	Data2: 0xcd44,
	Data3: 0x11d0,
	Data4: [8]byte{0x8c, 0xc2, 0x00, 0xc0, 0x4f, 0xc2, 0x95, 0xee},
}

type winTrustFileInfo struct {
	cbStruct       uint32
	pcwszFilePath  *uint16
	hFile          windows.Handle
	pgKnownSubject *winGUID
}

type winTrustData struct {
	cbStruct            uint32
	pPolicyCallbackData uintptr
	pSIPClientData      uintptr
	dwUIChoice          uint32
	fdwRevocationChecks uint32
	dwUnionChoice       uint32
	pFile               *winTrustFileInfo
	dwStateAction       uint32
	hWVTStateData       uintptr
	pwszURLReference    *uint16
	dwProvFlags         uint32
	dwUIContext         uint32
	pSignatureSettings  uintptr
}

// Matches CRYPT_PROVIDER_CERT prefix in Windows SDK wintrust.h (64-bit).
type cryptProviderCertPrefix struct {
	cbStruct uint32
	_        uint32
	pCert    uintptr
}

const (
	wtdUINone                 = 2
	wtdRevokeWholeChain       = 1
	wtdChoiceFile             = 1
	wtdStateActionVerify      = 1
	wtdStateActionClose       = 2
	certNameSimpleDisplayType = 4
	createNoWindowFlag        = 0x08000000
	fileNameNormalized        = 0x0
	volumeNameDOS             = 0x0
)

type defaultNSISSignatureVerifier struct{}

type windowsLockedInstaller struct {
	path     string
	file     *os.File
	dirGuard windows.Handle
}

func (l *windowsLockedInstaller) Path() string { return l.path }

func (l *windowsLockedInstaller) Close() error {
	var err1, err2 error
	if l.file != nil {
		err1 = l.file.Close()
		l.file = nil
	}
	if l.dirGuard != 0 && l.dirGuard != windows.InvalidHandle {
		err2 = windows.CloseHandle(l.dirGuard)
		l.dirGuard = 0
	}
	return errors.Join(err1, err2)
}

func stripWin32DevicePrefix(p string) string {
	if strings.HasPrefix(p, `\\?\UNC\`) {
		return `\\` + strings.TrimPrefix(p, `\\?\UNC\`)
	}
	return strings.TrimPrefix(p, `\\?\`)
}

func canonicalCompareWin32Path(p string) string {
	return filepath.Clean(stripWin32DevicePrefix(p))
}

func win32VolumePrefix(cleaned string) string {
	if strings.HasPrefix(cleaned, `\\?\UNC\`) {
		rest := strings.TrimPrefix(cleaned, `\\?\UNC\`)
		parts := strings.SplitN(rest, `\`, 3)
		if len(parts) >= 2 {
			return `\\?\UNC\` + parts[0] + `\` + parts[1]
		}
	}
	if strings.HasPrefix(cleaned, `\\?\`) && len(cleaned) >= 6 && cleaned[5] == ':' {
		return cleaned[:6]
	}
	return filepath.VolumeName(cleaned)
}

// rejectReparsePointsInPath verifies that no component along absPath (including
// parent directories and the target itself) is an NTFS symlink, mount point, or
// directory junction, preserving extended-length \\?\ prefixes for Win32 calls.
func rejectReparsePointsInPath(absPath string) error {
	cleaned := filepath.Clean(absPath)
	vol := win32VolumePrefix(cleaned)
	rest := strings.TrimPrefix(cleaned, vol)
	rest = strings.TrimLeft(rest, `\/`)
	if rest == "" {
		return errors.New("installer_path_empty")
	}
	parts := strings.Split(rest, string(filepath.Separator))
	cur := vol
	for _, part := range parts {
		if part == "" {
			continue
		}
		if cur == vol {
			cur = vol + `\` + part
		} else {
			cur = cur + `\` + part
		}
		ptr, err := windows.UTF16PtrFromString(cur)
		if err != nil {
			return err
		}
		attrs, err := windows.GetFileAttributes(ptr)
		if err != nil {
			return fmt.Errorf("installer_stat_component:%w", err)
		}
		if attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return fmt.Errorf("installer_reparse_point_rejected:%s", cur)
		}
	}
	return nil
}

func expandWin32LongPath(p string) (string, error) {
	inPtr, err := windows.UTF16PtrFromString(p)
	if err != nil {
		return "", err
	}
	buf := make([]uint16, 260)
	for {
		n, err := windows.GetLongPathName(inPtr, &buf[0], uint32(len(buf)))
		if err != nil {
			return "", fmt.Errorf("installer_long_path:%w", err)
		}
		if int(n) < len(buf) {
			return windows.UTF16ToString(buf[:n]), nil
		}
		buf = make([]uint16, n+1)
	}
}

func finalPathByHandle(h windows.Handle) (string, error) {
	buf := make([]uint16, 260)
	for {
		n, err := windows.GetFinalPathNameByHandle(h, &buf[0], uint32(len(buf)), fileNameNormalized|volumeNameDOS)
		if err != nil {
			return "", fmt.Errorf("installer_final_path:%w", err)
		}
		if int(n) < len(buf) {
			return windows.UTF16ToString(buf[:n]), nil
		}
		buf = make([]uint16, n+1)
	}
}

func openLockedInstallerAndDir(installerPath string) (*windowsLockedInstaller, windows.Handle, *uint16, error) {
	absPath := installerPath
	if !strings.HasPrefix(absPath, `\\?\`) {
		var err error
		absPath, err = filepath.Abs(installerPath)
		if err != nil {
			return nil, 0, nil, err
		}
	}
	longPath, err := expandWin32LongPath(absPath)
	if err != nil {
		return nil, 0, nil, err
	}
	absPath = filepath.Clean(longPath)
	if err := rejectReparsePointsInPath(absPath); err != nil {
		return nil, 0, nil, err
	}

	// Lock the parent staging directory against rename/delete and reparse
	// retargeting while the installer handle is held.
	dirPtr, err := windows.UTF16PtrFromString(filepath.Dir(absPath))
	if err != nil {
		return nil, 0, nil, err
	}
	dirHandle, err := windows.CreateFile(
		dirPtr,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT,
		0,
	)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("open_installer_dir_locked:%w", err)
	}
	var dirInfo windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(dirHandle, &dirInfo); err != nil {
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, err
	}
	if dirInfo.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || dirInfo.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, errors.New("installer_dir_reparse_point_rejected")
	}

	pathPtr, err := windows.UTF16PtrFromString(absPath)
	if err != nil {
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, err
	}
	// Share read-only (deny write/delete) and refuse to follow a reparse point.
	handle, err := windows.CreateFile(
		pathPtr,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT,
		0,
	)
	if err != nil {
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, fmt.Errorf("open_installer_locked:%w", err)
	}
	file := os.NewFile(uintptr(handle), absPath)

	var fileInfo windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &fileInfo); err != nil {
		_ = file.Close()
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, err
	}
	if fileInfo.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 {
		_ = file.Close()
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, errors.New("installer_reparse_point_rejected")
	}

	finalPath, err := finalPathByHandle(handle)
	if err != nil {
		_ = file.Close()
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, err
	}
	if !strings.EqualFold(canonicalCompareWin32Path(finalPath), canonicalCompareWin32Path(absPath)) {
		_ = file.Close()
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, errors.New("installer_canonical_path_mismatch")
	}
	if err := rejectReparsePointsInPath(finalPath); err != nil {
		_ = file.Close()
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, err
	}

	launchPath := finalPath
	if !strings.HasPrefix(installerPath, `\\?\`) {
		launchPath = stripWin32DevicePrefix(finalPath)
	}
	finalPtr, err := windows.UTF16PtrFromString(finalPath)
	if err != nil {
		_ = file.Close()
		_ = windows.CloseHandle(dirHandle)
		return nil, 0, nil, err
	}
	return &windowsLockedInstaller{
		path:     launchPath,
		file:     file,
		dirGuard: dirHandle,
	}, handle, finalPtr, nil
}

// verifyAuthenticodeHandle runs WinVerifyTrust directly on the open file handle
// and extracts the verified signer's display name from WinVerifyTrust's own
// state data (hWVTStateData) without re-opening the file by pathname.
func verifyAuthenticodeHandle(handle windows.Handle, pathPtr *uint16, expectedPublisher string) error {
	fileInfo := winTrustFileInfo{
		cbStruct:      uint32(unsafe.Sizeof(winTrustFileInfo{})),
		pcwszFilePath: pathPtr,
		hFile:         handle,
	}
	trustData := winTrustData{
		cbStruct:            uint32(unsafe.Sizeof(winTrustData{})),
		dwUIChoice:          wtdUINone,
		fdwRevocationChecks: wtdRevokeWholeChain,
		dwUnionChoice:       wtdChoiceFile,
		pFile:               &fileInfo,
		dwStateAction:       wtdStateActionVerify,
	}
	status, _, _ := procWinVerifyTrust.Call(
		^uintptr(0), // INVALID_HANDLE_VALUE
		uintptr(unsafe.Pointer(&winTrustActionGenericVerifyV2)),
		uintptr(unsafe.Pointer(&trustData)),
	)
	defer func() {
		trustData.dwStateAction = wtdStateActionClose
		_, _, _ = procWinVerifyTrust.Call(
			^uintptr(0),
			uintptr(unsafe.Pointer(&winTrustActionGenericVerifyV2)),
			uintptr(unsafe.Pointer(&trustData)),
		)
	}()
	if status != 0 {
		return fmt.Errorf("winverifytrust_failed:0x%x", status)
	}

	signer, err := readSignerNameFromWVTState(trustData.hWVTStateData)
	if err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(signer), strings.TrimSpace(expectedPublisher)) {
		return fmt.Errorf("publisher_mismatch:got=%q want=%q", signer, expectedPublisher)
	}
	return nil
}

func readSignerNameFromWVTState(stateData uintptr) (string, error) {
	if stateData == 0 {
		return "", errors.New("wvt_state_data_empty")
	}
	provData, _, _ := procWTHelperProvDataFromStateData.Call(stateData)
	if provData == 0 {
		return "", errors.New("wvt_prov_data_missing")
	}
	provSigner, _, _ := procWTHelperGetProvSignerFromChain.Call(provData, 0, 0, 0)
	if provSigner == 0 {
		return "", errors.New("wvt_prov_signer_missing")
	}
	provCertPtr, _, _ := procWTHelperGetProvCertFromChain.Call(provSigner, 0)
	if provCertPtr == 0 {
		return "", errors.New("wvt_prov_cert_missing")
	}
	var provCert cryptProviderCertPrefix
	_, _, _ = procRtlMoveMemory.Call(
		uintptr(unsafe.Pointer(&provCert)),
		provCertPtr,
		unsafe.Sizeof(provCert),
	)
	if provCert.pCert == 0 {
		return "", errors.New("wvt_cert_context_missing")
	}
	nameLen, _, _ := procCertGetNameStringW.Call(provCert.pCert, certNameSimpleDisplayType, 0, 0, 0, 0)
	if nameLen <= 1 {
		return "", errors.New("cert_signer_name_empty")
	}
	nameBuf := make([]uint16, nameLen)
	_, _, _ = procCertGetNameStringW.Call(provCert.pCert, certNameSimpleDisplayType, 0, 0, uintptr(unsafe.Pointer(&nameBuf[0])), nameLen)
	return syscall.UTF16ToString(nameBuf), nil
}

func (defaultNSISSignatureVerifier) VerifyInstaller(_ context.Context, installerPath string, expectedPublisher string) error {
	locked, handle, pathPtr, err := openLockedInstallerAndDir(installerPath)
	if err != nil {
		return err
	}
	defer locked.Close()
	return verifyAuthenticodeHandle(handle, pathPtr, expectedPublisher)
}

func (defaultNSISSignatureVerifier) LockAndVerifyInstaller(_ context.Context, installerPath, expectedSHA512, expectedPublisher string) (NSISLockedInstaller, error) {
	expectedDigest, err := decodeSHA512Base64(expectedSHA512)
	if err != nil {
		return nil, err
	}
	locked, handle, pathPtr, err := openLockedInstallerAndDir(installerPath)
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = locked.Close()
		}
	}()

	h := sha512.New()
	n, err := io.Copy(h, io.LimitReader(locked.file, maxNSISInstallerBytes+1))
	if err != nil {
		return nil, err
	}
	if n > maxNSISInstallerBytes {
		return nil, errors.New("installer_too_large")
	}
	if subtle.ConstantTimeCompare(h.Sum(nil), expectedDigest) != 1 {
		return nil, errors.New("installer_sha512_mismatch")
	}
	if _, err := locked.file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	if err := verifyAuthenticodeHandle(handle, pathPtr, expectedPublisher); err != nil {
		return nil, fmt.Errorf("installer_signature_invalid:%w", err)
	}
	keep = true
	return locked, nil
}

type defaultNSISInstallerLauncher struct{}

func (defaultNSISInstallerLauncher) LaunchSilentInstaller(installerPath string) error {
	// Match electron-updater's NsisUpdater silent relaunch flags so the NSIS
	// package installs silently and restarts the newly installed Molly build.
	cmd := exec.Command(installerPath, "--updated", "/S", "--force-run")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindowFlag}
	return cmd.Start()
}
