package main

// Patrons (owner, 2026-11-11): the Traveller page's watermark comes off for people who support the editor on
// Patreon. Signing in goes through a small online service (service/patreon, on Netlify) that holds the Patreon app's
// secret, checks the member's pledge and hands back a pass signed with its Ed25519 key. The browser brings the pass
// here (/patron); the app checks the signature with the public key below and keeps the pass for a month.

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// the service's public key (its private half is the PASS_PRIVATE_KEY setting on Netlify)
const patronPublicKey = "yI50Kfqlm6YvB1RVXqxm9Nd8Pw8mCuN46HkTicuV+Xw="

// where the service runs; settings.json "patreonService" or HSE_PATREON_URL point elsewhere
const defaultPatreonService = "https://harmonious-patrons.netlify.app"

type patronPass struct {
	V      int    `json:"v"`
	UID    string `json:"uid"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
	Exp    int64  `json:"exp"`
	Nonce  string `json:"nonce"`
	Reason string `json:"reason,omitempty"`
}

var (
	patronMu     sync.Mutex
	patronNonces = map[string]time.Time{}
	appPort      string
	nonceRe      = regexp.MustCompile(`^[0-9a-f]{16,64}$`)
)

func patronFile() string { return filepath.Join(appDir, "patron.json") }

func patreonService() string {
	if u := os.Getenv("HSE_PATREON_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	renderMu.Lock()
	u := settings.Patreon
	renderMu.Unlock()
	if u != "" {
		return strings.TrimRight(u, "/")
	}
	return defaultPatreonService
}

func patronKey() ed25519.PublicKey {
	k := patronPublicKey
	if v := os.Getenv("HSE_PATRON_PUBKEY"); v != "" { // tests sign with their own key
		k = v
	}
	b, err := base64.StdEncoding.DecodeString(k)
	if err != nil || len(b) != ed25519.PublicKeySize {
		return nil
	}
	return ed25519.PublicKey(b)
}

// readPass checks a pass: "<base64url payload>.<base64url signature>"
func readPass(s string) (*patronPass, error) {
	parts := strings.Split(strings.TrimSpace(s), ".")
	if len(parts) != 2 {
		return nil, errBadPass
	}
	payload, err1 := base64.RawURLEncoding.DecodeString(parts[0])
	sig, err2 := base64.RawURLEncoding.DecodeString(parts[1])
	key := patronKey()
	if err1 != nil || err2 != nil || key == nil || !ed25519.Verify(key, []byte(parts[0]), sig) {
		return nil, errBadPass
	}
	var p patronPass
	if err := json.Unmarshal(payload, &p); err != nil || p.V != 1 {
		return nil, errBadPass
	}
	return &p, nil
}

type passError string

func (e passError) Error() string { return string(e) }

const errBadPass = passError("the pass isn't from the editor's Patreon check")

// POST /api/patron/signin: opens the service in the default browser; it comes back to /patron with the pass
func handlePatronSignin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	nonce := randHex(16)
	patronMu.Lock()
	for k, t := range patronNonces {
		if time.Since(t) > 20*time.Minute {
			delete(patronNonces, k)
		}
	}
	patronNonces[nonce] = time.Now()
	patronMu.Unlock()
	// is the check online and set up? (asked without a port, it answers 400; 500 means its settings are missing)
	cl := &http.Client{Timeout: 6 * time.Second}
	if resp, err := cl.Get(patreonService() + "/.netlify/functions/patreon-start"); err != nil || resp.StatusCode == http.StatusNotFound {
		if err == nil {
			resp.Body.Close()
		}
		writeJSON(w, map[string]any{"ok": false, "error": "the Patreon check isn't online yet"})
		return
	} else {
		resp.Body.Close()
		if resp.StatusCode >= 500 {
			writeJSON(w, map[string]any{"ok": false, "error": "the Patreon check isn't set up yet"})
			return
		}
	}
	u := patreonService() + "/.netlify/functions/patreon-start?port=" + appPort + "&nonce=" + nonce
	if err := openBrowser(u); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// GET /patron?pass=…&nonce=…: where the browser lands after Patreon (outside the page's token, like /guide)
func handlePatronReturn(w http.ResponseWriter, r *http.Request) {
	nonce := r.URL.Query().Get("nonce")
	page := func(title, text string) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Harmonious Save Editor</title>`+
			`<body style="font-family:Segoe UI,system-ui,sans-serif;background:#07131a;color:#fff;display:grid;place-items:center;min-height:90vh;margin:0">`+
			`<div style="max-width:460px;padding:24px;text-align:center"><h1 style="font-weight:300;letter-spacing:.12em;text-transform:uppercase;font-size:22px">`+html.EscapeString(title)+
			`</h1><p style="line-height:1.5;color:#cfe3ea">`+html.EscapeString(text)+`</p></div></body>`)
	}
	patronMu.Lock()
	_, known := patronNonces[nonce]
	delete(patronNonces, nonce)
	patronMu.Unlock()
	if !nonceRe.MatchString(nonce) || !known {
		page("Sign in again", "This sign-in wasn't started from the editor that's open now. Press Sign in with Patreon in the editor and try again.")
		return
	}
	p, err := readPass(r.URL.Query().Get("pass"))
	if err != nil || p.Nonce != nonce {
		page("Something went wrong", "The editor couldn't check the answer from Patreon. Please try again.")
		return
	}
	b, _ := json.Marshal(map[string]string{"pass": r.URL.Query().Get("pass")})
	if err := os.WriteFile(patronFile(), b, 0o600); err != nil {
		page("Something went wrong", "The editor couldn't keep your pass: "+err.Error())
		return
	}
	if p.Active {
		page("Thank you!", "You're signed in as "+p.Name+". Go back to Harmonious Save Editor: the watermark can come off now. You can close this tab.")
	} else {
		reason := p.Reason
		if reason == "" {
			reason = "Patreon doesn't show an active pledge for this account."
		}
		page("Not a patron yet", reason+" You can close this tab.")
	}
}

// GET /api/patron: {patron, name, until, reason}; DELETE signs out
func handlePatron(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		os.Remove(patronFile())
		writeJSON(w, map[string]any{"patron": false})
		return
	}
	var saved struct{ Pass string }
	b, err := os.ReadFile(patronFile())
	if err != nil || json.Unmarshal(b, &saved) != nil {
		writeJSON(w, map[string]any{"patron": false})
		return
	}
	p, err := readPass(saved.Pass)
	if err != nil {
		writeJSON(w, map[string]any{"patron": false, "reason": err.Error()})
		return
	}
	if time.Now().Unix() > p.Exp {
		writeJSON(w, map[string]any{"patron": false, "name": p.Name, "reason": "It's been a month since Patreon last checked, " + p.Name + ". Sign in again to keep the watermark off."})
		return
	}
	writeJSON(w, map[string]any{"patron": p.Active, "name": p.Name, "until": p.Exp, "reason": p.Reason})
}
