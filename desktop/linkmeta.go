package main

// Artwork, title, author and description from a ship's listing page (Charon, NMA or any site that sets the usual
// Open Graph tags), for the Dock Yard. Only public http(s) addresses are fetched, with a size and time limit.

import (
	"context"
	"errors"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var metaTagRe = regexp.MustCompile(`(?is)<meta\s+[^>]*>`)
var metaAttrRe = regexp.MustCompile(`(?is)(property|name|content)\s*=\s*("([^"]*)"|'([^']*)')`)
var titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

func publicURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("that isn't a web address")
	}
	ips, err := net.LookupIP(u.Hostname())
	if err != nil || len(ips) == 0 {
		return nil, errors.New("that site couldn't be found")
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return nil, errors.New("only public web pages can be read")
		}
	}
	return u, nil
}

func fetchLimited(u *url.URL, limit int64, accept string) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HarmoniousSaveEditor")
	req.Header.Set("Accept", accept)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, "", errors.New("the site answered " + res.Status)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, limit))
	return b, res.Header.Get("Content-Type"), err
}

// GET ?url=: {title, image, description, author, site}. GET ?image=: the picture itself.
func handleLinkMeta(w http.ResponseWriter, r *http.Request) {
	if img := r.URL.Query().Get("image"); img != "" {
		u, err := publicURL(img)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		b, ct, err := fetchLimited(u, 15<<20, "image/*")
		if err != nil || !strings.HasPrefix(ct, "image/") {
			http.Error(w, "the picture couldn't be downloaded", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", ct)
		_, _ = w.Write(b)
		return
	}
	u, err := publicURL(r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	b, _, err := fetchLimited(u, 3<<20, "text/html")
	if err != nil {
		http.Error(w, "the page couldn't be read: "+err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, pageMeta(string(b), u))
}

func pageMeta(page string, base *url.URL) map[string]string {
	out := map[string]string{}
	for _, tag := range metaTagRe.FindAllString(page, -1) {
		var key, content string
		for _, m := range metaAttrRe.FindAllStringSubmatch(tag, -1) {
			v := m[3] + m[4]
			switch strings.ToLower(m[1]) {
			case "property", "name":
				key = strings.ToLower(v)
			case "content":
				content = html.UnescapeString(strings.TrimSpace(v))
			}
		}
		if content == "" {
			continue
		}
		set := func(k string) {
			if out[k] == "" {
				out[k] = content
			}
		}
		switch key {
		case "og:title", "twitter:title":
			set("title")
		case "og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src":
			set("image")
		case "og:description", "twitter:description", "description":
			set("description")
		case "author", "article:author", "twitter:creator":
			set("author")
		case "og:site_name":
			set("site")
		}
	}
	if out["title"] == "" {
		if m := titleRe.FindStringSubmatch(page); m != nil {
			out["title"] = html.UnescapeString(strings.TrimSpace(m[1]))
		}
	}
	if img := out["image"]; img != "" {
		if iu, err := base.Parse(img); err == nil {
			out["image"] = iu.String()
		}
	}
	return out
}
