package platform

import (
	"errors"
	"testing"
)

func TestDefaultCompositionIsLocalOnly(t *testing.T) {
	comp := DefaultComposition()
	if comp.Mode != "local" {
		t.Fatalf("expected mode local, got %q", comp.Mode)
	}
	if !comp.Capabilities.LocalOnly {
		t.Fatalf("expected LocalOnly=true")
	}
	if comp.Capabilities.TelemetryEnabled {
		t.Fatalf("expected TelemetryEnabled=false")
	}
	if len(comp.Capabilities.Cloud) != 0 {
		t.Fatalf("expected empty cloud capabilities, got %v", comp.Capabilities.Cloud)
	}
	if comp.HasCloudCapability("sync") {
		t.Fatalf("expected HasCloudCapability(sync)=false")
	}
	if err := comp.RequireCloudCapability("sync"); !errors.Is(err, ErrCloudUnavailable) {
		t.Fatalf("expected ErrCloudUnavailable, got %v", err)
	}
}
