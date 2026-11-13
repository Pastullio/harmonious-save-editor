#!/bin/sh
# Releases are normally made by .github/workflows/release.yml when dist/version.json is pushed. This does the same
# by hand (gh CLI with release rights), and shows the download counts:
#   tools/release.sh            create the release for the current build (skipped if it exists)
#   tools/release.sh --counts   how many times each release's files were downloaded (new downloads + self-updates)
set -e
cd "$(dirname "$0")/.."
REPO=Pastullio/harmonious-save-editor
if [ "$1" = "--counts" ]; then
  gh api "repos/$REPO/releases?per_page=100" --paginate --jq '.[] | "\(.tag_name)\t\(.published_at[:10])\t\([.assets[] | select(.name|endswith(".exe")) | .download_count] | add // 0)"' |
    awk -F'\t' 'BEGIN{print "version\t\t\tdate\t\texe downloads"} {print $1"\t"$2"\t"$3; t+=$3} END{print "total exe downloads: "t}'
  exit 0
fi
VERSION=$(node -p 'require("./dist/version.json").version')
NOTES=$(node -p 'require("./dist/version.json").notes || "Small fixes."')
if gh release view "v$VERSION" -R "$REPO" >/dev/null 2>&1; then echo "release v$VERSION already exists"; exit 0; fi
TMP=$(mktemp -d)
cp "dist/Harmonious Save Editor.exe" "$TMP/HarmoniousSaveEditor.exe"
cp "dist/Harmonious Save Editor Guide.html" "$TMP/Harmonious-Save-Editor-Guide.html"
cp "dist/nms-save-editor.html" "$TMP/nms-save-editor-browser.html"
BODY="$NOTES

**Download:** HarmoniousSaveEditor.exe below (Windows, no installer). If you already have the editor, it updates itself.
The user guide and the browser version are attached too."
gh release create "v$VERSION" -R "$REPO" --target main --title "Harmonious DryDock $VERSION" --notes "$BODY" --latest \
  "$TMP/HarmoniousSaveEditor.exe" "$TMP/Harmonious-Save-Editor-Guide.html" "$TMP/nms-save-editor-browser.html"
rm -rf "$TMP"
echo "released v$VERSION"
