//go:build windows

package main

// The editor's own window: a plain Win32 window with Microsoft's WebView2 (the Edge engine that ships with
// Windows 10 and 11) inside it, instead of an Edge --app window. Being our own window, pressing X asks the page
// first (the editor's Save & exit question, not the browser's "Leave site?" box), the taskbar shows the editor's
// icon without any tricks, and the window lives exactly as long as the app.
//
// Only the standard library is used: WebView2 is COM, so the few interfaces needed are called through their
// vtables (indices from Microsoft's WebView2.h) and the handlers we give it are small Go-made COM objects.
// Microsoft's WebView2Loader.dll (BSD licence, webview2/LICENSE.txt) is embedded and written to the app folder.
// When WebView2 can't start (no runtime, an error, a timeout) nativeWindow returns false before anything is shown
// and the app opens the Edge window as before.

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

//go:embed webview2/WebView2Loader.dll
var webview2Loader []byte

// the window's message loop and WebView2 must stay on one thread: keep main() on the process's main thread
func init() { runtime.LockOSThread() }

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	wvOle32  = syscall.NewLazyDLL("ole32.dll")
	dwmapi   = syscall.NewLazyDLL("dwmapi.dll")

	pRegisterClassEx  = user32.NewProc("RegisterClassExW")
	pCreateWindowEx   = user32.NewProc("CreateWindowExW")
	pDefWindowProc    = user32.NewProc("DefWindowProcW")
	pDestroyWindow    = user32.NewProc("DestroyWindow")
	pShowWindow       = user32.NewProc("ShowWindow")
	pUpdateWindow     = user32.NewProc("UpdateWindow")
	pGetMessage       = user32.NewProc("GetMessageW")
	pTranslateMessage = user32.NewProc("TranslateMessage")
	pDispatchMessage  = user32.NewProc("DispatchMessageW")
	pPostQuitMessage  = user32.NewProc("PostQuitMessage")
	pPostMessage      = user32.NewProc("PostMessageW")
	pGetClientRect    = user32.NewProc("GetClientRect")
	pSetWindowText    = user32.NewProc("SetWindowTextW")
	pSetWindowPos     = user32.NewProc("SetWindowPos")
	pSetTimer         = user32.NewProc("SetTimer")
	pKillTimer        = user32.NewProc("KillTimer")
	pLoadCursor       = user32.NewProc("LoadCursorW")
	pIsIconic         = user32.NewProc("IsIconic")
	pSetForeground    = user32.NewProc("SetForegroundWindow")
	pAllowForeground  = user32.NewProc("AllowSetForegroundWindow")
	pGetDpiForWindow  = user32.NewProc("GetDpiForWindow")
	pGetDpiForSystem  = user32.NewProc("GetDpiForSystem")
	pSetDpiAwareness  = user32.NewProc("SetProcessDpiAwarenessContext")
	pSysParamsInfo    = user32.NewProc("SystemParametersInfoW")
	pGetModuleHandle  = kernel32.NewProc("GetModuleHandleW")
	pCoInitializeEx   = wvOle32.NewProc("CoInitializeEx")
	pCoTaskMemFree    = wvOle32.NewProc("CoTaskMemFree")
	pDwmSetAttribute  = dwmapi.NewProc("DwmSetWindowAttribute")
	pCreateSolidBrush = syscall.NewLazyDLL("gdi32.dll").NewProc("CreateSolidBrush")
	pShellExecute     = syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")
)

const (
	wmDestroy      = 0x0002
	wmMove         = 0x0003
	wmSize         = 0x0005
	wmSetFocus     = 0x0007
	wmClose        = 0x0010
	wmGetMinMax    = 0x0024
	wmTimer        = 0x0113
	wmDpiChanged   = 0x02E0
	wmFocusEditor  = 0x8001 // WM_APP+1: another start of the app asks this one to come to the front
	timerCloseAck  = 1
	timerStartWait = 2
)

