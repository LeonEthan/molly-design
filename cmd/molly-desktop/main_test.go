package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestCheckLocalCompositionOutput(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"--check-local-composition"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	var payload struct {
		Name        string `json:"name"`
		Version     string `json:"version"`
		Composition struct {
			Mode         string `json:"mode"`
			Capabilities struct {
				LocalOnly        bool  `json:"localOnly"`
				TelemetryEnabled bool  `json:"telemetryEnabled"`
				Cloud            []any `json:"cloud"`
			} `json:"capabilities"`
		} `json:"composition"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if payload.Name != "molly-desktop" || payload.Composition.Mode != "local" || !payload.Composition.Capabilities.LocalOnly || payload.Composition.Capabilities.TelemetryEnabled || len(payload.Composition.Capabilities.Cloud) != 0 {
		t.Fatalf("unexpected local composition payload: %+v", payload)
	}
}

func TestVersionFlag(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"--version"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	if !strings.HasPrefix(stdout.String(), "molly-desktop ") {
		t.Fatalf("unexpected version output: %q", stdout.String())
	}
}
