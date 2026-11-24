//go:build !darwin || ios

package security

func ReadKeychainGenericPassword(string, string, KeychainOptions) ([]byte, error) {
	return nil, ErrKeychainUnsupported
}

func SetKeychainGenericPassword(string, string, []byte, KeychainOptions) error {
	return ErrKeychainUnsupported
}

func DeleteKeychainGenericPassword(string, string, KeychainOptions) error {
	return ErrKeychainUnsupported
}
