# Harmonious Save Editor

No Man's Sky save editor for Steam/GOG PC saves (Frontiers 3.60+). Owner: Pastullio. GPL-3.0.

## Layout
- `src/codec.js` — save format: LZ4 chunked data file, XXTEA-encrypted meta file, lossless JSON (keeps key order, number lexemes, escapes, raw hashed-ID bytes). Works in browser and Node.
- `src/app.html` — the whole editor UI (vanilla JS, no framework). `build.js` inlines the codec and the key mapping into it.
- `desktop/` — Go app (stdlib only) that serves the page on 127.0.0.1 with a per-run token and an API to list/read/write save pairs. Windows build is the main deliverable.
- `desktop/render.go` + `desktop/render_cover.py` — corvette cover renders: finds the owner's Blender and Charon Forge (Blender extension, GPL-3.0, github.com/xX-Charon-Xx/charon_forge), runs `blender -b --factory-startup --python render_cover.py`, caches PNGs in `%LOCALAPPDATA%\HarmoniousSaveEditor\covers\<build hash>.png`. Never bundle Charon Forge's game-derived models; always read the local install.
- `vendor/libnom/` — key mapping and hashed-tech list from libNOM.map / libNOM.io. Refresh `mapping_mbincompiler.json` when the game adds keys.
- `ROADMAP.md` — the owner's wishlist sorted into phases. Check it before starting new work and tick items off as they ship.
- `dist/` — built outputs: `nms-save-editor.html` (browser version) and `Harmonious Save Editor.exe`.

## Build
```
node build.js            # dist/nms-save-editor.html + desktop/index.html
./build-desktop.sh       # dist/Harmonious Save Editor.exe (Go 1.22+)
```
Always rebuild both and commit `dist/` so the owner can grab the exe from GitHub.

## Test (run all before committing)
```
pip install --break-system-packages lz4    # once per environment
python3 test/make_fixture.py <dir>          # synthetic save3.hg + mf_save3.hg
node test/test_codec.js <dir>               # codec vs python-lz4 and a literal libNOM port
node test/test_ui.js <dir> <shots>          # e2e in headless Chromium (Playwright at /opt/npm-tools)
node test/test_folder.js <dir>              # browser folder mode, mocked File System Access API
REAL_SAVE_DIR=<dir> node test/test_real.js   # byte-identical round trip of a real save (save.hg + mf_save.hg); skips if absent
```
`test/e2e/test_render.js` renders real corvettes through the app; it needs bpy 4.5 in a Python 3.11 venv (`uv venv -p 3.11 bpyenv && uv pip install -p bpyenv/bin/python "bpy==4.5.*"`), a Charon Forge checkout linked into `~/.config/blender/4.5/extensions/user_default/`, and `HSE_BLENDER` pointing at `test/e2e/fake-blender.sh`.
`test_ui.js` reports one expected failure ("no page errors") when Google Fonts can't load offline.

## Rules for changes
- Never lose data: unedited saves must re-encode to identical JSON; the page re-decodes before every write; the app backs up the pair before replacing it.
- Edit via the key accessors (`g`, `set`, `kOf`) so obfuscated and plaintext saves both work. New fields get the obfuscated key via `NAME2OBF`.
- Keep new slots/items in the same key order the game uses (copy from an existing sibling).
- Owner is on Windows with Steam; Chrome blocks AppData for web pages, so the desktop app is the primary way to use it.
- Look: "Glacial", matching the owner's Portal Glyph Banner. Tokens live on `:root` in `src/app.html` with a dark set under `prefers-color-scheme` and `[data-theme=dark]`. Never use yellow or purple. Titles and section labels use the banner's wide-tracked uppercase; everything else is sentence case. Jost is the typeface.
- UI copy: plain, sentence case.
