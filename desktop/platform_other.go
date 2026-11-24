//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

func defaultRoots() []string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		// Steam's copy of the game keeps saves in the user's Library; a copy from the Mac App Store is sandboxed, so
		// its Library sits inside its own container
		roots := []string{filepath.Join(home, "Library", "Application Support", "HelloGames", "NMS")}
		boxed, _ := filepath.Glob(filepath.Join(home, "Library", "Containers", "*", "Data", "Library", "Application Support", "HelloGames", "NMS"))
		return append(roots, boxed...)
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

// macApps finds an app's program in the usual Applications folders.
func macApps(names ...string) []string {
	home, _ := os.UserHomeDir()
	var out []string
	for _, n := range names {
		for _, dir := range []string{"/Applications", filepath.Join(home, "Applications")} {
			out = append(out, filepath.Join(dir, n+".app", "Contents", "MacOS", n))
		}
	}
	return out
}

func macBrowsers() []string {
	return macApps("Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium")
}

func openWindow(url, profile string) error {
	exes := []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"}
	if runtime.GOOS == "darwin" {
		// a Chrome-family browser gives the editor a window of its own; without one the default browser opens it
		exes = macBrowsers()
	}
	for _, exe := range exes {
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
	cands := []string{"blender", "/snap/bin/blender"}
	if runtime.GOOS == "darwin" {
		cands = append(macApps("Blender"), "blender")
		home, _ := os.UserHomeDir()
		for _, dir := range []string{"/Applications", filepath.Join(home, "Applications")} { // "Blender 4.5.app" and the like, newest name first
			more, _ := filepath.Glob(filepath.Join(dir, "Blender*.app", "Contents", "MacOS", "Blender"))
			for i := len(more) - 1; i >= 0; i-- {
				cands = append(cands, more[i])
			}
		}
		for _, lib := range steamLibraries() {
			cands = append(cands, filepath.Join(lib, "steamapps", "common", "Blender", "Blender.app", "Contents", "MacOS", "Blender"))
		}
	}
	for _, c := range cands {
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

func gameRunning() bool {
	if runtime.GOOS == "darwin" {
		return exec.Command("pgrep", "-f", "No Man's Sky.app/Contents/MacOS").Run() == nil
	}
	return exec.Command("pgrep", "-f", "NMS.exe").Run() == nil
}

// extraGameFolders: places beside the Steam libraries where the game may be. On a Mac the App Store's copy (and a
// copy dragged out of Steam's folder) is an app in an Applications folder.
func extraGameFolders() []string {
	if runtime.GOOS != "darwin" {
		return nil
	}
	home, _ := os.UserHomeDir()
	return []string{"/Applications/No Man's Sky.app", filepath.Join(home, "Applications", "No Man's Sky.app"), "/Applications", filepath.Join(home, "Applications")}
}

func reveal(path string) error {
	_ = os.MkdirAll(path, 0o755)
	if runtime.GOOS == "darwin" {
		return exec.Command("open", path).Start()
	}
	return exec.Command("xdg-open", path).Start()
}

func fatal(msg string) { fmt.Fprintln(os.Stderr, msg); os.Exit(1) }

func revealFile(path string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-R", path).Start() // shows the file selected in Finder
	}
	return reveal(filepath.Dir(path))
}

// macChoose shows Finder's own chooser through AppleScript and returns the POSIX path, or "" when cancelled.
func macChoose(what, title, startDir string, types []string) (string, error) {
	q := func(s string) string { return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"` }
	script := "choose " + what + " with prompt " + q(title)
	if len(types) > 0 {
		for i := range types {
			types[i] = q(types[i])
		}
		script += " of type {" + strings.Join(types, ", ") + "}"
	}
	if st, err := os.Stat(startDir); err == nil && st.IsDir() {
		script += " default location (POSIX file " + q(startDir) + ")"
	}
	out, err := exec.Command("osascript", "-e", "POSIX path of ("+script+")").CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "-128") || strings.Contains(strings.ToLower(string(out)), "cancel") {
			return "", nil
		}
		return "", fmt.Errorf("the chooser couldn't be opened: %s", strings.TrimSpace(string(out)))
	}
	return strings.TrimRight(strings.TrimSpace(string(out)), "/"), nil
}

var pickExtRe = regexp.MustCompile(`\*\.([A-Za-z0-9]+)`)

// pickFile: tests set HSE_PICK_FILE to the answer; elsewhere it needs the Windows app
func pickFile(title, filter, startDir string) (string, error) {
	if f, ok := os.LookupEnv("HSE_PICK_FILE"); ok {
		return f, nil
	}
	if runtime.GOOS == "darwin" {
		var types []string // the Windows filter "Blender files (*.blend)|*.blend" names the extensions
		if i := strings.LastIndex(filter, "|"); i >= 0 {
			for _, m := range pickExtRe.FindAllStringSubmatch(filter[i+1:], -1) {
				types = append(types, m[1])
			}
		}
		return macChoose("file", title, startDir, types)
	}
	return "", fmt.Errorf("choosing a file needs the Windows or Mac app")
}

func pickFolder(title string) (string, error) {
	if runtime.GOOS == "darwin" {
		return macChoose("folder", title, "", nil)
	}
	return "", fmt.Errorf("choosing a folder needs the Windows or Mac app; type the folder's path instead")
}

// the editor's own window is Windows only for now; elsewhere the browser window is used
func nativeWindow(url string) bool { return false }
func focusNativeWindow() bool      { return false }
func allowFocusSteal()             {}

// openBrowser opens a web page in the default browser (HSE_OPEN_LOG: tests write the address there instead)
func openBrowser(url string) error {
	if f := os.Getenv("HSE_OPEN_LOG"); f != "" {
		return os.WriteFile(f, []byte(url), 0o644)
	}
	if runtime.GOOS == "darwin" {
		return exec.Command("open", url).Start()
	}
	return exec.Command("xdg-open", url).Start()
}
