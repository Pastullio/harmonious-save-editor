//go:build windows

package main

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// windowPlacement centres the editor's window on the main screen's work area (the screen minus the taskbar),
// shrinking it on small screens. The app isn't DPI-aware, so Windows hands back scaled sizes, which is what
// Edge and Chrome expect for --window-size and --window-position.
func windowPlacement() []string {
	const w0, h0 = 1440, 920
	var r struct{ Left, Top, Right, Bottom int32 }
	spi := syscall.NewLazyDLL("user32.dll").NewProc("SystemParametersInfoW")
	if ok, _, _ := spi.Call(0x0030 /* SPI_GETWORKAREA */, 0, uintptr(unsafe.Pointer(&r)), 0); ok == 0 || r.Right-r.Left < 400 || r.Bottom-r.Top < 300 {
		return []string{"--window-size=1440,920"}
	}
	// once the process is DPI aware (the editor's own window was tried first) the work area is in real pixels,
	// while Edge takes 100 % pixels: scale back
	dpi := callIf(syscall.NewLazyDLL("user32.dll").NewProc("GetDpiForSystem"))
	if dpi == 0 {
		dpi = 96
	}
	for _, v := range []*int32{&r.Left, &r.Top, &r.Right, &r.Bottom} {
		*v = *v * 96 / int32(dpi)
	}
	aw, ah := int(r.Right-r.Left), int(r.Bottom-r.Top)
	w, h := min(w0, aw-32), min(h0, ah-32)
	x, y := int(r.Left)+(aw-w)/2, int(r.Top)+(ah-h)/2
	return []string{"--window-size=" + strconv.Itoa(w) + "," + strconv.Itoa(h), "--window-position=" + strconv.Itoa(x) + "," + strconv.Itoa(y)}
}

// The editor's window is an Edge or Chrome app window, so Windows groups it with the browser and shows the browser's
// icon in the taskbar (owner, 2026-11-01). Giving the window its own AppUserModelID, with the editor's exe as the
// relaunch icon, puts it in a taskbar button of its own with the editor's icon; WM_SETICON sets the title bar icon.
// The window is found by its class and title, and checked again every few seconds in case it's opened again.
var tagOnce sync.Once

const editorAUMID = "Pastullio.HarmoniousSaveEditor"

func tagEditorWindows() {
	tagOnce.Do(func() {
		setProcessAUMID()
		go func() {
			runtime.LockOSThread()
			ole32 := syscall.NewLazyDLL("ole32.dll")
			ole32.NewProc("CoInitializeEx").Call(0, 2) // COINIT_APARTMENTTHREADED
			for {
				// Edge sets its own ID on the window again (when it updates the window's icon, for one), and pinning
				// a window with Edge's ID pins Edge (owner, 2026-11-01), so the ID is checked and put back every time
				for _, h := range editorWindows() {
					if windowAUMID(h) != editorAUMID {
						tagWindow(h)
					}
				}
				time.Sleep(1500 * time.Millisecond)
			}
		}()
	})
}

func editorWindows() []uintptr {
	user32 := syscall.NewLazyDLL("user32.dll")
	getClass, getText, visible := user32.NewProc("GetClassNameW"), user32.NewProc("GetWindowTextW"), user32.NewProc("IsWindowVisible")
	var out []uintptr
	cb := syscall.NewCallback(func(h, _ uintptr) uintptr {
		if v, _, _ := visible.Call(h); v == 0 {
			return 1
		}
		buf := make([]uint16, 256)
		getClass.Call(h, uintptr(unsafe.Pointer(&buf[0])), 256)
		if syscall.UTF16ToString(buf) != "Chrome_WidgetWin_1" {
			return 1
		}
		getText.Call(h, uintptr(unsafe.Pointer(&buf[0])), 256)
		if t := syscall.UTF16ToString(buf); t == "Harmonious Save Editor" || strings.HasPrefix(t, "Harmonious Save Editor - ") {
			out = append(out, h)
		}
		return 1
	})
	user32.NewProc("EnumWindows").Call(cb, 0)
	return out
}

type guid struct {
	a    uint32
	b, c uint16
	d    [8]byte
}
type propKey struct {
	fmtid guid
	pid   uint32
}
type propVariant struct {
	vt         uint16
	r1, r2, r3 uint16
	p, p2      uintptr
}

