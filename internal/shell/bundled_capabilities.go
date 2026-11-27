package shell

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"unicode/utf8"

	"github.com/LeonEthan/molly-design/internal/security"
)

type BundledCapabilities struct{ cliEntry string }

func NewBundledCapabilities(cliEntry string) *BundledCapabilities {
	return &BundledCapabilities{cliEntry}
}

type runtimeResources struct {
	Engine, EngineVersion, BuildId, BuildPlatform, BuildArch string
	ProtocolVersion                                          int
	Files                                                    []struct{ Path, Sha256 string }
}

func (b *BundledCapabilities) open() (*os.Root, runtimeResources, error) {
	var m runtimeResources
	invalid := os.ErrInvalid
	if b.cliEntry == "" {
		return nil, m, invalid
	}
	root, e := os.OpenRoot(filepath.Join(filepath.Dir(b.cliEntry), "harness"))
	if e != nil {
		return nil, m, e
	}
	raw, e := security.ReadBoundedFileFromRoot(root, "runtime-manifest.json", 8<<20)
	platform, arch := runtime.GOOS, runtime.GOARCH
	if platform == "windows" {
		platform = "win32"
	}
	if arch == "amd64" {
		arch = "x64"
	}
	if e != nil || json.Unmarshal(raw, &m) != nil || m.Engine != "pi" || m.EngineVersion != "1.4.0" || m.ProtocolVersion != 1 || !validBundleDigest(m.BuildId) || m.BuildPlatform != platform || m.BuildArch != arch || m.Files == nil || len(m.Files) > 50000 {
		root.Close()
		return nil, m, invalid
	}
	for _, f := range m.Files {
		if !validBundleDigest(f.Sha256) || len(f.Path) > 4096 {
			root.Close()
			return nil, m, invalid
		}
	}
	return root, m, nil
}

func validBundleDigest(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && hex.EncodeToString(b) == s
}

func (m runtimeResources) read(root *os.Root, name string, limit int64) (map[string]any, error) {
	digest := ""
	for _, f := range m.Files {
		if f.Path == name {
			if digest != "" {
				return nil, os.ErrInvalid
			}
			digest = f.Sha256
		}
	}
	if digest == "" {
		return nil, os.ErrInvalid
	}
	raw, e := security.ReadBoundedFileFromRoot(root, name, limit)
	if e != nil || fmt.Sprintf("%x", sha256.Sum256(raw)) != digest {
		return nil, os.ErrInvalid
	}
	var data map[string]any
	e = json.Unmarshal(raw, &data)
	return data, e
}

func boundedString(v any, limit int) bool {
	s, ok := v.(string)
	return ok && s != "" && utf8.RuneCountInString(s) <= limit
}

func (b *BundledCapabilities) GetBundledCapabilities() (map[string]any, error) {
	bad := errors.New("bundled_capabilities_unavailable")
	root, m, e := b.open()
	if e != nil {
		return nil, bad
	}
	defer root.Close()
	result := map[string]any{"harness": map[string]any{"id": "molly", "engine": "pi", "engineVersion": m.EngineVersion, "buildId": m.BuildId, "protocolVersion": 1}}
	addons := []map[string]any{}
	for i, name := range []string{"@earendil-works/pi-coding-agent", "pi-skillful", "@juicesharp/rpiv-ask-user-question", "@zigai/pi-mention-skill", "@ff-labs/pi-fff", "cc-safety-net"} {
		p, e := m.read(root, "node_modules/"+name+"/package.json", 256<<10)
		if e != nil || p["name"] != name || !boundedString(p["license"], 100) || !boundedString(p["version"], 100) {
			return nil, bad
		}
		v := map[string]any{"name": name, "version": p["version"], "license": p["license"]}
		if i == 0 {
			if v["version"] != m.EngineVersion {
				return nil, bad
			}
			result["engine"] = v
		} else {
			addons = append(addons, v)
		}
	}
	result["addons"] = addons
	return result, nil
}

func (b *BundledCapabilities) verifiedJSON(name string) (map[string]any, error) {
	r, m, e := b.open()
	if e != nil {
		return nil, e
	}
	defer r.Close()
	return m.read(r, name, 16<<20)
}

func enumString(v any, options ...string) bool {
	s, ok := v.(string)
	return ok && slices.Contains(options, s)
}

func providerPreset(v any) bool {
	return enumString(v, "openai", "anthropic", "google", "xai", "deepseek", "moonshot", "kimi-coding", "zai", "minimax", "openrouter", "openai-compatible")
}

func positiveNumber(v any, max float64) bool {
	n, ok := v.(float64)
	return ok && n >= 1 && n <= max && float64(int64(n)) == n
}

func (b *BundledCapabilities) GetModelCatalog() (map[string]any, error) {
	bad := errors.New("bundled_model_catalog_unavailable")
	d, e := b.verifiedJSON("model-catalog.json")
	models, ok := d["models"].([]any)
	if e != nil || !ok || len(models) > 10000 || len(d) != 3 || d["version"] != float64(1) || d["engineVersion"] != "1.4.0" {
		return nil, bad
	}
	for _, v := range models {
		m, _ := v.(map[string]any)
		input, ok := m["input"].([]any)
		thinking, t := m["thinking"].([]any)
		if len(m) != 6 || !ok || !t || len(thinking) == 0 || !providerPreset(m["providerPresetId"]) || !boundedString(m["modelId"], 200) || !boundedString(m["name"], 300) || !positiveNumber(m["contextWindow"], 1<<53) {
			return nil, bad
		}
		for _, v := range input {
			if !enumString(v, "text", "image") {
				return nil, bad
			}
		}
		for _, v := range thinking {
			if !enumString(v, "off", "minimal", "low", "medium", "high", "xhigh", "max") {
				return nil, bad
			}
		}
	}
	return d, nil
}

func (b *BundledCapabilities) GetModelMetadataSnapshot() (map[string]any, error) {
	bad := errors.New("bundled_model_metadata_unavailable")
	d, e := b.verifiedJSON("model-metadata-snapshot.json")
	p, ok := d["providers"].(map[string]any)
	if e != nil || !ok || len(d) != 4 || d["version"] != float64(1) || d["source"] != "models.dev" || !boundedString(d["generatedAt"], 40) {
		return nil, bad
	}
	for id, v := range p {
		provider, _ := v.(map[string]any)
		models, ok := provider["models"].(map[string]any)
		if !boundedString(id, 100) || !ok {
			return nil, bad
		}
		p[id] = map[string]any{"models": models}
		for id, v := range models {
			model, ok := v.(map[string]any)
			if !boundedString(id, 200) || !ok {
				return nil, bad
			}
			for k, val := range model {
				switch k {
				case "name":
					ok = boundedString(val, 300)
				case "contextWindow", "maxTokens":
					ok = positiveNumber(val, 16777216)
				case "imageInput", "toolCalls", "reasoning":
					_, ok = val.(bool)
				default:
					ok = false
				}
				if !ok {
					return nil, bad
				}
			}
		}
	}
	return d, nil
}
