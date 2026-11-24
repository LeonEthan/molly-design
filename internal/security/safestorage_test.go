package security

import (
	"bytes"
	"encoding/hex"
	"testing"
)

func TestDecryptMacOSOSCryptV10CrossVerifiedVector(t *testing.T) {
	// Cross-verified with Node/OpenSSL PBKDF2-HMAC-SHA1 + AES-128-CBC (Stage 0 PoC).
	vectorHex := "7631308690a7cb3c7871d1a16024469ce35b43"
	vectorBytes, err := hex.DecodeString(vectorHex)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := DecryptMacOSOSCryptV10("peanuts", vectorBytes)
	if err != nil {
		t.Fatalf("DecryptMacOSOSCryptV10 vector failed: %v", err)
	}
	if string(plain) != "hello" {
		t.Fatalf("plaintext = %q, want %q", string(plain), "hello")
	}

	payload := []byte(`{"schemaVersion":1,"connections":[]}`)
	sealed, err := EncryptMacOSOSCryptV10ForTest("synthetic-molly-key", payload)
	if err != nil {
		t.Fatal(err)
	}
	opened, err := DecryptMacOSOSCryptV10("synthetic-molly-key", sealed)
	if err != nil {
		t.Fatalf("round-trip decrypt failed: %v", err)
	}
	if !bytes.Equal(opened, payload) {
		t.Fatalf("round-trip mismatch")
	}
	if _, err := DecryptMacOSOSCryptV10("wrong-secret", sealed); err == nil {
		t.Fatal("expected wrong keychain secret to fail")
	}
}

func TestDecryptWindowsOSCryptV10RoundTripAndTamperRejection(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	payload := []byte(`{"schemaVersion":1,"imageConnection":{"model":"gpt-image-1"}}`)
	sealed, err := EncryptWindowsOSCryptV10ForTest(key, payload)
	if err != nil {
		t.Fatal(err)
	}
	opened, err := DecryptWindowsOSCryptV10(key, sealed)
	if err != nil {
		t.Fatalf("DecryptWindowsOSCryptV10 failed: %v", err)
	}
	if !bytes.Equal(opened, payload) {
		t.Fatalf("windows round-trip mismatch")
	}

	tampered := append([]byte(nil), sealed...)
	tampered[len(tampered)-1] ^= 0xff
	if _, err := DecryptWindowsOSCryptV10(key, tampered); err == nil {
		t.Fatal("expected tampered GCM ciphertext to fail")
	}
	if _, err := DecryptWindowsOSCryptV10(key[:16], sealed); err == nil {
		t.Fatal("expected non-32-byte key to fail")
	}
}