// the native window, once it is up; nil when the app uses the Edge window or no window
var native struct {
	hwnd       uintptr
	controller uintptr
	webview    uintptr
	ready      bool // the page said it is listening for close requests
	closing    bool // the page agreed (or isn't there to ask): close for real
	closeAsked bool // asked the page, waiting for its answer
	failed     error
	started    atomic.Bool
}

// --------------------------------------------------------------------------- COM plumbing

// comCall calls method idx of a COM object; uintptrescapes keeps the memory behind pointer arguments alive
//
//go:uintptrescapes
func comCall(obj uintptr, idx int, args ...uintptr) uintptr {
	vt := *(*uintptr)(unsafe.Add(unsafe.Pointer(nil), obj))
	fn := *(*uintptr)(unsafe.Add(unsafe.Pointer(nil), vt+uintptr(idx)*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{obj}, args...)...)
	return r
}

// a handler object WebView2 calls back: IUnknown plus one Invoke(this, a, b)
type comHandler struct{ vtbl *[4]uintptr }

var (
	handlers []*comHandler // kept for the life of the app, so the collector never frees what WebView2 holds
	cbQI     = syscall.NewCallback(func(this, riid, ppv uintptr) uintptr {
		*(*uintptr)(unsafe.Add(unsafe.Pointer(nil), ppv)) = this
		return 0
	})
	cbRef = syscall.NewCallback(func(this uintptr) uintptr { return 1 })
)

func newHandler(invoke func(this, a, b uintptr) uintptr) uintptr {
	h := &comHandler{vtbl: &[4]uintptr{cbQI, cbRef, cbRef, syscall.NewCallback(invoke)}}
	handlers = append(handlers, h)
	return uintptr(unsafe.Pointer(h))
}

func utf16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

// takeString reads a string WebView2 allocated and frees it
func takeString(p uintptr) string {
	if p == 0 {
		return ""
	}
	s := utf16At(p)
	pCoTaskMemFree.Call(p)
	return s
}

func failed(hr uintptr) bool { return int32(hr) < 0 }

// callIf calls a Windows function that older versions of Windows may not have (0 when it's missing)
//
//go:uintptrescapes
func callIf(p *syscall.LazyProc, args ...uintptr) uintptr {
	if p.Find() != nil {
		return 0
	}
	r, _, _ := p.Call(args...)
	return r
}

// --------------------------------------------------------------------------- vtable indices (WebView2.h)

const (
	// ICoreWebView2Environment
	envCreateController = 3
	// ICoreWebView2Controller
	ctlPutIsVisible      = 4
	ctlPutBounds         = 6
	ctlMoveFocus         = 12
	ctlNotifyParentMoved = 23
	ctlClose             = 24
	ctlGetCoreWebView2   = 25
	ctl2PutBackground    = 27 // ICoreWebView2Controller2
	// ICoreWebView2
	wvGetSettings        = 3
	wvNavigate           = 5
	wvAddNavStarting     = 7
	wvAddProcessFailed   = 25
	wvAddScriptOnCreated = 27
	wvExecuteScript      = 29
	wvReload             = 31
	wvAddWebMessage      = 34
	wvAddNewWindow       = 44
	wvAddTitleChanged    = 46
	wvGetDocumentTitle   = 48
	wvAddWindowCloseReq  = 59
	// ICoreWebView2Settings
	setPutStatusBar = 10
	// event args
	msgTryGetString   = 5 // ICoreWebView2WebMessageReceivedEventArgs
	navGetURI         = 3 // ICoreWebView2NavigationStartingEventArgs
	navPutCancel      = 8
	newWinGetURI      = 3 // ICoreWebView2NewWindowRequestedEventArgs
	newWinPutHandled  = 6
	procGetFailedKind = 3 // ICoreWebView2ProcessFailedEventArgs
)

var iidController2 = guid{0xC979903E, 0xD4CA, 0x4228, [8]byte{0x92, 0xEB, 0x47, 0xEE, 0x3F, 0xA9, 0x6E, 0xAB}}

// --------------------------------------------------------------------------- the window

