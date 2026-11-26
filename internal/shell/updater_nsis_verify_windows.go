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
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modWintrust = windows.NewLazySystemDLL("wintrust.dll")
	modCrypt32  = windows.NewLazySystemDLL("crypt32.dll")

	procWinVerifyTrust             = modWintrust.NewProc("WinVerifyTrust")
	procCryptQueryObject           = modCrypt32.NewProc("CryptQueryObject")
	procCryptMsgGetParam           = modCrypt32.NewProc("CryptMsgGetParam")
	procCertFindCertificateInStore = modCrypt32.NewProc("CertFindCertificateInStore")
	procCertGetNameStringW         = modCrypt32.NewProc("CertGetNameStringW")
	procCertFreeCertificateContext = modCrypt32.NewProc("CertFreeCertificateContext")
	procCertCloseStore             = modCrypt32.NewProc("CertCloseStore")
	procCryptMsgClose              = modCrypt32.NewProc("CryptMsgClose")
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

type certInfoPrefix struct {
	dwVersion    uint32
	serialNumber cryptoAPIBlob
	sigAlg       cryptAlgorithmIdentifier
	issuer       cryptoAPIBlob
}

type cryptoAPIBlob struct {
	cbData uint32
	pbData *byte
}

type cryptAlgorithmIdentifier struct {
	pszObjID   *byte
	parameters cryptoAPIBlob
}

type cmsgSignerInfoPrefix struct {
	dwVersion    uint32
	issuer       cryptoAPIBlob
	serialNumber cryptoAPIBlob
}

const (
	wtdUINone                  = 2
	wtdRevokeWholeChain        = 1
	wtdChoiceFile              = 1
	wtdStateActionVerify       = 1
	wtdStateActionClose        = 2
	certQueryObjectFile        = 1
	certQueryContentPKCS7Embed = 10
	certQueryContentFlagPKCS7  = 1 << certQueryContentPKCS7Embed
	certQueryFormatFlagBinary  = 1 << 1
	cmsgSignerInfoParam        = 6
	x509ASNAndPKCS7Encoding    = 0x00000001 | 0x00010000
	certFindSubjectCert        = 11 << 16
	certNameSimpleDisplayType  = 4
	createNoWindowFlag         = 0x08000000
)

type defaultNSISSignatureVerifier struct{}

func openReadOnlyDenyWriteDelete(installerPath string) (*os.File, windows.Handle, *uint16, error) {
	pathPtr, err := windows.UTF16PtrFromString(installerPath)
	if err != nil {
		return nil, 0, nil, err
	}
	// Share read-only so CreateProcess can execute the verified image while
	// preventing any concurrent writer or renamer from modifying or swapping it.
	handle, err := windows.CreateFile(
		pathPtr,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("open_installer_locked:%w", err)
	}
	return os.NewFile(uintptr(handle), installerPath), handle, pathPtr, nil
}

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
	trustData.dwStateAction = wtdStateActionClose
	_, _, _ = procWinVerifyTrust.Call(
		^uintptr(0),
		uintptr(unsafe.Pointer(&winTrustActionGenericVerifyV2)),
		uintptr(unsafe.Pointer(&trustData)),
	)
	if status != 0 {
		return fmt.Errorf("winverifytrust_failed:0x%x", status)
	}

	signer, err := readAuthenticodeSignerName(pathPtr)
	if err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(signer), strings.TrimSpace(expectedPublisher)) {
		return fmt.Errorf("publisher_mismatch:got=%q want=%q", signer, expectedPublisher)
	}
	return nil
}

func (defaultNSISSignatureVerifier) VerifyInstaller(_ context.Context, installerPath string, expectedPublisher string) error {
	f, handle, pathPtr, err := openReadOnlyDenyWriteDelete(installerPath)
	if err != nil {
		return err
	}
	defer f.Close()
	return verifyAuthenticodeHandle(handle, pathPtr, expectedPublisher)
}

