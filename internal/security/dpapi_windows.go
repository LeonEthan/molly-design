//go:build windows

package security

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

const cryptProtectUIForbidden = 0x1

type dpapiDataBlob struct {
	cbData uint32
	pbData *byte
}

var (
	modCrypt32             = windows.NewLazySystemDLL("crypt32.dll")
	procCryptProtectData   = modCrypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = modCrypt32.NewProc("CryptUnprotectData")
)

func ProtectDPAPI(plaintext []byte) ([]byte, error) {
	var inBlob dpapiDataBlob
	if len(plaintext) > 0 {
		inBlob.cbData = uint32(len(plaintext))
		inBlob.pbData = &plaintext[0]
	}
	var outBlob dpapiDataBlob
	r1, _, lastErr := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&inBlob)),
		0,
		0,
		0,
		0,
		uintptr(cryptProtectUIForbidden),
		uintptr(unsafe.Pointer(&outBlob)),
	)
	if r1 == 0 {
		return nil, fmt.Errorf("CryptProtectData failed: %w", lastErr)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(outBlob.pbData)))
	out := make([]byte, outBlob.cbData)
	copy(out, unsafe.Slice(outBlob.pbData, outBlob.cbData))
	return out, nil
}

func UnprotectDPAPI(ciphertext []byte) ([]byte, error) {
	var inBlob dpapiDataBlob
	if len(ciphertext) > 0 {
		inBlob.cbData = uint32(len(ciphertext))
		inBlob.pbData = &ciphertext[0]
	}
	var outBlob dpapiDataBlob
	r1, _, lastErr := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&inBlob)),
		0,
		0,
		0,
		0,
		uintptr(cryptProtectUIForbidden),
		uintptr(unsafe.Pointer(&outBlob)),
	)
	if r1 == 0 {
		return nil, fmt.Errorf("CryptUnprotectData failed: %w", lastErr)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(outBlob.pbData)))
	out := make([]byte, outBlob.cbData)
	copy(out, unsafe.Slice(outBlob.pbData, outBlob.cbData))
	return out, nil
}