// nativeWindow opens the editor's own window on url and runs it until it closes (true), or returns false
// without showing anything when WebView2 isn't available, so the caller can open the Edge window instead.
func nativeWindow(url string) bool {
	if os.Getenv("HSE_WINDOW") == "edge" || fileExists(filepath.Join(appDir, "use-edge-window")) {
		return false
	}
	loader, err := writeLoader()
	if err != nil {
		log.Printf("webview2: %v", err)
		return false
	}
	dll, err := syscall.LoadDLL(loader)
	if err != nil {
		log.Printf("webview2: loading %s: %v", loader, err)
		return false
	}
	create, err := dll.FindProc("CreateCoreWebView2EnvironmentWithOptions")
	if err != nil {
		log.Printf("webview2: %v", err)
		return false
	}
	if version := wvRuntimeVersion(dll); version == "" {
		log.Print("webview2: no WebView2 runtime installed, using the Edge window")
		return false
	} else {
		log.Printf("webview2: runtime %s", version)
	}

	callIf(pSetDpiAwareness, ^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4): sharp text on scaled screens
	pCoInitializeEx.Call(0, 2)            // COINIT_APARTMENTTHREADED
	setProcessAUMID()

	hwnd, err := createEditorWindow()
	if err != nil {
		log.Printf("webview2: %v", err)
		return false
	}
	native.hwnd = hwnd
	tagWindow(hwnd) // relaunch command and icon for a pinned taskbar button, and the title bar icon

	data := filepath.Join(appDir, "webview")
	migrateBrowserData(filepath.Join(appDir, "window"), data)
	envDone := newHandler(func(this, hr, env uintptr) uintptr {
		if failed(hr) || env == 0 {
			fail(errors.New("creating the WebView2 environment failed: " + hexHR(hr)))
			return 0
		}
		comCall(env, 1) // AddRef: keep it
		if r := comCall(env, envCreateController, hwnd, controllerDone(url)); failed(r) {
			fail(errors.New("CreateCoreWebView2Controller: " + hexHR(r)))
		}
		return 0
	})
	if r, _, _ := create.Call(0, uintptr(unsafe.Pointer(utf16(data))), 0, envDone); failed(r) {
		log.Printf("webview2: CreateCoreWebView2EnvironmentWithOptions: %s", hexHR(r))
		pDestroyWindow.Call(hwnd)
		pumpUntilQuit()
		return false
	}
	pSetTimer.Call(hwnd, timerStartWait, 30000, 0) // WebView2 not up after 30 s: use the Edge window instead
	pumpUntilQuit()
	if native.failed != nil {
		log.Printf("webview2: %v; using the Edge window", native.failed)
		return false
	}
	return true
}

func hexHR(hr uintptr) string { return fmt.Sprintf("0x%08X", uint32(hr)) }

// fail gives up on WebView2 before the window was shown; the message loop ends and the caller opens Edge
func fail(err error) {
	if native.started.Load() {
		log.Printf("webview2 after start: %v", err)
		return
	}
	native.failed = err
	native.closing = true
	pDestroyWindow.Call(native.hwnd)
}

func pumpUntilQuit() {
	var msg [48]byte // MSG
	for {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&msg[0])))
		pDispatchMessage.Call(uintptr(unsafe.Pointer(&msg[0])))
	}
}

// writeLoader puts the embedded WebView2Loader.dll in the app folder (again only when it differs)
func writeLoader() (string, error) {
	p := filepath.Join(appDir, "WebView2Loader.dll")
	if b, err := os.ReadFile(p); err == nil && bytes.Equal(b, webview2Loader) {
		return p, nil
	}
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return "", err
	}
	tmp := p + ".new"
	if err := os.WriteFile(tmp, webview2Loader, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, p); err != nil {
		os.Remove(tmp)
		if fileExists(p) { // in use by an editor that's still closing: the old copy works too
			return p, nil
		}
		return "", err
	}
	return p, nil
}

