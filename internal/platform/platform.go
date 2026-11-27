package platform

import "errors"

var ErrCloudUnavailable = errors.New("cloud capability is unavailable in local-only OSS composition")

type Capability string

type Capabilities struct {
	LocalOnly        bool         `json:"localOnly"`
	TelemetryEnabled bool         `json:"telemetryEnabled"`
	Cloud            []Capability `json:"cloud"`
}

type Composition struct {
	Mode         string       `json:"mode"`
	Capabilities Capabilities `json:"capabilities"`
}

func (c Composition) HasCloudCapability(cap Capability) bool {
	for _, item := range c.Capabilities.Cloud {
		if item == cap {
			return true
		}
	}
	return false
}

func (c Composition) RequireCloudCapability(cap Capability) error {
	if c.HasCloudCapability(cap) {
		return nil
	}
	return ErrCloudUnavailable
}
