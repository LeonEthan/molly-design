package security

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha1"
	"errors"
	"fmt"
	"io"
)

type KeychainProfile struct {
	Name    string
	Service string
	Account string
}

var (
	KeychainProfileProduction = KeychainProfile{
		Name:    "production",
		Service: "Molly Safe Storage",
		Account: "Molly Key",
	}
	KeychainProfilePreview = KeychainProfile{
		Name:    "preview",
		Service: "Molly Preview Safe Storage",
		Account: "Molly Preview Key",
	}
)

var (
	osCryptPrefix  = []byte("v10")
	macOSCryptSalt = []byte("saltysalt")
	macOSCryptIV   = bytes.Repeat([]byte(" "), aes.BlockSize)
)

const macOSCryptIterations = 1003

func DecryptMacOSOSCryptV10(keychainSecret string, blob []byte) ([]byte, error) {
	if !bytes.HasPrefix(blob, osCryptPrefix) {
		return nil, errors.New("missing v10 prefix")
	}
	ciphertext := blob[len(osCryptPrefix):]
	if len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("invalid AES-CBC ciphertext length %d", len(ciphertext))
	}
	key, err := pbkdf2.Key(sha1.New, keychainSecret, macOSCryptSalt, macOSCryptIterations, 16)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	plain := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, macOSCryptIV).CryptBlocks(plain, ciphertext)
	padLen := int(plain[len(plain)-1])
	if padLen == 0 || padLen > aes.BlockSize || padLen > len(plain) {
		return nil, errors.New("invalid PKCS#7 padding")
	}
	for i := len(plain) - padLen; i < len(plain); i++ {
		if int(plain[i]) != padLen {
			return nil, errors.New("invalid PKCS#7 padding bytes")
		}
	}
	return plain[:len(plain)-padLen], nil
}

func EncryptMacOSOSCryptV10ForTest(keychainSecret string, plaintext []byte) ([]byte, error) {
	key, err := pbkdf2.Key(sha1.New, keychainSecret, macOSCryptSalt, macOSCryptIterations, 16)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	padLen := aes.BlockSize - (len(plaintext) % aes.BlockSize)
	padded := make([]byte, len(plaintext)+padLen)
	copy(padded, plaintext)
	for i := len(plaintext); i < len(padded); i++ {
		padded[i] = byte(padLen)
	}
	ciphertext := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, macOSCryptIV).CryptBlocks(ciphertext, padded)
	out := make([]byte, 0, len(osCryptPrefix)+len(ciphertext))
	out = append(out, osCryptPrefix...)
	out = append(out, ciphertext...)
	return out, nil
}

func DecryptWindowsOSCryptV10(dpapiUnwrappedKey32 []byte, blob []byte) ([]byte, error) {
	if len(dpapiUnwrappedKey32) != 32 {
		return nil, fmt.Errorf("expected 32-byte AES-256 key, got %d", len(dpapiUnwrappedKey32))
	}
	if !bytes.HasPrefix(blob, osCryptPrefix) {
		return nil, errors.New("missing v10 prefix")
	}
	block, err := aes.NewCipher(dpapiUnwrappedKey32)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	body := blob[len(osCryptPrefix):]
	if len(body) < gcm.NonceSize()+gcm.Overhead() {
		return nil, errors.New("ciphertext shorter than GCM nonce + tag")
	}
	nonce := body[:gcm.NonceSize()]
	ciphertext := body[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func EncryptWindowsOSCryptV10ForTest(dpapiUnwrappedKey32 []byte, plaintext []byte) ([]byte, error) {
	if len(dpapiUnwrappedKey32) != 32 {
		return nil, fmt.Errorf("expected 32-byte AES-256 key, got %d", len(dpapiUnwrappedKey32))
	}
	block, err := aes.NewCipher(dpapiUnwrappedKey32)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	out := make([]byte, 0, len(osCryptPrefix)+len(nonce)+len(sealed))
	out = append(out, osCryptPrefix...)
	out = append(out, nonce...)
	out = append(out, sealed...)
	return out, nil
}