func wvRuntimeVersion(dll *syscall.DLL) string {
	get, err := dll.FindProc("GetAvailableCoreWebView2BrowserVersionString")
	if err != nil {
		return "unknown"
	}
	var out uintptr
	if r, _, _ := get.Call(0, uintptr(unsafe.Pointer(&out))); failed(r) {
		return ""
	}
	return takeString(out)
}

// windowTheme remembers the page's light or dark look, so the window opens in it (no white flash in dark mode)
type windowPrefs struct {
	Theme string `json:"theme"`
}

func loadWindowPrefs() windowPrefs {
	var p windowPrefs
	if b, err := os.ReadFile(filepath.Join(appDir, "window.json")); err == nil {
		_ = json.Unmarshal(b, &p)
	}
	return p
}

func saveWindowPrefs(p windowPrefs) {
	if b, err := json.Marshal(p); err == nil {
		_ = atomicWrite(filepath.Join(appDir, "window.json"), b)
	}
}

// the page's background (--bg in app.html) as a COLORREF (0x00BBGGRR) and as WebView2's {A, R, G, B}
func themeColours(dark bool) (colorref, argb uintptr) {
	r, g, b := uintptr(0xe6), uintptr(0xf0), uintptr(0xf5)
	if dark {
		r, g, b = 0x08, 0x14, 0x1a
	}
	return r | g<<8 | b<<16, 0xFF | r<<8 | g<<16 | b<<24
}

func setDarkTitleBar(hwnd uintptr, dark bool) {
	v := uint32(0)
	if dark {
		v = 1
	}
	callIf(pDwmSetAttribute, hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, uintptr(unsafe.Pointer(&v)), 4)
}

func createEditorWindow() (uintptr, error) {
	inst, _, _ := pGetModuleHandle.Call(0)
	prefs := loadWindowPrefs()
	dark := prefs.Theme == "dark"
	bg, _ := themeColours(dark)
	brush, _, _ := pCreateSolidBrush.Call(bg)
	cursor, _, _ := pLoadCursor.Call(0, 32512) // IDC_ARROW
	var big, small uintptr
	if exe, err := os.Executable(); err == nil {
		syscall.NewLazyDLL("shell32.dll").NewProc("ExtractIconExW").Call(uintptr(unsafe.Pointer(utf16(exe))), 0, uintptr(unsafe.Pointer(&big)), uintptr(unsafe.Pointer(&small)), 1)
	}
	className := utf16("HarmoniousSaveEditor")
	wc := struct {
		size, style            uint32
		proc                   uintptr
		clsExtra, wndExtra     int32
		inst, icon, cur, brush uintptr
		menu, class            *uint16
		iconSm                 uintptr
	}{style: 3 /* CS_HREDRAW|CS_VREDRAW */, proc: syscall.NewCallback(wndProc), inst: inst, icon: big, cur: cursor, brush: brush, class: className, iconSm: small}
	wc.size = uint32(unsafe.Sizeof(wc))
	if r, _, err := pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return 0, errors.New("RegisterClassEx: " + err.Error())
	}
	x, y, w, h := nativePlacement()
	hwnd, _, err := pCreateWindowEx.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(utf16("Harmonious Save Editor"))),
		0x00CF0000, // WS_OVERLAPPEDWINDOW
		uintptr(x), uintptr(y), uintptr(w), uintptr(h), 0, 0, inst, 0)
	if hwnd == 0 {
		return 0, errors.New("CreateWindowEx: " + err.Error())
	}
	setDarkTitleBar(hwnd, dark)
	return hwnd, nil
}

