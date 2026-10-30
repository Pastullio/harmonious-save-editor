//go:build windows

package main

import (
	"strconv"
	"syscall"
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
	aw, ah := int(r.Right-r.Left), int(r.Bottom-r.Top)
	w, h := min(w0, aw-32), min(h0, ah-32)
	x, y := int(r.Left)+(aw-w)/2, int(r.Top)+(ah-h)/2
	return []string{"--window-size=" + strconv.Itoa(w) + "," + strconv.Itoa(h), "--window-position=" + strconv.Itoa(x) + "," + strconv.Itoa(y)}
}
