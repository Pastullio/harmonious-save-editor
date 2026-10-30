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

func hideWindow(cmd *exec.Cmd) {}

func blenderConfigDirs() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return []string{filepath.Join(home, "Library", "Application Support", "Blender")}
	}
	return []string{filepath.Join(home, ".config", "blender")}
}

func findBlender() string {
	if p := os.Getenv("HSE_BLENDER"); p != "" {
		return p
	}
	for _, c := range []string{"blender", "/Applications/Blender.app/Contents/MacOS/Blender", "/snap/bin/blender"} {
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return ""
}

func steamRoots() []string {
	if p := os.Getenv("HSE_STEAM"); p != "" {
		return []string{p}
	}
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return []string{filepath.Join(home, "Library", "Application Support", "Steam")}
	}
	return []string{filepath.Join(home, ".steam", "steam"), filepath.Join(home, ".local", "share", "Steam")}
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

func revealFile(path string) error { return reveal(filepath.Dir(path)) }

// pickFile: tests set HSE_PICK_FILE to the answer; elsewhere it needs the Windows app
func pickFile(title, filter, startDir string) (string, error) {
	if f, ok := os.LookupEnv("HSE_PICK_FILE"); ok {
		return f, nil
	}
	return "", fmt.Errorf("choosing a file needs the Windows app")
}

func pickFolder(title string) (string, error) {
	return "", fmt.Errorf("choosing a folder needs the Windows app; type the folder's path instead")
}
