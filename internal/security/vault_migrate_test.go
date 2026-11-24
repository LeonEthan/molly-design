package security

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

type memoryMasterKeyProvider struct {
	key []byte
}

func (m *memoryMasterKeyProvider) LoadOrCreateMasterKey() ([]byte, error) {
	if len(m.key) == 0 {
		m.key = make([]byte, 32)
		if _, err := io.ReadFull(rand.Reader, m.key); err != nil {
			return nil, err
		}
	}
	out := make([]byte, len(m.key))
	copy(out, m.key)
	return out, nil
}

func sampleElectronVaultJSON() []byte {
	return []byte(`{
		"schemaVersion": 1,
		"installationId": "11111111-2222-4333-8444-555555555555",
		"entries": [
			{
				"connection": {
					"id": "conn-openai",
					"providerPresetId": "openai",
					"authType": "openai_oauth",
					"enabled": true,
					"credentialRef": "cred-1"
				},
				"oauth": {
					"accessToken": "tok-access-1",
					"refreshToken": "tok-refresh-1",
					"accessTokenExpiresAt": 1900000000000,
					"clientId": "dyn-client-1",
					"grantSeq": 7
				}
			},
			{
				"connection": {
					"id": "conn-deepseek",
					"providerPresetId": "deepseek",
					"authType": "api_key",
					"enabled": true,
					"credentialRef": "cred-2"
				},
				"apiKey": "sk-synthetic-deepseek-key"
			}
		],
		"image": {
			"connection": {
				"id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
				"revision": 1,
				"enabled": true,
				"protocol": "openai-images",
				"baseUrl": "https://api.example.com/v1",
				"model": "gpt-image-1",
				"hasApiKey": true,
				"legacyHistoryMayContainKey": false
			},
			"apiKey": "sk-synthetic-image-key"
		},
		"legacyImages": [
			{
				"v": 1,
				"enabled": true,
				"baseUrl": "https://api.example.com/v1",
				"model": "gpt-image-1",
				"apiKey": "sk-legacy-1",
				"updatedAt": 1700000000000
			}
		],
		"mcp": [
			{
				"connection": {
					"workspaceId": "local-ws:1",
					"serverId": "srv-1",
					"credentialRef": "22222222-3333-4444-8555-666666666666",
					"revision": 1,
					"destination": {
						"transport": "http",
						"url": "https://mcp.example.com/v1"
					},
					"fieldNames": ["Authorization"]
				},
				"values": {"Authorization": "Bearer synthetic-mcp"}
			}
		]
	}`)
}

