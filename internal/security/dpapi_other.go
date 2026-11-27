//go:build !windows

package security

func ProtectDPAPI([]byte) ([]byte, error) {
	return nil, ErrDPAPIUnsupported
}

func UnprotectDPAPI([]byte) ([]byte, error) {
	return nil, ErrDPAPIUnsupported
}
