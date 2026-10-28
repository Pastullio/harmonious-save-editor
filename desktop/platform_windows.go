//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

func defaultRoots() []string {
	return []string{filepath.Join(os.Getenv("APPDATA"), "HelloGames", "NMS")}
}

func appDataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "HarmoniousSaveEditor")
}

func hideWindow(cmd *exec.Cmd) { hidden(cmd) }

// blenderConfigDirs is where Blender keeps per-version settings and extensions.
func blenderConfigDirs() []string {
	return []string{filepath.Join(os.Getenv("APPDATA"), "Blender Foundation", "Blender")}
}

// findBlender looks in the standard install, the Microsoft Store and Steam locations; newest version first.
func findBlender() string {
	var found []string
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
		if base := os.Getenv(env); base != "" {
			m, _ := filepath.Glob(filepath.Join(base, "Blender Foundation", "Blender*", "blender.exe"))
			found = append(found, m...)
			found = append(found, filepath.Join(base, "Steam", "steamapps", "common", "Blender", "blender.exe"))
		}
	}
	if la := os.Getenv("LOCALAPPDATA"); la != "" {
		m, _ := filepath.Glob(filepath.Join(la, "Microsoft", "WindowsApps", "blender*.exe"))
		found = append(found, m...)
	}
	newestFirst(found)
	for _, f := range found {
		if fileExists(f) {
			return f
		}
	}
	if p, err := exec.LookPath("blender"); err == nil {
		return p
	}
	return ""
}

// steamRoots finds Steam's install folder: the registry first, then the usual places.
func steamRoots() []string {
	var roots []string
	if out, err := hidden(exec.Command("reg", "query", `HKCU\Software\Valve\Steam`, "/v", "SteamPath")).Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if i := strings.Index(line, "REG_SZ"); i >= 0 {
				roots = append(roots, filepath.Clean(strings.TrimSpace(line[i+len("REG_SZ"):])))
			}
		}
	}
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles"} {
		if base := os.Getenv(env); base != "" {
			roots = append(roots, filepath.Join(base, "Steam"))
		}
	}
	return roots
}

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return cmd
}

// openWindow opens the editor in an Edge (always present on Windows 10/11) or Chrome app window,
// with its own profile so it doesn't mix with the user's browsing. Falls back to the default browser.
func openWindow(url, profile string) error {
	var candidates []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		candidates = append(candidates,
			filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
	}
	for _, exe := range candidates {
		if _, err := os.Stat(exe); err != nil {
			continue
		}
		cmd := exec.Command(exe, "--app="+url, "--user-data-dir="+profile, "--window-size=1440,920",
			"--no-first-run", "--no-default-browser-check", "--disable-features=Translate")
		if err := cmd.Start(); err == nil {
			go cmd.Wait()
			return nil
		}
	}
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func gameRunning() bool {
	out, err := hidden(exec.Command("tasklist", "/FI", "IMAGENAME eq NMS.exe", "/NH")).Output()
	return err == nil && strings.Contains(strings.ToLower(string(out)), "nms.exe")
}

func reveal(path string) error {
	if path == "" {
		return errors.New("no folder")
	}
	_ = os.MkdirAll(path, 0o755)
	return exec.Command("explorer", path).Start() // explorer returns exit code 1 even on success
}

func fatal(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString("Harmonious Save Editor")
	m, _ := syscall.UTF16PtrFromString(msg)
	box.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10) // MB_ICONERROR
	os.Exit(1)
}
