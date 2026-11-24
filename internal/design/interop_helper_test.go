package design

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

// TestDesignLockInteropHelper is only invoked by cross-process Node lock.ts tests
// via a compiled test binary; production cmd/molly-core never exposes lock probes.
func TestDesignLockInteropHelper(t *testing.T) {
	if os.Getenv("MOLLY_DESIGN_INTEROP_HELPER") != "1" {
		return
	}
	var in struct {
		Action    string `json:"action"`
		Directory string `json:"directory"`
		TimeoutMs int    `json:"timeoutMs"`
		StaleMs   int    `json:"staleMs"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		t.Fatalf("decode helper input: %v", err)
	}
	timing := LockTiming{}
	if in.TimeoutMs > 0 {
		timing.Timeout = time.Duration(in.TimeoutMs) * time.Millisecond
	}
	if in.StaleMs > 0 {
		timing.Stale = time.Duration(in.StaleMs) * time.Millisecond
	}
	switch in.Action {
	case "lock_probe":
		_, err := WithDesignLock(context.Background(), in.Directory, timing, func(assertHeld func() error) (struct{}, error) {
			return struct{}{}, assertHeld()
		})
		if err != nil {
			t.Fatalf("LOCK_ERR:%s", err.Error())
		}
	default:
		t.Fatalf("unknown action %q", in.Action)
	}
}
