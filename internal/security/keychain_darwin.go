//go:build darwin && !ios

package security

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
)

const (
	errSecSuccess               = 0
	errSecDuplicateItem         = -25299
	errSecItemNotFound          = -25300
	errSecInteractionNotAllowed = -25308
	cfStringEncodingUTF8        = 0x08000100
)

type darwinKeychainAPI struct {
	err error

	cfStringCreateWithBytes           func(alloc uintptr, bytes *byte, numBytes int64, encoding uint32, isExternal uint8) uintptr
	cfStringGetLength                 func(str uintptr) int64
	cfStringGetMaximumSizeForEncoding func(length int64, encoding uint32) int64
	cfStringGetCString                func(str uintptr, buf *byte, bufSize int64, encoding uint32) uint8
	cfDataCreate                      func(alloc uintptr, bytes *byte, length int64) uintptr
	cfDataGetLength                   func(data uintptr) int64
	cfDataGetBytes                    func(data uintptr, loc int64, length int64, buf *byte)
	cfDictionaryCreateMutable         func(alloc uintptr, capacity int64, keyCallBacks uintptr, valueCallBacks uintptr) uintptr
	cfDictionarySetValue              func(dict uintptr, key uintptr, value uintptr)
	cfArrayCreate                     func(alloc uintptr, values *uintptr, numValues int64, callBacks uintptr) uintptr
	cfRelease                         func(cf uintptr)

	cfTypeDictKeyCallbacks   uintptr
	cfTypeDictValueCallbacks uintptr
	cfTypeArrayCallbacks     uintptr
	cfBooleanTrue            uintptr

	secItemCopyMatching       func(query uintptr, result *uintptr) int32
	secItemAdd                func(attrs uintptr, result uintptr) int32
	secItemUpdate             func(query uintptr, attrs uintptr) int32
	secItemDelete             func(query uintptr) int32
	secKeychainOpen           func(pathName *byte, keychain *uintptr) int32
	secKeychainUnlock         func(keychain uintptr, passwordLength uint32, password *byte, usePassword uint8) int32
	secCopyErrorMessageString func(status int32, reserved uintptr) uintptr

	kSecClass                   uintptr
	kSecClassGenericPassword    uintptr
	kSecAttrService             uintptr
	kSecAttrAccount             uintptr
	kSecAttrLabel               uintptr
	kSecValueData               uintptr
	kSecReturnData              uintptr
	kSecMatchLimit              uintptr
	kSecMatchLimitOne           uintptr
	kSecUseAuthenticationUI     uintptr
	kSecUseAuthenticationUIFail uintptr
	kSecMatchSearchList         uintptr
	kSecUseKeychain             uintptr
}

