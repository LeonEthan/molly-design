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