func TestMigrateAndResealVaultLifecycleAndStaleDetection(t *testing.T) {
	secretsDir := filepath.Join(t.TempDir(), "secrets")
	if err := os.MkdirAll(secretsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	paths := DefaultVaultPaths(secretsDir)

	legacySecret := "synthetic-molly-keychain-pass"
	plainV1 := sampleElectronVaultJSON()
	encV1, err := EncryptMacOSOSCryptV10ForTest(legacySecret, plainV1)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.LegacyEncPath, encV1, 0o600); err != nil {
		t.Fatal(err)
	}

	keys := &memoryMasterKeyProvider{}
	decryptFn := func(blob []byte) ([]byte, error) {
		return DecryptMacOSOSCryptV10(legacySecret, blob)
	}

	first, err := MigrateAndResealVault(paths, decryptFn, keys)
	if err != nil {
		t.Fatalf("first migration failed: %v", err)
	}
	if !first.Migrated || !first.BackupCreated {
		t.Fatalf("expected Migrated=true BackupCreated=true, got %+v", first)
	}
	if len(first.Document.Entries) != 2 || len(first.Document.MCP) != 1 || len(first.Document.LegacyImages) != 1 || len(first.Document.Image) == 0 {
		t.Fatalf("expected all schemaVersion 1 sections preserved, got %+v", first.Document)
	}
	if bytes.Contains(first.PlainJSON, []byte("grantSeq")) {
		t.Fatal("expected legacy oauth.grantSeq to be stripped on normalization")
	}

	if _, err := os.Stat(paths.LegacyEncPath); err != nil {
		t.Fatalf("legacy .enc must be preserved: %v", err)
	}
	bakBytes, err := os.ReadFile(paths.BackupEncPath)
	if err != nil || !bytes.Equal(bakBytes, encV1) {
		t.Fatalf("backup .enc.bak mismatch: err=%v", err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(paths.V2VaultPath)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("v2 vault mode = %o, want 0600", info.Mode().Perm())
		}
	}

	second, err := MigrateAndResealVault(paths, decryptFn, keys)
	if err != nil {
		t.Fatalf("idempotent re-read failed: %v", err)
	}
	if second.Migrated || second.BackupCreated {
		t.Fatalf("expected second run to reuse v2 without remigrating, got %+v", second)
	}
	if !bytes.Equal(second.PlainJSON, first.PlainJSON) {
		t.Fatal("idempotent v2 read changed vault payload")
	}

	updatedPlain := bytes.ReplaceAll(plainV1, []byte("tok-refresh-1"), []byte("tok-refresh-rotated-2"))
	encV1Updated, err := EncryptMacOSOSCryptV10ForTest(legacySecret, updatedPlain)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.LegacyEncPath, encV1Updated, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := MigrateAndResealVault(paths, decryptFn, keys); !errors.Is(err, ErrStaleV2Vault) {
		t.Fatalf("expected ErrStaleV2Vault when Electron updated .enc, got %v", err)
	}

	remigrated, err := RemigrateVaultFromLegacy(paths, decryptFn, keys)
	if err != nil {
		t.Fatalf("RemigrateVaultFromLegacy failed: %v", err)
	}
	if !remigrated.Migrated || !bytes.Contains(remigrated.PlainJSON, []byte("tok-refresh-rotated-2")) {
		t.Fatal("expected remigrated vault to reflect rotated OAuth token")
	}
	if remigrated.SourceEncSHA256 != sha256.Sum256(encV1Updated) {
		t.Fatal("remigrated source SHA-256 mismatch")
	}
	bakAfterRemigrate, err := os.ReadFile(paths.BackupEncPath)
	if err != nil || !bytes.Equal(bakAfterRemigrate, encV1) {
		t.Fatal("remigration must preserve original pre-migration .enc.bak untouched")
	}

	if err := os.Remove(paths.LegacyEncPath); err != nil {
		t.Fatal(err)
	}
	if _, err := MigrateAndResealVault(paths, decryptFn, keys); !errors.Is(err, ErrStaleV2Vault) {
		t.Fatalf("expected ErrStaleV2Vault when source .enc is deleted, got %v", err)
	}
}