var loadDarwinKeychain = sync.OnceValue(func() *darwinKeychainAPI {
	api := &darwinKeychainAPI{}
	cf, err := purego.Dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", purego.RTLD_GLOBAL|purego.RTLD_NOW)
	if err != nil {
		api.err = fmt.Errorf("load CoreFoundation.framework: %w", err)
		return api
	}
	sec, err := purego.Dlopen("/System/Library/Frameworks/Security.framework/Security", purego.RTLD_GLOBAL|purego.RTLD_NOW)
	if err != nil {
		api.err = fmt.Errorf("load Security.framework: %w", err)
		return api
	}
	libSys, err := purego.Dlopen("/usr/lib/libSystem.B.dylib", purego.RTLD_GLOBAL|purego.RTLD_NOW)
	if err != nil {
		api.err = fmt.Errorf("load libSystem.B.dylib: %w", err)
		return api
	}
	var cMemcpy func(dst unsafe.Pointer, src uintptr, n uintptr)
	purego.RegisterLibFunc(&cMemcpy, libSys, "memcpy")

	sym := func(lib uintptr, name string) uintptr {
		if api.err != nil {
			return 0
		}
		ptr, symErr := purego.Dlsym(lib, name)
		if symErr != nil {
			api.err = fmt.Errorf("lookup %s: %w", name, symErr)
			return 0
		}
		return ptr
	}
	derefConst := func(lib uintptr, name string) uintptr {
		addr := sym(lib, name)
		if addr == 0 {
			return 0
		}
		var out uintptr
		cMemcpy(unsafe.Pointer(&out), addr, unsafe.Sizeof(out))
		return out
	}

	purego.RegisterLibFunc(&api.cfStringCreateWithBytes, cf, "CFStringCreateWithBytes")
	purego.RegisterLibFunc(&api.cfStringGetLength, cf, "CFStringGetLength")
	purego.RegisterLibFunc(&api.cfStringGetMaximumSizeForEncoding, cf, "CFStringGetMaximumSizeForEncoding")
	purego.RegisterLibFunc(&api.cfStringGetCString, cf, "CFStringGetCString")
	purego.RegisterLibFunc(&api.cfDataCreate, cf, "CFDataCreate")
	purego.RegisterLibFunc(&api.cfDataGetLength, cf, "CFDataGetLength")
	purego.RegisterLibFunc(&api.cfDataGetBytes, cf, "CFDataGetBytes")
	purego.RegisterLibFunc(&api.cfDictionaryCreateMutable, cf, "CFDictionaryCreateMutable")
	purego.RegisterLibFunc(&api.cfDictionarySetValue, cf, "CFDictionarySetValue")
	purego.RegisterLibFunc(&api.cfArrayCreate, cf, "CFArrayCreate")
	purego.RegisterLibFunc(&api.cfRelease, cf, "CFRelease")

	api.cfTypeDictKeyCallbacks = sym(cf, "kCFTypeDictionaryKeyCallBacks")
	api.cfTypeDictValueCallbacks = sym(cf, "kCFTypeDictionaryValueCallBacks")
	api.cfTypeArrayCallbacks = sym(cf, "kCFTypeArrayCallBacks")
	api.cfBooleanTrue = derefConst(cf, "kCFBooleanTrue")

	purego.RegisterLibFunc(&api.secItemCopyMatching, sec, "SecItemCopyMatching")
	purego.RegisterLibFunc(&api.secItemAdd, sec, "SecItemAdd")
	purego.RegisterLibFunc(&api.secItemUpdate, sec, "SecItemUpdate")
	purego.RegisterLibFunc(&api.secItemDelete, sec, "SecItemDelete")
	purego.RegisterLibFunc(&api.secKeychainOpen, sec, "SecKeychainOpen")
	purego.RegisterLibFunc(&api.secKeychainUnlock, sec, "SecKeychainUnlock")
	purego.RegisterLibFunc(&api.secCopyErrorMessageString, sec, "SecCopyErrorMessageString")

	api.kSecClass = derefConst(sec, "kSecClass")
	api.kSecClassGenericPassword = derefConst(sec, "kSecClassGenericPassword")
	api.kSecAttrService = derefConst(sec, "kSecAttrService")
	api.kSecAttrAccount = derefConst(sec, "kSecAttrAccount")
	api.kSecAttrLabel = derefConst(sec, "kSecAttrLabel")
	api.kSecValueData = derefConst(sec, "kSecValueData")
	api.kSecReturnData = derefConst(sec, "kSecReturnData")
	api.kSecMatchLimit = derefConst(sec, "kSecMatchLimit")
	api.kSecMatchLimitOne = derefConst(sec, "kSecMatchLimitOne")
	api.kSecUseAuthenticationUI = derefConst(sec, "kSecUseAuthenticationUI")
	api.kSecUseAuthenticationUIFail = derefConst(sec, "kSecUseAuthenticationUIFail")
	api.kSecMatchSearchList = derefConst(sec, "kSecMatchSearchList")
	api.kSecUseKeychain = derefConst(sec, "kSecUseKeychain")

	return api
})

func (a *darwinKeychainAPI) release(ref uintptr) {
	if ref != 0 {
		a.cfRelease(ref)
	}
}

func (a *darwinKeychainAPI) newCFString(s string) uintptr {
	b := []byte(s)
	var ptr *byte
	if len(b) > 0 {
		ptr = &b[0]
	}
	return a.cfStringCreateWithBytes(0, ptr, int64(len(b)), cfStringEncodingUTF8, 0)
}