func (defaultNSISSignatureVerifier) LockAndVerifyInstaller(_ context.Context, installerPath, expectedSHA512, expectedPublisher string) (io.Closer, error) {
	expectedDigest, err := decodeSHA512Base64(expectedSHA512)
	if err != nil {
		return nil, err
	}
	f, handle, pathPtr, err := openReadOnlyDenyWriteDelete(installerPath)
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = f.Close()
		}
	}()

	h := sha512.New()
	n, err := io.Copy(h, io.LimitReader(f, maxNSISInstallerBytes+1))
	if err != nil {
		return nil, err
	}
	if n > maxNSISInstallerBytes {
		return nil, errors.New("installer_too_large")
	}
	if subtle.ConstantTimeCompare(h.Sum(nil), expectedDigest) != 1 {
		return nil, errors.New("installer_sha512_mismatch")
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	if err := verifyAuthenticodeHandle(handle, pathPtr, expectedPublisher); err != nil {
		return nil, fmt.Errorf("installer_signature_invalid:%w", err)
	}
	keep = true
	return f, nil
}

func readAuthenticodeSignerName(pathPtr *uint16) (string, error) {
	var encoding, contentType, formatType uint32
	var store, msg uintptr
	ok, _, err := procCryptQueryObject.Call(
		certQueryObjectFile,
		uintptr(unsafe.Pointer(pathPtr)),
		certQueryContentFlagPKCS7,
		certQueryFormatFlagBinary,
		0,
		uintptr(unsafe.Pointer(&encoding)),
		uintptr(unsafe.Pointer(&contentType)),
		uintptr(unsafe.Pointer(&formatType)),
		uintptr(unsafe.Pointer(&store)),
		uintptr(unsafe.Pointer(&msg)),
		0,
	)
	if ok == 0 {
		return "", fmt.Errorf("crypt_query_object:%w", err)
	}
	defer procCertCloseStore.Call(store, 0)
	defer procCryptMsgClose.Call(msg)

	var signerInfoSize uint32
	ok, _, err = procCryptMsgGetParam.Call(msg, cmsgSignerInfoParam, 0, 0, uintptr(unsafe.Pointer(&signerInfoSize)))
	if ok == 0 || signerInfoSize == 0 {
		return "", fmt.Errorf("crypt_msg_signer_size:%w", err)
	}
	buf := make([]byte, signerInfoSize)
	ok, _, err = procCryptMsgGetParam.Call(msg, cmsgSignerInfoParam, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&signerInfoSize)))
	if ok == 0 {
		return "", fmt.Errorf("crypt_msg_signer:%w", err)
	}
	signerInfo := (*cmsgSignerInfoPrefix)(unsafe.Pointer(&buf[0]))
	certCriteria := certInfoPrefix{
		issuer:       signerInfo.issuer,
		serialNumber: signerInfo.serialNumber,
	}
	certCtx, _, err := procCertFindCertificateInStore.Call(
		store,
		x509ASNAndPKCS7Encoding,
		0,
		certFindSubjectCert,
		uintptr(unsafe.Pointer(&certCriteria)),
		0,
	)
	if certCtx == 0 {
		return "", fmt.Errorf("cert_find_signer:%w", err)
	}
	defer procCertFreeCertificateContext.Call(certCtx)

	nameLen, _, _ := procCertGetNameStringW.Call(certCtx, certNameSimpleDisplayType, 0, 0, 0, 0)
	if nameLen <= 1 {
		return "", errors.New("cert_signer_name_empty")
	}
	nameBuf := make([]uint16, nameLen)
	_, _, _ = procCertGetNameStringW.Call(certCtx, certNameSimpleDisplayType, 0, 0, uintptr(unsafe.Pointer(&nameBuf[0])), nameLen)
	return syscall.UTF16ToString(nameBuf), nil
}

type defaultNSISInstallerLauncher struct{}

func (defaultNSISInstallerLauncher) LaunchSilentInstaller(installerPath string) error {
	// Match electron-updater's NsisUpdater silent relaunch flags so the NSIS
	// package installs silently and restarts the newly installed Molly build.
	cmd := exec.Command(installerPath, "--updated", "/S", "--force-run")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindowFlag}
	return cmd.Start()
}
