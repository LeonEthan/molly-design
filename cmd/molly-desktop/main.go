package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"github.com/LeonEthan/molly-design/internal/platform"
	"github.com/LeonEthan/molly-design/internal/shell"
)

var desktopVersion = "0.2.0-mygo-experimental"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("molly-desktop", flag.ContinueOnError)
	fs.SetOutput(stderr)

	showVersion := fs.Bool("version", false, "print molly-desktop version and exit")
	checkLocal := fs.Bool("check-local-composition", false, "print local-only composition JSON and exit")
	selfTestG5 := fs.Bool("self-test-g5", false, "run live MyGo G5 protocol and bridge security self-test")
	selfTestG3Sample := fs.String("self-test-g3-sample", "", "path to Bento sample.json for G3 offscreen render test")
	selfTestG3Out := fs.String("self-test-g3-out", "", "output PNG path for G3 offscreen render test")
	selfTestRenderer := fs.String("self-test-renderer", "", "renderer dist directory for live React workbench self-test")
	rendererDir := fs.String("renderer-dir", "", "path to built renderer assets (index.html + assets/)")
	designDir := fs.String("design-dir", "", "path to verified Bento design resources (editor.html + build.json)")
	dataDir := fs.String("data-dir", "", "override Molly data directory")

	if err := fs.Parse(args); err != nil {
		return 2
	}

	if *showVersion {
		_, _ = fmt.Fprintf(stdout, "molly-desktop %s (%s/%s)\n", desktopVersion, runtime.GOOS, runtime.GOARCH)
		return 0
	}

	if *checkLocal {
		comp := platform.DefaultComposition()
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(map[string]any{
			"name":        "molly-desktop",
			"version":     desktopVersion,
			"goos":        runtime.GOOS,
			"goarch":      runtime.GOARCH,
			"composition": comp,
		}); err != nil {
			_, _ = fmt.Fprintf(stderr, "encode composition: %v\n", err)
			return 1
		}
		return 0
	}

	if *selfTestG5 {
		report, err := shell.RunSelfTestG5()
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(report)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "self-test-g5 failed: %v\n", err)
			return 1
		}
		return 0
	}

	if *selfTestG3Sample != "" {
		dDir := *designDir
		if dDir == "" {
			dDir = filepath.Dir(*selfTestG3Sample)
		}
		outPath := *selfTestG3Out
		if outPath == "" {
			_, _ = fmt.Fprintln(stderr, "--self-test-g3-out is required with --self-test-g3-sample")
			return 2
		}
		report, err := shell.RunSelfTestG3(dDir, *selfTestG3Sample, outPath)
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(report)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "self-test-g3 failed: %v\n", err)
			return 1
		}
		return 0
	}

	if *selfTestRenderer != "" {
		report, err := shell.RunSelfTestRenderer(*selfTestRenderer)
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(report)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "self-test-renderer failed: %v\n", err)
			return 1
		}
		return 0
	}

	rDir := *rendererDir
	if rDir == "" {
		if exe, err := os.Executable(); err == nil {
			candidate := filepath.Join(filepath.Dir(exe), "..", "Resources", "renderer")
			if _, statErr := os.Stat(filepath.Join(candidate, "index.html")); statErr == nil {
				rDir = candidate
			}
		}
	}
	if rDir == "" {
		rDir = filepath.Join("apps", "electron", "out", "renderer")
	}

	dDir := *designDir
	if dDir == "" {
		if exe, err := os.Executable(); err == nil {
			candidate := filepath.Join(filepath.Dir(exe), "..", "Resources", "design")
			if _, statErr := os.Stat(filepath.Join(candidate, "editor.html")); statErr == nil {
				dDir = candidate
			}
		}
	}
	if dDir == "" {
		candidate := filepath.Join("apps", "electron", "resources", "design")
		if _, statErr := os.Stat(filepath.Join(candidate, "editor.html")); statErr == nil {
			dDir = candidate
		}
	}

	if err := shell.RunDesktop(shell.DesktopOptions{
		RendererDir: rDir,
		DesignDir:   dDir,
		DataDir:     *dataDir,
		AppVersion:  desktopVersion,
	}); err != nil {
		_, _ = fmt.Fprintf(stderr, "molly-desktop failed: %v\n", err)
		return 1
	}
	return 0
}
