#!/bin/sh
# Builds the Mac test build: dist-mac/HarmoniousDryDock-Mac.zip, holding "Harmonious DryDock.app" (both processors,
# picked by a small launcher) and READ ME FIRST.txt. Run `node build.js` first. Usage: tools/build-mac.sh [version]
# Cross-compiled from any system with Go; nothing is signed with Apple (the read-me says how to open it). Go's
# linker signs the Apple Silicon program ad hoc, which that processor requires.
set -e
cd "$(dirname "$0")/.."
VERSION="${1:-dev-mac}"
OUT=dist-mac
APP="$OUT/Harmonious DryDock.app"
rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for ARCH in arm64 amd64; do
  (cd desktop && CGO_ENABLED=0 GOOS=darwin GOARCH=$ARCH go build -trimpath -ldflags "-s -w -X main.appVersion=$VERSION" -o "../$APP/Contents/MacOS/drydock-$ARCH" .)
done
cp desktop/mac/DryDock "$APP/Contents/MacOS/DryDock"
chmod 755 "$APP/Contents/MacOS/DryDock" "$APP/Contents/MacOS/drydock-arm64" "$APP/Contents/MacOS/drydock-amd64"
sed "s/@VERSION@/$VERSION/g" desktop/mac/Info.plist > "$APP/Contents/Info.plist"
cp desktop/mac/DryDock.icns "$APP/Contents/Resources/DryDock.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"
sed "s/@VERSION@/$VERSION/g" "desktop/mac/READ ME FIRST.txt" > "$OUT/READ ME FIRST.txt"
(cd "$OUT" && zip -qry HarmoniousDryDock-Mac.zip "Harmonious DryDock.app" "READ ME FIRST.txt")
echo "built $OUT/HarmoniousDryDock-Mac.zip ($VERSION, $(wc -c < "$OUT/HarmoniousDryDock-Mac.zip" | tr -d ' ') bytes)"