func (a *darwinKeychainAPI) cfStringToGo(ref uintptr) string {
	if ref == 0 {
		return ""
	}
	length := a.cfStringGetLength(ref)
	maxSize := a.cfStringGetMaximumSizeForEncoding(length, cfStringEncodingUTF8)
	bufSize := int(maxSize) + 1
	if bufSize <= 1 {
		return ""
	}
	buf := make([]byte, bufSize)
	if a.cfStringGetCString(ref, &buf[0], int64(bufSize), cfStringEncodingUTF8) == 0 {
		return ""
	}
	if idx := strings.IndexByte(string(buf), 0); idx >= 0 {
		return string(buf[:idx])
	}
	return string(buf)
}

func (a *darwinKeychainAPI) newCFData(data []byte) uintptr {
	var ptr *byte
	if len(data) > 0 {
		ptr = &data[0]
	}
	return a.cfDataCreate(0, ptr, int64(len(data)))
}

func (a *darwinKeychainAPI) cfDataToBytes(ref uintptr) []byte {
	if ref == 0 {
		return nil
	}
	n := int(a.cfDataGetLength(ref))
	if n <= 0 {
		return []byte{}
	}
	out := make([]byte, n)
	a.cfDataGetBytes(ref, 0, int64(n), &out[0])
	return out
}

func (a *darwinKeychainAPI) newCFDict() uintptr {
	return a.cfDictionaryCreateMutable(0, 0, a.cfTypeDictKeyCallbacks, a.cfTypeDictValueCallbacks)
}

func (a *darwinKeychainAPI) dictSet(dict, key, val uintptr) {
	a.cfDictionarySetValue(dict, key, val)
}

func (a *darwinKeychainAPI) newCFArraySingle(elem uintptr) uintptr {
	elems := [1]uintptr{elem}
	return a.cfArrayCreate(0, &elems[0], 1, a.cfTypeArrayCallbacks)
}

func (a *darwinKeychainAPI) statusErr(op string, code int32) error {
	switch code {
	case errSecSuccess:
		return nil
	case errSecItemNotFound:
		return ErrSecretNotFound
	case errSecInteractionNotAllowed:
		return ErrKeychainInteractionNotAllowed
	}
	var msg string
	if ref := a.secCopyErrorMessageString(code, 0); ref != 0 {
		msg = a.cfStringToGo(ref)
		a.release(ref)
	}
	if msg == "" {
		msg = "unknown keychain error"
	}
	return fmt.Errorf("keychain %s: %s (OSStatus %d)", op, msg, code)
}

func (a *darwinKeychainAPI) openOptionalKeychain(opts KeychainOptions) (uintptr, error) {
	if strings.TrimSpace(opts.KeychainPath) == "" {
		return 0, nil
	}
	cPath := append([]byte(opts.KeychainPath), 0)
	var kcRef uintptr
	if err := a.statusErr("open", a.secKeychainOpen(&cPath[0], &kcRef)); err != nil {
		return 0, err
	}
	if opts.KeychainPassword != "" {
		pwBytes := []byte(opts.KeychainPassword)
		defer zeroBytes(pwBytes)
		var pwPtr *byte
		if len(pwBytes) > 0 {
			pwPtr = &pwBytes[0]
		}
		if err := a.statusErr("unlock", a.secKeychainUnlock(kcRef, uint32(len(pwBytes)), pwPtr, 1)); err != nil {
			a.release(kcRef)
			return 0, err
		}
	}
	return kcRef, nil
}

func validateKeychainNames(service, account string) error {
	if strings.TrimSpace(service) == "" || strings.TrimSpace(account) == "" {
		return errors.New("keychain service and account are required")
	}
	if strings.ContainsRune(service, 0) || strings.ContainsRune(account, 0) {
		return errors.New("keychain service and account must not contain NUL")
	}
	return nil
}

