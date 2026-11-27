//go:build !cloud

package platform

func DefaultComposition() Composition {
	return Composition{
		Mode: "local",
		Capabilities: Capabilities{
			LocalOnly:        true,
			TelemetryEnabled: false,
			Cloud:            []Capability{},
		},
	}
}
