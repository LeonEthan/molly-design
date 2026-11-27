package security

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestLeaseReclaimsDeadLocalWriter(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	if err = cmd.Run(); err != nil {
		t.Fatal(err)
	}
	host, _ := os.Hostname()
	now := time.Now().UnixMilli()
	lease := writerLease{1, "electron", cmd.Process.Pid, host, "dead", now, now + 60000}
	raw, _ := json.Marshal(lease)
	if err = root.WriteFile(vaultLeaseName, raw, 0600); err != nil {
		t.Fatal(err)
	}
	release, err := tryVaultWriter(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tryVaultWriter(root); !errors.Is(err, ErrVaultWriterBusy) {
		t.Fatalf("expected busy, got %v", err)
	}
	if err = release(); err != nil {
		t.Fatal(err)
	}
	next, err := tryVaultWriter(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = release(); err != nil {
		t.Fatal(err)
	}
	if err = next(); err != nil {
		t.Fatal(err)
	}
}

func TestVaultWriterLeaseCrossProcessWithElectronStore(t *testing.T) {
	if os.Getenv("MOLLY_TEST_ELECTRON_CROSS_SHELL") != "1" {
		t.Skip("requires MOLLY_TEST_ELECTRON_CROSS_SHELL=1")
	}
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	script := `import {ModelConnectionStore} from './apps/electron/src/main/services/model-connection-store.ts'
import fs from 'node:fs'
const cipher={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'fixture', encryptString(value){
 fs.writeSync(1,'locked\n')
 fs.readSync(0,Buffer.alloc(1),0,1,null)
 return Buffer.from(value)
}}
await new ModelConnectionStore(process.argv[1],cipher).deviceId()`
	cmd := exec.Command("node", "--input-type=module", "-e", script, dir)
	cmd.Dir = "../.."
	cmd.Stderr = os.Stderr
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	if signal, err := bufio.NewReader(out).ReadString('\n'); err != nil || signal != "locked\n" {
		t.Fatal(signal, err)
	}
	if _, err = tryVaultWriter(root); !errors.Is(err, ErrVaultWriterBusy) {
		t.Fatalf("Electron did not exclude Go writer: %v", err)
	}
	if _, err = in.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	if err = cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	paths := DefaultVaultPaths(dir)
	result, err := MigrateAndResealVault(paths, func(raw []byte) ([]byte, error) { return raw, nil }, &memoryMasterKeyProvider{})
	if err != nil || result.Document.InstallationID == "" || !result.BackupCreated {
		t.Fatalf("migration after Electron release: %v", err)
	}
}

func TestOAuthRefreshDrainAndVaultHandoffWithElectronStore(t *testing.T) {
	if os.Getenv("MOLLY_TEST_ELECTRON_CROSS_SHELL") != "1" {
		t.Skip("requires MOLLY_TEST_ELECTRON_CROSS_SHELL=1")
	}
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	script := `import {ModelConnectionStore} from './apps/electron/src/main/services/model-connection-store.ts'
import fs from 'node:fs'
let holdNextWrite = false
const cipher = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'fixture',
  decryptString: (buf) => Buffer.from(buf).toString('utf8'),
  encryptString(value) {
    if (holdNextWrite) {
      holdNextWrite = false
      fs.writeSync(1, 'rotating_locked\n')
      fs.readSync(0, Buffer.alloc(1), 0, 1, null)
    }
    return Buffer.from(value, 'utf8')
  }
}
const store = new ModelConnectionStore(process.argv[1], cipher)
const { connection } = await store.saveOAuthConnection(
  {
    displayName: 'OpenAI OAuth',
    providerPresetId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    authType: 'openai_oauth'
  },
  {
    accessToken: 'at-old',
    refreshToken: 'rt-old',
    accessTokenExpiresAt: 1900000000000,
    clientId: 'client-handoff'
  },
  { email: 'handoff@example.com' }
)
let enterRotation
const entered = new Promise((resolve) => { enterRotation = resolve })
const rotation = store.mutateOAuth(connection.id, async (current) => {
  enterRotation()
  holdNextWrite = true
  return {
    ...current,
    accessToken: 'at-rotated',
    refreshToken: 'rt-rotated',
    accessTokenExpiresAt: 1900003600000
  }
})
await entered
const drain = store.drainOAuthForHandoff()
let newBlocked = false
try {
  await store.mutateOAuth(connection.id, async () => { throw new Error('unexpected') })
} catch (err) {
  newBlocked = err && err.message === 'oauth_refresh_draining'
}
if (!newBlocked) throw new Error('expected oauth_refresh_draining')
await rotation
await drain
fs.writeSync(1, 'drained\n')`

	cmd := exec.Command("node", "--input-type=module", "-e", script, dir)
	cmd.Dir = "../.."
	cmd.Stderr = os.Stderr
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer in.Close()

	reader := bufio.NewReader(out)
	if signal, err := reader.ReadString('\n'); err != nil || signal != "rotating_locked\n" {
		t.Fatalf("expected rotating_locked signal, got %q (%v)", signal, err)
	}

	paths := DefaultVaultPaths(dir)
	masterKey := &memoryMasterKeyProvider{}
	if _, err := MigrateAndResealVault(paths, func(raw []byte) ([]byte, error) { return raw, nil }, masterKey); !errors.Is(err, ErrVaultWriterBusy) {
		t.Fatalf("expected Go migration to defer while Electron persists rotated OAuth token, got %v", err)
	}

	if _, err = in.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	if signal, err := reader.ReadString('\n'); err != nil || signal != "drained\n" {
		t.Fatalf("expected drained signal, got %q (%v)", signal, err)
	}
	if err = cmd.Wait(); err != nil {
		t.Fatal(err)
	}

	result, err := MigrateAndResealVault(paths, func(raw []byte) ([]byte, error) { return raw, nil }, masterKey)
	if err != nil {
		t.Fatalf("migration after Electron OAuth drain failed: %v", err)
	}
	if !result.Migrated || !result.BackupCreated || len(result.Document.Entries) != 1 {
		t.Fatalf("unexpected migration result: migrated=%v backup=%v entries=%d", result.Migrated, result.BackupCreated, len(result.Document.Entries))
	}
	var entry struct {
		OAuth struct {
			AccessToken  string `json:"accessToken"`
			RefreshToken string `json:"refreshToken"`
		} `json:"oauth"`
	}
	if err := json.Unmarshal(result.Document.Entries[0], &entry); err != nil {
		t.Fatal(err)
	}
	if entry.OAuth.AccessToken != "at-rotated" || entry.OAuth.RefreshToken != "rt-rotated" {
		t.Fatalf("rotated OAuth tokens lost during handoff: %+v", entry.OAuth)
	}
}
