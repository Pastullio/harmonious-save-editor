#!/bin/sh
# Builds the desktop app. Needs Go 1.22+. Run `node build.js` first.
set -e
cd "$(dirname "$0")/desktop"
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H windowsgui" -o "../dist/Harmonious Save Editor.exe" .
echo "built dist/Harmonious Save Editor.exe"