// nativePlacement centres a 1440×920 (at 100 %) window on the main screen's work area, shrunk on small screens.
// The process is DPI aware here, so the work area is in real pixels and the size is scaled to match.
func nativePlacement() (x, y, w, h int32) {
	dpi := callIf(pGetDpiForSystem)
	if dpi == 0 {
		dpi = 96
	}
	sc := func(v int32) int32 { return v * int32(dpi) / 96 }
	var r struct{ Left, Top, Right, Bottom int32 }
	if ok, _, _ := pSysParamsInfo.Call(0x0030 /* SPI_GETWORKAREA */, 0, uintptr(unsafe.Pointer(&r)), 0); ok == 0 || r.Right-r.Left < 400 {
		return sc(60), sc(40), sc(1440), sc(920)
	}
	aw, ah := r.Right-r.Left, r.Bottom-r.Top
	w, h = min(sc(1440), aw-sc(32)), min(sc(920), ah-sc(32))
	return r.Left + (aw-w)/2, r.Top + (ah-h)/2, w, h
}

func resizeWebView() {
	if native.controller == 0 {
		return
	}
	var rc struct{ Left, Top, Right, Bottom int32 }
	pGetClientRect.Call(native.hwnd, uintptr(unsafe.Pointer(&rc)))
	comCall(native.controller, ctlPutBounds, uintptr(unsafe.Pointer(&rc))) // RECT goes by reference in the x64 ABI
}

func evalScript(js string) {
	if native.webview != 0 {
		comCall(native.webview, wvExecuteScript, uintptr(unsafe.Pointer(utf16(js))), 0)
	}
}

func wndProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch msg {
	case wmSize:
		resizeWebView()
		return 0
	case wmMove:
		if native.controller != 0 {
			comCall(native.controller, ctlNotifyParentMoved)
		}
	case wmSetFocus:
		if native.controller != 0 {
			comCall(native.controller, ctlMoveFocus, 0) // COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC
		}
	case wmGetMinMax:
		dpi := callIf(pGetDpiForWindow, hwnd)
		if dpi == 0 {
			dpi = 96
		}
		mm := (*[10]int32)(unsafe.Add(unsafe.Pointer(nil), lp)) // MINMAXINFO: ptMinTrackSize is the 4th POINT
		mm[6], mm[7] = int32(760*dpi/96), int32(520*dpi/96)
		return 0
	case wmDpiChanged:
		r := (*[4]int32)(unsafe.Add(unsafe.Pointer(nil), lp))
		pSetWindowPos.Call(hwnd, 0, uintptr(r[0]), uintptr(r[1]), uintptr(r[2]-r[0]), uintptr(r[3]-r[1]), 0x0014) // SWP_NOZORDER|SWP_NOACTIVATE
		return 0
	case wmClose:
		// ask the page: it closes straight away when nothing is unsaved, otherwise it shows Keep editing /
		// Exit without saving / Save & exit. A page that doesn't answer within a few seconds doesn't keep it open.
		if native.closing || !native.ready || native.webview == 0 {
			pDestroyWindow.Call(hwnd)
			return 0
		}
		native.closeAsked = true
		evalScript(`window.hseCloseRequest ? hseCloseRequest() : chrome.webview.postMessage("exit")`)
		pSetTimer.Call(hwnd, timerCloseAck, 4000, 0)
		return 0
	case wmTimer:
		pKillTimer.Call(hwnd, wp)
		switch wp {
		case timerCloseAck:
			if native.closeAsked {
				log.Print("the page didn't answer the close request, closing")
				native.closing = true
				pDestroyWindow.Call(hwnd)
			}
		case timerStartWait:
			if !native.started.Load() {
				fail(errors.New("WebView2 didn't start within 30 seconds"))
			}
		}
		return 0
	case wmFocusEditor:
		if ic, _, _ := pIsIconic.Call(hwnd); ic != 0 {
			pShowWindow.Call(hwnd, 9) // SW_RESTORE
		}
		pSetForeground.Call(hwnd)
		return 0
	case wmDestroy:
		if native.controller != 0 {
			comCall(native.controller, ctlClose)
			native.controller, native.webview = 0, 0
		}
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProc.Call(hwnd, msg, wp, lp)
	return r
}

