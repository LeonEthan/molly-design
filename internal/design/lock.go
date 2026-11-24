package design

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	LockFilename       = ".design.lock"
	DefaultLockTimeout = 10 * time.Second
	DefaultLockStale   = 45 * time.Second
	DefaultLockRetry   = 25 * time.Millisecond
)

var (
	ErrDesignBusy     = errors.New("DESIGN_BUSY")
	ErrDesignConflict = errors.New("DESIGN_CONFLICT")
)

type LockTiming struct {
	Now     func() time.Time
	Sleep   func(ctx context.Context, d time.Duration) error
	Timeout time.Duration
	Stale   time.Duration
	Retry   time.Duration
}

type lockFilePayload struct {
	PID   int    `json:"pid"`
	Token string `json:"token"`
}

func WithDesignLock[T any](
	ctx context.Context,
	directory string,
	timing LockTiming,
	work func(assertHeld func() error) (T, error),
) (T, error) {
	var zero T
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	nowFn := timing.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	sleepFn := timing.Sleep
	if sleepFn == nil {
		sleepFn = defaultLockSleep
	}
	timeout := timing.Timeout
	if timeout <= 0 {
		timeout = DefaultLockTimeout
	}
	stale := timing.Stale
	if stale <= 0 {
		stale = DefaultLockStale
	}
	retry := timing.Retry
	if retry <= 0 {
		retry = DefaultLockRetry
	}

	lockPath := filepath.Join(directory, LockFilename)
	token := newUUID()
	deadline := nowFn().Add(timeout)

	for {
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		created, err := tryCreateLock(lockPath, token)
		if err != nil {
			return zero, err
		}
		if created {
			break
		}
		if _, stealErr := stealStaleLock(lockPath, nowFn, stale); stealErr != nil {
			return zero, stealErr
		}
		if !nowFn().Before(deadline) {
			return zero, ErrDesignBusy
		}
		if err := sleepFn(ctx, retry); err != nil {
			return zero, err
		}
	}

	assertHeld := func() error {
		if readLockToken(lockPath) != token {
			return ErrDesignBusy
		}
		return nil
	}

	defer releaseLock(lockPath, token)
	return work(assertHeld)
}

func tryCreateLock(lockPath string, token string) (bool, error) {
	f, err := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return false, nil
		}
		return false, err
	}
	payload, marshalErr := json.Marshal(lockFilePayload{
		PID:   os.Getpid(),
		Token: token,
	})
	if marshalErr != nil {
		_ = f.Close()
		_ = os.Remove(lockPath)
		return false, marshalErr
	}
	if _, writeErr := f.Write(payload); writeErr != nil {
		_ = f.Close()
		_ = os.Remove(lockPath)
		return false, writeErr
	}
	if syncErr := f.Sync(); syncErr != nil {
		_ = f.Close()
		_ = os.Remove(lockPath)
		return false, syncErr
	}
	if closeErr := f.Close(); closeErr != nil {
		return false, closeErr
	}
	return true, nil
}

func stealStaleLock(lockPath string, nowFn func() time.Time, stale time.Duration) (bool, error) {
	info, err := os.Lstat(lockPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if nowFn().Sub(info.ModTime()) < stale {
		return false, nil
	}
	aside := fmt.Sprintf("%s.%s.stale", lockPath, newUUID())
	if err := os.Rename(lockPath, aside); err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	_ = os.Remove(aside)
	return true, nil
}

func readLockToken(lockPath string) string {
	raw, err := os.ReadFile(lockPath)
	if err != nil {
		return ""
	}
	var parsed struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ""
	}
	return parsed.Token
}

func releaseLock(lockPath string, token string) {
	if readLockToken(lockPath) != token {
		return
	}
	_ = os.Remove(lockPath)
}

func defaultLockSleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
