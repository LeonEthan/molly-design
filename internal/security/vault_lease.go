package security

import (
	"database/sql"
	"encoding/json"
	"errors"

	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const vaultLeaseName = "model-connections.writer.lease"

var ErrVaultWriterBusy = errors.New("model connection vault writer busy")

type writerLease struct {
	Version      int    `json:"version"`
	Owner        string `json:"owner"`
	PID          int    `json:"pid"`
	Host         string `json:"host"`
	LeaseID      string `json:"leaseId"`
	AcquiredAtMs int64  `json:"acquiredAtMs"`
	ExpiresAtMs  int64  `json:"expiresAtMs"`
}

func readWriterLease(root *os.Root) (writerLease, error) {
	var lease writerLease
	raw, err := ReadBoundedFileFromRoot(root, vaultLeaseName, 4096)
	if err != nil {
		return lease, err
	}
	err = json.Unmarshal(raw, &lease)
	if err != nil && !json.Valid(raw) {
		info, statErr := root.Lstat(vaultLeaseName)
		if statErr == nil && info.Mode().IsRegular() && time.Since(info.ModTime()) >= time.Minute {
			return lease, nil
		}
	}
	if err == nil && (lease.Version != 1 || lease.LeaseID == "" || lease.PID <= 0 || lease.Host == "" || lease.ExpiresAtMs <= lease.AcquiredAtMs || (lease.Owner != "electron" && lease.Owner != "mygo")) {
		err = ErrInvalidVaultFormat
	}
	return lease, err
}

func tryVaultWriter(root *os.Root) (func() error, error) {
	guard := vaultLeaseName + ".guard"
	f, err := root.OpenFile(guard, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		if err = f.Close(); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	info, err := root.Lstat(guard)
	if err != nil || !info.Mode().IsRegular() {
		return nil, os.ErrInvalid
	}
	guardPath, err := filepath.Abs(filepath.Join(root.Name(), guard))
	if err != nil {
		return nil, err
	}
	named, err := os.Lstat(guardPath)
	if err != nil || !os.SameFile(info, named) {
		return nil, os.ErrInvalid
	}
	uriPath := filepath.ToSlash(guardPath)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	uri := url.URL{Scheme: "file", Path: uriPath, RawQuery: "mode=rw"}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	success := false
	defer func() {
		if !success {
			db.Close()
		}
	}()
	if _, err = db.Exec("BEGIN IMMEDIATE"); err != nil {
		var code interface{ Code() int }
		if errors.As(err, &code) && code.Code()&255 == 5 {
			return nil, ErrVaultWriterBusy
		}
		return nil, err
	}
	host, err := os.Hostname()
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	old, err := readWriterLease(root)
	if err == nil {
		if old.ExpiresAtMs > now && (old.Host != host || !vaultPIDDead(old.PID)) {
			return nil, ErrVaultWriterBusy
		}
		retired := vaultLeaseName + "." + uuid.NewString()
		if err = root.Rename(vaultLeaseName, retired); err != nil {
			return nil, err
		}
		if err = root.Remove(retired); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	lease := writerLease{1, "mygo", os.Getpid(), host, uuid.NewString(), now, now + 60000}
	record, err := root.OpenFile(vaultLeaseName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	err = json.NewEncoder(record).Encode(lease)
	closeErr := record.Close()
	if err = errors.Join(err, closeErr); err != nil {
		root.Remove(vaultLeaseName)
		return nil, err
	}
	success = true
	return sync.OnceValue(func() error {
		defer db.Close()
		current, err := readWriterLease(root)
		if err != nil {
			return err
		}
		if current.LeaseID != lease.LeaseID {
			return errors.New("writer lease ownership changed")
		}
		return root.Remove(vaultLeaseName)
	}), nil
}

type VaultWriter struct {
	mu      sync.Mutex
	root    *os.Root
	release func() error
}

func (w *VaultWriter) Release() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.release == nil {
		return nil
	}
	release := w.release
	w.release = nil
	return release()
}

func AcquireVaultWriter(root *os.Root) (*VaultWriter, error) {
	deadline := time.Now().Add(2 * time.Second)
	for {
		release, err := tryVaultWriter(root)
		if !errors.Is(err, ErrVaultWriterBusy) || !time.Now().Before(deadline) {
			if err != nil {
				return nil, err
			}
			return &VaultWriter{root: root, release: release}, nil
		}
		time.Sleep(20 * time.Millisecond)
	}
}
