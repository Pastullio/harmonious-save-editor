# Harmonious Save Editor

No Man's Sky save editor for Steam/GOG PC saves (Frontiers 3.60+). Owner: Pastullio. GPL-3.0.

## Layout
- `src/codec.js` — save format: LZ4 chunked data file, XXTEA-encrypted meta file, lossless JSON (keeps key order, number lexemes, escapes, raw hashed-ID bytes). Works in browser and Node.
- `src/app.html` — the whole editor UI (vanilla JS, no framework). `build.js` inlines the codec and the key mapping into it.
- `desktop/` — Go app (stdlib plus one vendored library, github.com/klauspost/compress for zstd; keep `desktop/vendor` committed and add nothing else) that serves the page on 127.0.0.1 with a per-run token and an API to list/read/write save pairs. Windows build is the main deliverable.
- `desktop/render.go` + `desktop/render_cover.py` — corvette cover renders: finds the owner's Blender and Charon Forge (Blender extension, GPL-3.0, github.com/xX-Charon-Xx/charon_forge), runs `blender -b --factory-startup --python render_cover.py`, caches PNGs in `%LOCALAPPDATA%\HarmoniousSaveEditor\covers\<build hash>.png`. Never bundle Charon Forge's game-derived models; always read the local install.
- `desktop/itemdb.go` — item names and icons from the owner's own Goatfungus `NMSSaveEditor.jar`: found on the PC (Downloads, Desktop, Documents, Program Files…), remembered in `settings.json` as `itemdb`, served from inside the jar (`/api/itemdb`, `/api/itemdb/items.xml`, `/api/itemdb/icon`). Never bundle the jar's data or icons. The browser version reads a picked jar into IndexedDB instead.
- `desktop/profiles.go` — loadout profiles as JSON files in `%LOCALAPPDATA%\HarmoniousSaveEditor\profiles` (list, write, delete, reveal). Profiles use plain key names (`toPlain`/`fromPlain` in the page) so they work with obfuscated and plaintext saves. `desktop/slots.go` — copy a save into an empty slot (never overwrites) and zip a whole account folder.
- `desktop/gamefiles.go` + `desktop/itemlib.go` — the app's own item library, built from the owner's game install: HGPAK archive reader (format from HGPAKtool, MIT), MBIN table reader (field offsets from MBINCompiler's libMBIN, checked against each template GUID), BC7/BC1/BC3 DDS decoder (port of Pillow's BcnDecode.c). Reads the product (plus base-part and customisation), substance, technology and procedural-technology tables and the English language files, converts icons to 128 px PNGs, and caches all of it in `%LOCALAPPDATA%\HarmoniousSaveEditor\itemlib`. Built automatically on first start and rebuilt when the archives change. When a game update changes a table layout the GUID check fails: update the offsets from the newest libMBIN. Goatfungus's jar (`desktop/itemdb.go`) is only a fallback now. Never commit game files.
- `desktop/models.go` — real models: SCENE.MBIN trees (REFERENCE nodes pull in parts; siblings named `_Group_Option` are alternatives, `xRARE`/`Shape`/`LODn` handled in `optionOf`), GEOMETRY.MBIN.PC / GEOMETRY.DATA.MBIN.PC streams (magic DDDD…; positions half4 at stride 16, then vertex data and 16/32-bit indices). `/api/model/parts` gives the choice tree, `/api/model/mesh` one binary triangle mesh (`HSEM`). The page draws it with WebGL2 (`GL3D`) and stores the owner's part picks in IndexedDB (`parts:<cover key>`).
- `tools/extract-nms-item-files.bat` — collects game tables, English text and an icon sample from the owner's install (via HGPAKtool) for developing the reader.
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
`cd desktop && HSE_TEST_BANKS=<paks> HSE_TEST_FILES=<extracted> HSE_TEST_REF=<pillow pngs> go test .` checks the pak reader and BC7 decoder against extracted files. `test/e2e/test_itemlib.js <dir> <PCBANKS>` builds the library through the app (test paks can be made from extracted files with HGPAKtool's `HGPAKFile.repack`). `test/e2e/test_models.js <dir> <PCBANKS>` renders real models and the parts picker (headless Chromium needs `--use-angle=swiftshader`). `test/e2e/test_itemdb.js <dir> <NMSSaveEditor.jar>` checks the jar is found and inventory cells show icon, name and amount/max.
`test/e2e/test_render.js` renders real corvettes through the app; it needs bpy 4.5 in a Python 3.11 venv (`uv venv -p 3.11 bpyenv && uv pip install -p bpyenv/bin/python "bpy==4.5.*"`), a Charon Forge checkout linked into `~/.config/blender/4.5/extensions/user_default/`, and `HSE_BLENDER` pointing at `test/e2e/fake-blender.sh`.

## Rules for changes
- Never lose data: unedited saves must re-encode to identical JSON; the page re-decodes before every write; the app backs up the pair before replacing it.
- Edit via the key accessors (`g`, `set`, `kOf`) so obfuscated and plaintext saves both work. New fields get the obfuscated key via `NAME2OBF`.
- Keep new slots/items in the same key order the game uses (copy from an existing sibling).
- Owner is on Windows with Steam; Chrome blocks AppData for web pages, so the desktop app is the primary way to use it.
- Look: "Glacial", matching the owner's Portal Glyph Banner. Tokens live on `:root` in `src/app.html` with a dark set under `prefers-color-scheme` and `[data-theme=dark]`. Text is neutral (dark gray in light mode, white in dark mode) and never tinted. Each section has its own accent from `SECTION_COLORS` in `src/app.html`: the "Spectrum" scheme the owner chose, sweeping teal, blue, violet, magenta, rose and coral, with mint and slate for the tool pages. Light mode darkens it automatically. New sections get a colour that fits the sweep. Rose `--spark` is reserved for unsaved changes. No yellow. Titles and section labels use the banner's wide-tracked uppercase; everything else is sentence case. Jost is the typeface, bundled from `vendor/fonts/jost` (SIL OFL) and inlined by `build.js`, so no web fonts are loaded.
- Inventories use the game's names and order: Technology (`*_TechOnly`) first, then Cargo (stored as `Inventory`). The legacy `Inventory_Cargo` the game no longer shows is listed as "Old cargo" only when it has items. `invGroup` shows them with a Technology / Cargo / Both switch. Grids keep the game's columns (slot position matters for adjacency) and scale with the window.
- UI copy: plain, sentence case.
