package shell

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestVerifiedBundles(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "harness")
	if e := os.Mkdir(root, 0700); e != nil {
		t.Fatal(e)
	}
	write := func(name string, v any) []byte {
		t.Helper()
		b, e := json.Marshal(v)
		p := filepath.Join(root, name)
		if e == nil {
			e = os.MkdirAll(filepath.Dir(p), 0700)
		}
		if e == nil {
			e = os.WriteFile(p, b, 0600)
		}
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	platform, arch := runtime.GOOS, runtime.GOARCH
	if platform == "windows" {
		platform = "win32"
	}
	if arch == "amd64" {
		arch = "x64"
	}
	files := []settingsObject{}
	add := func(name string, v any) {
		b := write(name, v)
		files = append(files, settingsObject{"path": name, "sha256": fmt.Sprintf("%x", sha256.Sum256(b))})
	}
	for _, n := range []string{"@earendil-works/pi-coding-agent", "pi-skillful", "@juicesharp/rpiv-ask-user-question", "@zigai/pi-mention-skill", "@ff-labs/pi-fff", "cc-safety-net"} {
		add("node_modules/"+n+"/package.json", settingsObject{"name": n, "version": "1.4.0", "license": "MIT", "private": true})
	}
	add("model-catalog.json", settingsObject{"version": 1, "engineVersion": "1.4.0", "models": []any{}})
	add("model-metadata-snapshot.json", settingsObject{"version": 1, "source": "models.dev", "generatedAt": "today", "providers": settingsObject{}})
	manifest := settingsObject{"buildPlatform": platform, "buildArch": arch, "engine": "pi", "engineVersion": "1.4.0", "protocolVersion": 1, "buildId": files[0]["sha256"], "files": files}
	write("runtime-manifest.json", manifest)
	b := NewBundledCapabilities(filepath.Join(dir, "cli.js"))
	caps, e := b.GetBundledCapabilities()
	if e != nil || len(caps["engine"].(settingsObject)) != 3 || len(caps["addons"].([]settingsObject)) != 5 {
		t.Fatal(caps, e)
	}
	if _, e = b.GetModelCatalog(); e != nil {
		t.Fatal(e)
	}
	if _, e = b.GetModelMetadataSnapshot(); e != nil {
		t.Fatal(e)
	}
	write("model-metadata-snapshot.json", nil)
	if _, e = b.GetModelMetadataSnapshot(); e == nil {
		t.Fatal("accepted altered snapshot")
	}
	manifest["buildArch"] = "wrong"
	write("runtime-manifest.json", manifest)
	if _, e = b.GetModelCatalog(); e == nil {
		t.Fatal("accepted wrong architecture")
	}
}
