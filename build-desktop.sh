#!/bin/sh
# Builds the desktop app. Needs Go 1.22+. Run `node build.js` first.
# Each build gets a date version (UTC, e.g. 2026.10.30.1215) and writes dist/version.json, which the app
# reads to offer updates. RELEASE_NOTES="..." sets the "what's new" line shown in that offer, and goes into
# desktop/changelog.json (one change per line), which the updated app shows once.
set -e
cd "$(dirname "$0")/desktop"
VERSION=$(date -u +%Y.%m.%d.%H%M)
EXE="../dist/Harmonious Save Editor.exe"
# the changelog the app shows after an update (What's new): RELEASE_NOTES, one change per line, goes on top
if [ -n "${RELEASE_NOTES:-}" ]; then
node -e '
const [v, notes] = process.argv.slice(1), f = "changelog.json", fs = require("fs");
const log = JSON.parse(fs.readFileSync(f, "utf8"));
if (!log.some((e) => e.version === v)) log.unshift({ version: v, date: new Date().toISOString().slice(0, 10), notes: notes.split("\n").map((s) => s.trim()).filter(Boolean) });
fs.writeFileSync(f, JSON.stringify(log, null, 1) + "\n");
' "$VERSION" "$RELEASE_NOTES"
fi
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H windowsgui -X main.appVersion=$VERSION" -o "$EXE" .
SIZE=$(wc -c < "$EXE" | tr -d ' ')
SHA=$(sha256sum "$EXE" | cut -d' ' -f1)
node -e '
const [v, size, sha, notes] = process.argv.slice(1);
const out = { version: v, date: new Date().toISOString().slice(0, 10), size: +size, sha256: sha, notes,
  url: "https://raw.githubusercontent.com/Pastullio/harmonious-save-editor/main/dist/Harmonious%20Save%20Editor.exe" };
require("fs").writeFileSync("../dist/version.json", JSON.stringify(out, null, 2) + "\n");
' "$VERSION" "$SIZE" "$SHA" "${RELEASE_NOTES:-}"
echo "built dist/Harmonious Save Editor.exe ($VERSION)"