func TestParseAndNormalizeVaultJSONRejectsInvalidSchemaTypes(t *testing.T) {
	badAPIKey := []byte(`{"schemaVersion":1,"entries":[{"connection":{"id":"c1","providerPresetId":"deepseek"},"apiKey":12345}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(badAPIKey); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected numeric apiKey rejected, got %v", err)
	}

	badImage := []byte(`{"schemaVersion":1,"entries":[],"image":{"connection":"not-an-object","apiKey":"sk-1"}}`)
	if _, _, err := ParseAndNormalizeVaultJSON(badImage); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected invalid image object rejected, got %v", err)
	}

	emptyNonCompatKey := []byte(`{"schemaVersion":1,"entries":[{"connection":{"id":"c1","providerPresetId":"deepseek"},"apiKey":""}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(emptyNonCompatKey); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected empty non-compatible apiKey rejected, got %v", err)
	}

	legacyMCPShape := []byte(`{"schemaVersion":1,"entries":[],"mcp":[{"connection":{"workspaceId":"ws-1","serverId":"s1","credentialRef":"22222222-3333-4444-8555-666666666666"},"headers":{"Authorization":"Bearer x"}}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(legacyMCPShape); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected non-StoredMcpCredentialSchema headers shape rejected, got %v", err)
	}

	mismatchedMCPFields := []byte(`{"schemaVersion":1,"entries":[],"mcp":[{"connection":{"workspaceId":"ws-1","serverId":"s1","credentialRef":"22222222-3333-4444-8555-666666666666","revision":1,"destination":{"transport":"http","url":"https://mcp.example.com"},"fieldNames":["X-Token"]},"values":{"Authorization":"Bearer x"}}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(mismatchedMCPFields); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected mismatched mcp fieldNames/values rejected, got %v", err)
	}

	reservedMCPHeader := []byte(`{"schemaVersion":1,"entries":[],"mcp":[{"connection":{"workspaceId":"ws-1","serverId":"s1","credentialRef":"22222222-3333-4444-8555-666666666666","revision":1,"destination":{"transport":"http","url":"https://mcp.example.com"},"fieldNames":["Host"]},"values":{"Host":"evil.example"}}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(reservedMCPHeader); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected reserved mcp header rejected, got %v", err)
	}

	badLegacyImage := []byte(`{"schemaVersion":1,"entries":[],"legacyImages":[{"id":"legacy-1","apiKey":"sk-1"}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(badLegacyImage); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected invalid legacyImages shape rejected, got %v", err)
	}

	nullImageAPIKey := []byte(`{"schemaVersion":1,"entries":[],"image":{"connection":{"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","revision":1,"enabled":true,"baseUrl":"https://api.example.com/v1","model":"gpt-image-1","hasApiKey":false,"legacyHistoryMayContainKey":false},"apiKey":null}}`)
	if _, _, err := ParseAndNormalizeVaultJSON(nullImageAPIKey); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected null image.apiKey rejected, got %v", err)
	}

	nullStdioArgs := []byte(`{"schemaVersion":1,"entries":[],"mcp":[{"connection":{"workspaceId":"lw_1","serverId":"s1","credentialRef":"22222222-3333-4444-8555-666666666666","revision":1,"destination":{"transport":"stdio","command":"npx","args":null},"fieldNames":["API_TOKEN"]},"values":{"API_TOKEN":"secret"}}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(nullStdioArgs); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected null mcp stdio destination.args rejected, got %v", err)
	}

	nullMCPValue := []byte(`{"schemaVersion":1,"entries":[],"mcp":[{"connection":{"workspaceId":"lw_1","serverId":"s1","credentialRef":"22222222-3333-4444-8555-666666666666","revision":1,"destination":{"transport":"http","url":"https://mcp.example.com"},"fieldNames":["Authorization"]},"values":{"Authorization":null}}]}`)
	if _, _, err := ParseAndNormalizeVaultJSON(nullMCPValue); !errors.Is(err, ErrInvalidVaultSchema) {
		t.Fatalf("expected null mcp value rejected, got %v", err)
	}
}

func TestMV2HeaderAADTamperRejected(t *testing.T) {
	key := bytes.Repeat([]byte{0x7a}, 32)
	srcSHA := sha256.Sum256([]byte("legacy-v1-blob"))
	sealed, err := SealMV2Vault(key, srcSHA, []byte(`{"schemaVersion":1,"entries":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	tampered := append([]byte(nil), sealed...)
	tampered[10] ^= 0x01
	if _, _, err := OpenMV2Vault(key, tampered); !errors.Is(err, ErrInvalidVaultFormat) {
		t.Fatalf("expected AAD header tamper to fail with ErrInvalidVaultFormat, got %v", err)
	}
}

func TestUnwrapChromiumLocalStateKey(t *testing.T) {
	expectedKey := bytes.Repeat([]byte{0x33}, 32)
	dpapiWrapped := append([]byte("DPAPI"), []byte("fake-dpapi-cipher")...)
	stateJSON, _ := json.Marshal(map[string]any{
		"os_crypt": map[string]any{
			"encrypted_key": base64.StdEncoding.EncodeToString(dpapiWrapped),
		},
	})
	got, err := UnwrapChromiumLocalStateKey(stateJSON, func(cipher []byte) ([]byte, error) {
		if string(cipher) != "fake-dpapi-cipher" {
			return nil, errors.New("unexpected dpapi payload")
		}
		return expectedKey, nil
	})
	if err != nil {
		t.Fatalf("UnwrapChromiumLocalStateKey failed: %v", err)
	}
	if !bytes.Equal(got, expectedKey) {
		t.Fatal("unwrapped key mismatch")
	}
}

func TestDarwinIsolatedTempKeychainRoundTripAndMigration(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS isolated keychain test only runs on darwin")
	}
	securityBin, err := exec.LookPath("security")
	if err != nil {
		t.Skip("security CLI unavailable")
	}

	tmpDir := t.TempDir()
	kcPath := filepath.Join(tmpDir, "molly-test.keychain-db")
	kcPass := "synthetic-temp-keychain-pass"

	runSec := func(args ...string) {
		t.Helper()
		cmd := exec.Command(securityBin, args...)
		if out, cmdErr := cmd.CombinedOutput(); cmdErr != nil {
			t.Fatalf("security %v failed: %v\n%s", args, cmdErr, string(out))
		}
	}
	runSec("create-keychain", "-p", kcPass, kcPath)
	runSec("unlock-keychain", "-p", kcPass, kcPath)
	runSec("set-keychain-settings", kcPath)

	opts := KeychainOptions{KeychainPath: kcPath, KeychainPassword: kcPass}
	const service = "Molly Test Safe Storage"
	const account = "Molly Test Key"

	if _, err := ReadKeychainGenericPassword(service, account, opts); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("expected ErrSecretNotFound on empty temp keychain, got %v", err)
	}

	if err := SetKeychainGenericPassword(service, account, []byte("synthetic-safe-storage-secret"), opts); err != nil {
		t.Fatalf("SetKeychainGenericPassword failed: %v", err)
	}
	got, err := ReadKeychainGenericPassword(service, account, opts)
	if err != nil {
		t.Fatalf("ReadKeychainGenericPassword failed: %v", err)
	}
	if string(got) != "synthetic-safe-storage-secret" {
		t.Fatalf("secret = %q, want %q", string(got), "synthetic-safe-storage-secret")
	}

	if err := SetKeychainGenericPassword(service, account, []byte("rotated-secret"), opts); err != nil {
		t.Fatalf("SetKeychainGenericPassword update failed: %v", err)
	}
	got2, err := ReadKeychainGenericPassword(service, account, opts)
	if err != nil || string(got2) != "rotated-secret" {
		t.Fatalf("updated secret = %q (err=%v), want rotated-secret", string(got2), err)
	}

	secretsDir := filepath.Join(tmpDir, "secrets")
	paths := DefaultVaultPaths(secretsDir)
	encV1, err := EncryptMacOSOSCryptV10ForTest(string(got2), sampleElectronVaultJSON())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(secretsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.LegacyEncPath, encV1, 0o600); err != nil {
		t.Fatal(err)
	}

	masterProvider := KeychainMasterKeyProvider{
		Service: "Molly Test Vault V2",
		Account: "Master Key",
		Options: opts,
	}
	migrated, err := MigrateAndResealVault(paths, func(blob []byte) ([]byte, error) {
		legacyKey, kErr := ReadKeychainGenericPassword(service, account, opts)
		if kErr != nil {
			return nil, kErr
		}
		return DecryptMacOSOSCryptV10(string(legacyKey), blob)
	}, masterProvider)
	if err != nil {
		t.Fatalf("temp keychain vault migration failed: %v", err)
	}
	if !migrated.Migrated || len(migrated.Document.Entries) != 2 {
		t.Fatalf("unexpected migration result: %+v", migrated)
	}

	if err := DeleteKeychainGenericPassword(service, account, opts); err != nil {
		t.Fatalf("DeleteKeychainGenericPassword failed: %v", err)
	}
	if _, err := ReadKeychainGenericPassword(service, account, opts); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("expected ErrSecretNotFound after delete, got %v", err)
	}
}