// controllerDone sets up the web view once WebView2 has made it: settings, events, the page
func controllerDone(url string) uintptr {
	return newHandler(func(this, hr, ctl uintptr) uintptr {
		if failed(hr) || ctl == 0 {
			fail(errors.New("creating the WebView2 controller failed: " + hexHR(hr)))
			return 0
		}
		comCall(ctl, 1) // AddRef
		native.controller = ctl
		var wv uintptr
		comCall(ctl, ctlGetCoreWebView2, uintptr(unsafe.Pointer(&wv)))
		if wv == 0 {
			fail(errors.New("no CoreWebView2"))
			return 0
		}
		native.webview = wv
		var settings uintptr
		if comCall(wv, wvGetSettings, uintptr(unsafe.Pointer(&settings))); settings != 0 {
			comCall(settings, setPutStatusBar, 0) // no link preview in the corner
			comCall(settings, 2)
		}
		// the window's background while a page loads, in the page's own colour
		var ctl2 uintptr
		if comCall(ctl, 0, uintptr(unsafe.Pointer(&iidController2)), uintptr(unsafe.Pointer(&ctl2))); ctl2 != 0 {
			_, argb := themeColours(loadWindowPrefs().Theme == "dark")
			comCall(ctl2, ctl2PutBackground, argb)
			comCall(ctl2, 2)
		}
		var tok int64
		comCall(wv, wvAddWebMessage, newHandler(onWebMessage), uintptr(unsafe.Pointer(&tok)))
		comCall(wv, wvAddNewWindow, newHandler(onNewWindow), uintptr(unsafe.Pointer(&tok)))
		comCall(wv, wvAddNavStarting, newHandler(onNavStarting(url)), uintptr(unsafe.Pointer(&tok)))
		comCall(wv, wvAddTitleChanged, newHandler(onTitleChanged), uintptr(unsafe.Pointer(&tok)))
		comCall(wv, wvAddWindowCloseReq, newHandler(func(this, sender, args uintptr) uintptr {
			native.closing = true // window.close() from the page
			pPostMessage.Call(native.hwnd, wmClose, 0, 0)
			return 0
		}), uintptr(unsafe.Pointer(&tok)))
		comCall(wv, wvAddProcessFailed, newHandler(onProcessFailed), uintptr(unsafe.Pointer(&tok)))
		comCall(wv, wvAddScriptOnCreated, uintptr(unsafe.Pointer(utf16(`window.HSE_NATIVE = true;`))), 0)
		native.started.Store(true)
		resizeWebView()
		comCall(ctl, ctlPutIsVisible, 1)
		comCall(wv, wvNavigate, uintptr(unsafe.Pointer(utf16(url))))
		pShowWindow.Call(native.hwnd, 5) // SW_SHOW
		pUpdateWindow.Call(native.hwnd)
		pSetForeground.Call(native.hwnd)
		comCall(ctl, ctlMoveFocus, 0)
		return 0
	})
}

// messages from the page (chrome.webview.postMessage)
func onWebMessage(this, sender, args uintptr) uintptr {
	var p uintptr
	if failed(comCall(args, msgTryGetString, uintptr(unsafe.Pointer(&p)))) {
		return 0
	}
	switch m := takeString(p); {
	case m == "ready":
		native.ready = true
	case m == "close-ack": // the page is handling the close (it may be asking about unsaved changes)
		native.closeAsked = false
		pKillTimer.Call(native.hwnd, timerCloseAck)
	case m == "close-cancel":
		native.closeAsked = false
	case m == "exit":
		native.closing = true
		pPostMessage.Call(native.hwnd, wmClose, 0, 0)
	case strings.HasPrefix(m, "theme:"):
		dark := m == "theme:dark"
		setDarkTitleBar(native.hwnd, dark)
		if t := strings.TrimPrefix(m, "theme:"); loadWindowPrefs().Theme != t {
			saveWindowPrefs(windowPrefs{Theme: t})
		}
	}
	return 0
}

// links that open a new window (target=_blank: the guide, other tools, listings) go to the default browser
func onNewWindow(this, sender, args uintptr) uintptr {
	var p uintptr
	comCall(args, newWinGetURI, uintptr(unsafe.Pointer(&p)))
	comCall(args, newWinPutHandled, 1)
	openExternal(takeString(p))
	return 0
}

