package main

import (
	"net/url"
	"testing"
)

func TestPageMeta(t *testing.T) {
	base, _ := url.Parse("https://charon.gg/ships/123")
	page := `<html><head><title>Fallback</title><meta property="og:title" content="The Cutting Remark &amp; co">
<meta content="/img/cover.png" property="og:image"><meta name="description" content="A sleek corvette"><meta name="author" content='Pastullio'></head></html>`
	m := pageMeta(page, base)
	if m["title"] != "The Cutting Remark & co" || m["image"] != "https://charon.gg/img/cover.png" || m["description"] != "A sleek corvette" || m["author"] != "Pastullio" {
		t.Fatalf("got %v", m)
	}
	if _, err := publicURL("http://127.0.0.1/x"); err == nil {
		t.Fatal("loopback allowed")
	}
	if _, err := publicURL("file:///etc/passwd"); err == nil {
		t.Fatal("file allowed")
	}
}
