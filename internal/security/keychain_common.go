package security

import "errors"

var (
	ErrSecretNotFound                = errors.New("keychain secret not found")
	ErrKeychainInteractionNotAllowed = errors.New("keychain interaction not allowed")
	ErrKeychainUnsupported           = errors.New("native keychain unsupported on this platform")
	ErrDPAPIUnsupported              = errors.New("windows DPAPI unsupported on this platform")
)

type KeychainOptions struct {
	KeychainPath     string
	KeychainPassword string
}
