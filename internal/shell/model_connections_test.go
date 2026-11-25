package shell

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

type fixtureSettingsKey struct{}

func (fixtureSettingsKey) LoadOrCreateMasterKey() ([]byte, error) {
	return bytes.Repeat([]byte{5}, 32), nil
}

type settingsTransport func(*http.Request) (*http.Response, error)

func (f settingsTransport) RoundTrip(q *http.Request) (*http.Response, error) { return f(q) }
func TestExperimentalSettings(t *testing.T) {
	dir := settingsTestDir(t)
	var events int
	transport := settingsTransport(func(q *http.Request) (*http.Response, error) {
		if q.URL.String() != "https://example.org/v1/models" || q.Header.Get("Authorization") != "Bearer private-key" {
			t.Fatal("incorrect credential destination")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[{"id":"example"}]}`))}, nil
	})
	s, e := NewModelConnectionsService(dir, "workspace", fixtureSettingsKey{}, transport, func() { events++ })
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	for _, tc := range []struct {
		name     string
		save     func(settingsObject) (settingsObject, error)
		snapshot func() (settingsObject, error)
		del      func(settingsObject) error
		q        settingsObject
	}{{"model", s.Save, s.GetSnapshot, s.Delete, settingsObject{"enabled": true, "baseUrl": "https://example.org/v1", "providerPresetId": "openai", "displayName": "Local", "apiKey": "private-key"}}, {"image", s.SaveImage, s.GetImageSnapshot, s.DeleteImage, settingsObject{"enabled": true, "baseUrl": "https://example.org/v1", "model": "image", "apiKey": "private-key"}}, {"mcp", s.SaveMcp, s.GetMcpSnapshot, s.DeleteMcp, settingsObject{"serverId": "server", "destination": settingsObject{"transport": "http", "url": "https://example.org"}, "values": settingsObject{"Authorization": "private-key"}}}} {
		t.Run(tc.name, func(t *testing.T) {
			before := events
			c, e := tc.save(tc.q)
			if e != nil {
				t.Fatal(e)
			}
			snap, e := tc.snapshot()
			raw, _ := json.Marshal(snap)
			if e != nil || bytes.Contains(raw, []byte("private-key")) || !bytes.Contains(raw, []byte("revision")) {
				t.Fatal("invalid snapshot", e)
			}
			selector := settingsObject{}
			if tc.name == "model" {
				selector["id"] = c["id"]
				tc.q["id"] = c["id"]
			}
			if tc.name == "mcp" {
				selector["serverId"] = "server"
			}
			if tc.name == "image" {
				check, e := s.CheckImage(settingsObject{"baseUrl": "https://example.org/v1", "expectedRevision": 1})
				if e != nil || check["ok"] != true || check["models"].([]string)[0] != "example" {
					t.Fatal(check, e)
				}
			}
			tc.q["expectedRevision"] = 99
			if _, e = tc.save(tc.q); e == nil {
				t.Fatal("accepted stale save")
			}
			selector["expectedRevision"] = 99
			if e = tc.del(selector); e == nil {
				t.Fatal("accepted stale delete")
			}
			tc.q["expectedRevision"] = 1
			delete(tc.q, "apiKey")
			delete(tc.q, "values")
			c, e = tc.save(tc.q)
			if e != nil || c["revision"] != float64(2) {
				t.Fatal(c, e)
			}
			selector["expectedRevision"] = 2
			if e = tc.del(selector); e != nil {
				t.Fatal(e)
			}
			snap, e = tc.snapshot()
			raw, _ = json.Marshal(snap)
			if e != nil || bytes.Contains(raw, []byte("revision")) || events-before != 3 {
				t.Fatal("unexpected final state", events, e)
			}
		})
	}
}

type pausedSettingsKey struct{ started, resume chan struct{} }

func (k pausedSettingsKey) LoadOrCreateMasterKey() ([]byte, error) {
	close(k.started)
	<-k.resume
	return fixtureSettingsKey{}.LoadOrCreateMasterKey()
}
func TestSettingsCrossProcessLock(t *testing.T) {
	if dir := os.Getenv("MOLLY_TEST_SETTINGS_LOCK_DIR"); dir != "" {
		s, e := NewModelConnectionsService(dir, "ws", fixtureSettingsKey{}, nil, nil)
		if e != nil {
			t.Fatal(e)
		}
		defer s.Close()
		_, e = s.SaveImage(settingsObject{})
		if !errors.Is(e, os.ErrExist) {
			t.Fatal(e)
		}
		return
	}
	dir := settingsTestDir(t)
	key := pausedSettingsKey{make(chan struct{}), make(chan struct{})}
	s, e := NewModelConnectionsService(dir, "ws", key, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	done := make(chan error, 1)
	go func() {
		_, err := s.SaveImage(settingsObject{"enabled": true, "model": "image", "baseUrl": "https://example.org", "apiKey": "fixture"})
		done <- err
	}()
	select {
	case <-key.started:
	case err := <-done:
		t.Fatalf("writer failed to enter transaction: %v", err)
	}
	defer func() {
		close(key.resume)
		if e := <-done; e != nil {
			t.Error(e)
		}
	}()
	cmd := exec.Command(os.Args[0], "-test.run=^TestSettingsCrossProcessLock$")
	cmd.Env = append(os.Environ(), "MOLLY_TEST_SETTINGS_LOCK_DIR="+dir)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatal(string(b), e)
	}
}

func settingsTestDir(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		return t.TempDir()
	}
	dir, e := os.MkdirTemp("/tmp", "ms-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

type crashSettingsKey struct{}

func (crashSettingsKey) LoadOrCreateMasterKey() ([]byte, error) { os.Exit(71); return nil, nil }
func TestSettingsCrashUnlock(t *testing.T) {
	q := settingsObject{"enabled": true, "model": "image", "baseUrl": "https://example.org", "apiKey": "fixture"}
	if dir := os.Getenv("MOLLY_TEST_CRASH_LOCK_DIR"); dir != "" {
		s, e := NewModelConnectionsService(dir, "ws", crashSettingsKey{}, nil, nil)
		if e != nil {
			t.Fatal(e)
		}
		_, e = s.SaveImage(q)
		t.Fatalf("writer did not exit: %v", e)
	}
	dir := settingsTestDir(t)
	cmd := exec.Command(os.Args[0], "-test.run=^TestSettingsCrashUnlock$")
	cmd.Env = append(os.Environ(), "MOLLY_TEST_CRASH_LOCK_DIR="+dir)
	var exit *exec.ExitError
	if err := cmd.Run(); !errors.As(err, &exit) || exit.ExitCode() != 71 {
		t.Fatal(err)
	}
	s, e := NewModelConnectionsService(dir, "ws", fixtureSettingsKey{}, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if _, e = s.SaveImage(q); e != nil {
		t.Fatal(e)
	}
	if e = s.DeleteImage(settingsObject{"expectedRevision": 1}); e != nil {
		t.Fatal(e)
	}
}