// the window only ever shows the editor: any other page opens in the default browser instead
func onNavStarting(home string) func(this, sender, args uintptr) uintptr {
	return func(this, sender, args uintptr) uintptr {
		var p uintptr
		comCall(args, navGetURI, uintptr(unsafe.Pointer(&p)))
		u := takeString(p)
		if strings.HasPrefix(u, home) || strings.HasPrefix(u, "about:") || strings.HasPrefix(u, "data:") || strings.HasPrefix(u, "blob:") {
			return 0
		}
		comCall(args, navPutCancel, 1)
		openExternal(u)
		return 0
	}
}

func onTitleChanged(this, sender, args uintptr) uintptr {
	var p uintptr
	comCall(sender, wvGetDocumentTitle, uintptr(unsafe.Pointer(&p)))
	if t := takeString(p); t != "" {
		pSetWindowText.Call(native.hwnd, uintptr(unsafe.Pointer(utf16(t))))
	}
	return 0
}

// a crashed page is reloaded; if the whole engine went, the editor starts again
func onProcessFailed(this, sender, args uintptr) uintptr {
	var kind int32
	comCall(args, procGetFailedKind, uintptr(unsafe.Pointer(&kind)))
	log.Printf("webview2: process failed (kind %d)", kind)
	switch kind {
	case 1, 2: // render process exited or unresponsive
		native.ready = false
		comCall(sender, wvReload)
	case 0: // browser process exited
		go restartSelf()
	}
	return 0
}

func restartSelf() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if srvRef != nil {
		srvRef.Close()
	}
	time.Sleep(300 * time.Millisecond)
	if exec.Command(exe, os.Args[1:]...).Start() == nil {
		liveShutdown()
		os.Exit(0)
	}
}

func openExternal(u string) {
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "mailto:") {
		return
	}
	pShellExecute.Call(0, uintptr(unsafe.Pointer(utf16("open"))), uintptr(unsafe.Pointer(utf16(u))), 0, 0, 1)
}

// focusNativeWindow brings this editor's window to the front (asked by a second start of the app); false
// when this editor has no window of its own (it uses the Edge window)
func focusNativeWindow() bool {
	if native.hwnd == 0 || !native.started.Load() {
		return false
	}
	pPostMessage.Call(native.hwnd, wmFocusEditor, 0, 0)
	return true
}

// allowFocusSteal lets the editor that's already running come to the front when this start asks it to
func allowFocusSteal() { pAllowForeground.Call(^uintptr(0)) } // ASFW_ANY

// migrateBrowserData copies the Edge window's saved settings (light or dark, sidebar layout, cover view…) and
// pictures (IndexedDB: part picks, model stills, planets) into the new window's profile, once: both are the same
// engine and the same address, so the page finds everything where it left it.
func migrateBrowserData(edgeProfile, webviewData string) {
	if fileExists(webviewData) {
		return
	}
	src := filepath.Join(edgeProfile, "Default")
	dst := filepath.Join(webviewData, "EBWebView", "Default")
	n := 0
	for _, d := range []string{"Local Storage", "IndexedDB"} {
		if fileExists(filepath.Join(src, d)) {
			if err := copyTree(filepath.Join(src, d), filepath.Join(dst, d)); err != nil {
				log.Printf("webview2: copying %s: %v", d, err)
			}
			n++
		}
	}
	if n > 0 {
		log.Printf("webview2: settings and pictures copied from the Edge window's profile")
	}
	_ = os.MkdirAll(webviewData, 0o755)
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		out := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		if d.Name() == "LOCK" { // leveldb's lock file is made fresh by its owner
			return nil
		}
		in, err := os.Open(p)
		if err != nil {
			return nil // a file the old window still holds: skip it
		}
		defer in.Close()
		f, err := os.Create(out)
		if err != nil {
			return err
		}
		_, err = io.Copy(f, in)
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		return err
	})
}