var (
	iidPropertyStore = guid{0x886D8EEB, 0x8CF2, 0x4446, [8]byte{0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99}}
	appUserModelFmt  = guid{0x9F4C2855, 0x9F79, 0x4B39, [8]byte{0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3}}
)

// windowAUMID reads the window's AppUserModelID ("" when it has none or it can't be read)
func windowAUMID(h uintptr) string {
	var store unsafe.Pointer
	if r, _, _ := syscall.NewLazyDLL("shell32.dll").NewProc("SHGetPropertyStoreForWindow").Call(h, uintptr(unsafe.Pointer(&iidPropertyStore)), uintptr(unsafe.Pointer(&store))); r != 0 || store == nil {
		return ""
	}
	vtbl := **(**[8]uintptr)(store)
	defer syscall.SyscallN(vtbl[2], uintptr(store))
	k := propKey{appUserModelFmt, 5}
	var v propVariant
	if r, _, _ := syscall.SyscallN(vtbl[5], uintptr(store), uintptr(unsafe.Pointer(&k)), uintptr(unsafe.Pointer(&v))); r != 0 {
		return ""
	}
	out := ""
	if v.vt == 31 && v.p != 0 {
		out = utf16At(v.p)
	}
	syscall.NewLazyDLL("ole32.dll").NewProc("PropVariantClear").Call(uintptr(unsafe.Pointer(&v)))
	return out
}

func utf16At(p uintptr) string {
	var b []uint16
	for i := uintptr(0); i < 1024; i++ {
		c := *(*uint16)(unsafe.Add(unsafe.Pointer(nil), p+2*i)) //nolint:govet // a string the shell allocated
		if c == 0 {
			break
		}
		b = append(b, c)
	}
	return syscall.UTF16ToString(b)
}

// setProcessAUMID gives the editor's own process the same ID, so a pinned exe and the window share a taskbar button
func setProcessAUMID() {
	if p, err := syscall.UTF16PtrFromString(editorAUMID); err == nil {
		syscall.NewLazyDLL("shell32.dll").NewProc("SetCurrentProcessExplicitAppUserModelID").Call(uintptr(unsafe.Pointer(p)))
	}
}

func tagWindow(h uintptr) bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	var store unsafe.Pointer
	shell32 := syscall.NewLazyDLL("shell32.dll")
	if r, _, _ := shell32.NewProc("SHGetPropertyStoreForWindow").Call(h, uintptr(unsafe.Pointer(&iidPropertyStore)), uintptr(unsafe.Pointer(&store))); r != 0 || store == nil {
		return false
	}
	vtbl := **(**[8]uintptr)(store)
	set := func(pid uint32, val string) {
		s, _ := syscall.UTF16PtrFromString(val)
		k := propKey{appUserModelFmt, pid}
		v := propVariant{vt: 31 /* VT_LPWSTR */, p: uintptr(unsafe.Pointer(s))}
		syscall.SyscallN(vtbl[6], uintptr(store), uintptr(unsafe.Pointer(&k)), uintptr(unsafe.Pointer(&v)))
	}
	set(2, `"`+exe+`"`)                       // RelaunchCommand
	set(3, exe+",0")                          // RelaunchIconResource
	set(4, "Harmonious Save Editor")          // RelaunchDisplayNameResource
	set(5, editorAUMID)                       // ID, last
	syscall.SyscallN(vtbl[7], uintptr(store)) // Commit
	syscall.SyscallN(vtbl[2], uintptr(store)) // Release
	// the title bar and Alt+Tab icon
	if p, err := syscall.UTF16PtrFromString(exe); err == nil {
		var big, small uintptr
		shell32.NewProc("ExtractIconExW").Call(uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&big)), uintptr(unsafe.Pointer(&small)), 1)
		send := syscall.NewLazyDLL("user32.dll").NewProc("SendMessageW")
		if big != 0 {
			send.Call(h, 0x0080, 1, big) // WM_SETICON, ICON_BIG
		}
		if small != 0 {
			send.Call(h, 0x0080, 0, small)
		}
	}
	return true
}
