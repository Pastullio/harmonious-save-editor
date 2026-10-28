//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func defaultRoots() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return []string{filepath.Join(home, "Library", "Application Support", "HelloGames", "NMS")}
	}
	// Steam Deck / Linux under Proton
	return []string{filepath.Join(home, ".local", "share", "Steam", "steamapps", "compatdata", "275850", "pfx",
		"drive_c", "users", "steamuser", "Application Data", "HelloGames", "NMS")}
}

func appDataDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "HarmoniousSaveEditor")
}

func openWindow(url, profile string) error {
	for _, exe := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"} {
		if p, err := exec.LookPath(exe); err == nil {
			if exec.Command(p, "--app="+url, "--user-data-dir="+profile, "--window-size=1440,920", "--no-first-run").Start() == nil {
				return nil
			}
		}
	}
	if runtime.GOOS == "darwin" {
		return exec.Command("open", url).Start()
	}
	return exec.Command("xdg-open", url).Start()
}

func gameRunning() bool { return exec.Command("pgrep", "-f", "NMS.exe").Run() == nil }

func reveal(path string) error {
	_ = os.MkdirAll(path, 0o755)
	if runtime.GOOS == "darwin" {
		return exec.Command("open", path).Start()
	}
	return exec.Command("xdg-open", path).Start()
}

func fatal(msg string) { fmt.Fprintln(os.Stderr, msg); os.Exit(1) }
