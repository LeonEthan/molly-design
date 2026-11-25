package shell

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

func e2eMode() bool {
	v, ok := os.LookupEnv("MOLLY_E2E")
	if !ok {
		v = os.Getenv("LODY_E2E")
	}
	return v == "1"
}

func dataDirectoryScope(dir string) (string, int, error) {
	canonical, err := canonicalDirectory(dir)
	if err != nil {
		return "", 0, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", 0, err
	}
	for _, name := range []string{".molly", ".molly-preview", ".lody"} {
		p, err := canonicalDirectory(filepath.Join(home, name))
		if err != nil {
			return "", 0, err
		}
		if p == canonical {
			return "", 0, nil
		}
	}
	scope, port := canonicalEndpoints(canonical)
	return scope, port, nil
}

func holdTCPLease(o *ownership, instance string) error {
	_, port, err := dataDirectoryScope(o.root.Name())
	if err != nil {
		return err
	}
	raw, set := os.LookupEnv("MOLLY_LOCAL_CLI_HOST_PORT")
	if e2eMode() {
		port = 17792
		if installationNamespace() == "molly-preview" {
			port = 17794
		}
		raw = os.Getenv("MOLLY_E2E_LOCAL_CLI_HOST_PORT")
		if raw == "" {
			raw = os.Getenv("LODY_E2E_LOCAL_CLI_HOST_PORT")
		}
		set = raw != ""
	}
	if set {
		port, err = strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return errors.New("invalid_local_cli_host_port")
		}
	}
	ln, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return err
	}
	record, _ := json.Marshal(map[string]any{"version": 1, "instanceId": instance, "pid": os.Getpid(), "mode": "electron", "startedAtMs": time.Now().UnixMilli()})
	o.release = append(o.release, func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(time.Second))
			conn.Write(append(record, '\n'))
			conn.Close()
		}
	}()
	return nil
}