func (a *darwinKeychainAPI) buildBaseQuery(service, account string, kcRef uintptr, forAdd bool) (uintptr, func(), error) {
	dict := a.newCFDict()
	if dict == 0 {
		return 0, nil, errors.New("failed to allocate CFDictionary")
	}
	svcRef := a.newCFString(service)
	acctRef := a.newCFString(account)
	var searchList uintptr
	cleanup := func() {
		a.release(searchList)
		a.release(acctRef)
		a.release(svcRef)
		a.release(dict)
	}
	if svcRef == 0 || acctRef == 0 {
		cleanup()
		return 0, nil, errors.New("failed to allocate CFString")
	}
	a.dictSet(dict, a.kSecClass, a.kSecClassGenericPassword)
	a.dictSet(dict, a.kSecAttrService, svcRef)
	a.dictSet(dict, a.kSecAttrAccount, acctRef)
	a.dictSet(dict, a.kSecUseAuthenticationUI, a.kSecUseAuthenticationUIFail)
	if kcRef != 0 {
		if forAdd {
			a.dictSet(dict, a.kSecUseKeychain, kcRef)
		} else {
			searchList = a.newCFArraySingle(kcRef)
			if searchList == 0 {
				cleanup()
				return 0, nil, errors.New("failed to allocate CFArray")
			}
			a.dictSet(dict, a.kSecMatchSearchList, searchList)
		}
	}
	return dict, cleanup, nil
}

func ReadKeychainGenericPassword(service, account string, opts KeychainOptions) ([]byte, error) {
	if err := validateKeychainNames(service, account); err != nil {
		return nil, err
	}
	api := loadDarwinKeychain()
	if api.err != nil {
		return nil, api.err
	}
	kcRef, err := api.openOptionalKeychain(opts)
	if err != nil {
		return nil, err
	}
	defer api.release(kcRef)

	query, cleanup, err := api.buildBaseQuery(service, account, kcRef, false)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	api.dictSet(query, api.kSecReturnData, api.cfBooleanTrue)
	api.dictSet(query, api.kSecMatchLimit, api.kSecMatchLimitOne)

	var result uintptr
	if err := api.statusErr("read", api.secItemCopyMatching(query, &result)); err != nil {
		return nil, err
	}
	if result == 0 {
		return nil, ErrSecretNotFound
	}
	defer api.release(result)
	return api.cfDataToBytes(result), nil
}

func SetKeychainGenericPassword(service, account string, secret []byte, opts KeychainOptions) error {
	if err := validateKeychainNames(service, account); err != nil {
		return err
	}
	api := loadDarwinKeychain()
	if api.err != nil {
		return api.err
	}
	kcRef, err := api.openOptionalKeychain(opts)
	if err != nil {
		return err
	}
	defer api.release(kcRef)

	valRef := api.newCFData(secret)
	if valRef == 0 {
		return errors.New("failed to allocate CFData")
	}
	defer api.release(valRef)

	updateQuery, cleanupQuery, err := api.buildBaseQuery(service, account, kcRef, false)
	if err != nil {
		return err
	}
	defer cleanupQuery()

	updateAttrs := api.newCFDict()
	if updateAttrs == 0 {
		return errors.New("failed to allocate update CFDictionary")
	}
	defer api.release(updateAttrs)
	api.dictSet(updateAttrs, api.kSecValueData, valRef)

	if status := api.secItemUpdate(updateQuery, updateAttrs); status != errSecItemNotFound {
		return api.statusErr("update", status)
	}

	addDict, cleanupAdd, err := api.buildBaseQuery(service, account, kcRef, true)
	if err != nil {
		return err
	}
	defer cleanupAdd()

	labelRef := api.newCFString(service)
	defer api.release(labelRef)
	api.dictSet(addDict, api.kSecValueData, valRef)
	if labelRef != 0 {
		api.dictSet(addDict, api.kSecAttrLabel, labelRef)
	}

	status := api.secItemAdd(addDict, 0)
	if status == errSecDuplicateItem {
		return api.statusErr("update", api.secItemUpdate(updateQuery, updateAttrs))
	}
	return api.statusErr("add", status)
}

func DeleteKeychainGenericPassword(service, account string, opts KeychainOptions) error {
	if err := validateKeychainNames(service, account); err != nil {
		return err
	}
	api := loadDarwinKeychain()
	if api.err != nil {
		return api.err
	}
	kcRef, err := api.openOptionalKeychain(opts)
	if err != nil {
		return err
	}
	defer api.release(kcRef)

	query, cleanup, err := api.buildBaseQuery(service, account, kcRef, false)
	if err != nil {
		return err
	}
	defer cleanup()

	err = api.statusErr("delete", api.secItemDelete(query))
	if errors.Is(err, ErrSecretNotFound) {
		return nil
	}
	return err
}
