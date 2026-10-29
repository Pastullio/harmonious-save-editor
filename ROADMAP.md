# Roadmap

The owner's wishlist (2026-10-28), sorted into phases. Each phase ships as a new `.exe` that gets tested on a spare save slot before the next one starts. Numbers in brackets point back to the original list.

New features are built for the desktop app. Most of them need to keep files on disk (a ship library, artwork, profiles) or stay running in the background, which the browser version can't do.

## Before phase 1: real files to learn from

Everything so far was tested on a synthetic save. These files decide how several features get built:

- [x] A real save pair (`save.hg` + `mf_save.hg`) with at least one corvette and a fitted ship (e.g. The Cutting Remark). Received 2026-10-28 (GodMode_2.9): round-trips byte-identical
- [ ] `accountdata.hg` + `mf_accountdata.hg` (expedition and Twitch reward unlocks live there) [7]
- [ ] One corvette exported from TAZ's optimizer (`.nmsship`, plus a `.json` if you have one) [11]
- [ ] One build exported from Blender / Drydock [1]
- [ ] A few files from the downloaded ship collection, whatever formats they're in [5]

## Shipped alongside

- [x] Save list shows one card per slot (newest of its auto and manual saves; the other is a click away)
- [x] Copy a save into the next empty slot, with a new name; nothing existing is ever overwritten
- [x] Back up all saves: zips the whole account folder into Documents\Harmonious Save Editor backups (landing page and sidebar)
- [x] Overview: traveller portrait (own screenshot), current ship and multi-tool covers, location (galaxy, portal code, galactic address) and journey stats from the save
- [x] Change picture on every cover (Cover Flow button, freighter and exocraft cards, the traveller): Steam screenshot, image file, paste or drop
- [ ] Portal code drawn as glyphs (reuse the Portal Glyph Banner's glyph art)

## Phase 1 — Loadout profiles (the owner's biggest win) [3]

Save a ship's or multi-tool's whole fit as a named profile ("S-class corvette loaded up"), then apply it to any other ship or tool in one click.

- [x] A profile captures: class, base stats, slot counts and which slots are unlocked (and supercharged), every technology module with its exact slot position, charge and damage state, and the cargo layout and contents
- [x] Apply: upgrades the class, copies the stats, resizes and unlocks the target to match, then places the tech exactly as in the source (cargo contents optional)
- [x] Profiles for multi-tools as well as starships and corvettes
- [x] Profiles are JSON files in the app's profiles folder, so they can be shared; import a profile file from the Apply dialog
- [x] Preview before applying, with a tick box per part and a warning when the ship types differ
- [x] Ship and multi-tool details like Goatfungus: type, class, seed with Generate, old colours, base stats, ship health and shield, delete, export and import (a ship file carries its corvette build)
- [x] Freighter details like Goatfungus: name, type, class, home and model seeds with Generate, hyperdrive and fleet coordination, base parts count, back up to a file and restore (inventories and the freighter base), plus profiles
- [x] Storage page: one drop-down for the storage containers, one for everything else, and Show all

## Phase 2 — Ship library: Hangar, Garage and Testing Facility [3] [5] [6]

One personal library of ship files outside the game, with three views onto it.

- [ ] **Hangar**: your own collection (the hundreds of downloaded ships). Swap a ship into an empty or chosen slot, or pull a ship out of the game into the library
- [ ] **Garage**: every ship that has been in any of your saves, captured automatically when a save is opened, so nothing is ever lost
- [ ] **Testing Facility**: ships you're testing for other creators, kept apart from the main library. Versions of the same ship are grouped, each with test notes, a date, and which test character it's on
- [ ] Import the formats in the collection (`.nmsship`, `.json`, `.so` tech files)
- [ ] Each entry can link to a Charon or NMA listing to pull artwork, author and description
- [ ] Search, tags and favourites

## Phase 3 — Visuals: Cover Flow and the overall look [2] [9]

- [x] Cover Flow browser (iTunes-style: scroll, drag, arrow keys, slider) — shipped as the Hangar page and as the picker on Starships and Multi-tools
- [ ] Extend Cover Flow to the Garage, Testing Facility and profiles once they exist
- [x] Generated covers: corvettes render as a rotating hologram of their real part layout; other ships and multi-tools get a type silhouette on a nebula seeded by the item's own seed
- [x] Drop a screenshot on any cover (or use Set cover image) to replace it; kept in the app's browser profile
- [x] Real renders of corvettes: the desktop app runs the owner's Blender with Charon Forge's part models in the background (Render with Blender / Render all corvettes) and caches each PNG by a hash of the build, so a cover re-renders only when the build changes
- [x] Covers for regular ships and multi-tools from the owner's own No Man's Sky screenshots: the app lists Steam's screenshot folder for the account (or a folder set in Cover settings), and a square crop frames the ship. Any image file or drop goes through the same crop
- [x] Default covers are turning wire-grid holograms of generic shapes of our own (fighter, hauler, explorer, shuttle, exotic, living ship, solar, interceptor, freighter, exocraft; pistol, rifle, staff), not copies of the game's models
- [ ] Real ship and multi-tool models rendered from the owner's own game files (needs a reader for the game's geometry format); the wireframes stay as the fallback
- [ ] Their look is generated in-game from the seed, so it can't be rendered outside the game; artwork for fixed-look specials (Golden Vector, Atlas Sceptre, Starborn ships) could come from the web later
- [ ] Artwork from a linked Charon/NMA listing
- [ ] More camera angles per corvette, and a turntable in the detail view
- [ ] Store custom covers with the library on disk (today they live in the app's browser profile)
- [ ] Stretch: render a 3D preview of a corvette from its part list using the Base Builder part models already on your PC
- [x] Glacial look to match the Portal Glyph Banner: icy light theme, deep-teal dark theme (toggle, remembered), Jost, pill buttons, wide-tracked titles; no yellow or purple anywhere
- [x] Cover Flow motion: spring physics, 1:1 drag with momentum, continuous trackpad/wheel glide, covers swing smoothly through the centre
- [x] Neutral text (dark gray / white) with a Spectrum accent per section, chosen by the owner
- [x] Item icons and names in every inventory, Goatfungus-style (icon, name, amount/max): the desktop app finds the owner's `NMSSaveEditor.jar` by itself and reads them from it in place
- [ ] Graphic-heavy pass across the rest of the app: class colours, ship and tool art, inventory grids as the visual centre

The save file holds no images, so a ship's picture has to come from one of these sources.

## Phase 4 — Corvettes: easy loading and the live Blender link [1] [11]

- [ ] Map exactly how a corvette is stored (the ship entry, its PlayerShipBase part list, and the link between them) from the real save
- [ ] Import and export corvette files in the formats TAZ's optimizer uses (`.nmsship`, `.json`), with the same safety rules: part ordering, camera and boarding cockpit, beam-up landing bay
- [ ] **Live Blender link**: Ctrl+S in Blender writes the build straight into the chosen corvette in your save. The app runs quietly in the system tray and receives the build from Blender. Drydock (or a tiny companion add-on) sends it on save, so there's no export, copy, paste or load step
- [ ] Every live update is backed up, so any version can be rolled back
- [ ] To test early: whether No Man's Sky picks up the new file when you load the save from the main menu, and how Steam Cloud reacts to a file changing outside the game

## Phase 5 — Cargo and Loadout Ops [7]

- [ ] Find an item across every inventory (exosuit, ships, freighter, storage containers, exocraft) and see where every stack is
- [ ] Consolidate: pick a destination, see the plan, untick anything to leave alone, then apply. Stack limits come from your character's difficulty settings
- [x] Select several slots (Ctrl-click, Shift-click, Ctrl+A) and fill, repair, remove, unlock or move them to any other inventory in one go
- [ ] Drag-select and drag-and-drop between inventories
- [ ] Unlock expedition rewards and Twitch drops (these live in `accountdata.hg`, so the app gains carefully limited write access to it)

## Own item library (so Goatfungus isn't needed)

- [x] "Build item library from your game": reads the owner's No Man's Sky install (HGPAK archives, zstd), the product/substance/technology/procedural tables and English text (MBIN), converts icons (BC7 DDS) to PNG, caches it all in the app folder. Built automatically on first start, rebuilt after a game update. 5,400+ items; names resolve for IDs Goatfungus lacks (e.g. HULK_REACTOR → Fuel Rod)
- [x] `tools/extract-nms-item-files.bat`: collects the tables, English text, an icon sample and the full pak file list from the owner's install (via HGPAKtool) so the reader can be built against real files
- [ ] Tech packs stored as hashed IDs still need a mapping (Goatfungus fallback covers them for now)
- [ ] Goatfungus's jar stays as a fallback

## Phase 6 — Streamlined editing (no more digging through JSON) [4]

- [ ] Plain-language editors for the sections people actually change: bases, freighter and frigates, settlements, companions, known technology and recipes, words, milestones and reputation, difficulty settings, current location
- [ ] "Find anything" box: type a ship name, item, base or setting and jump straight to its editor
- [ ] Raw data stays available as the expert fallback

## Phase 7 — Coordinates and planets [8] [10]

- [ ] Coordinate selector: enter glyphs, signal-booster coordinates or a galactic address and see the same place in all three forms, with portal glyph art, the galaxy name and the system's planets
- [ ] Names show for systems and planets you've discovered; uncharted ones show the address
- [ ] Teleport that reliably works: set the address and a safe arrival state (in space, on the freighter, at a base)
- [ ] Planet "qualities" card: copy a planet's details to share or search elsewhere

What these can show is limited by the game: planets are generated by the game itself, so the editor can't draw what a planet looks like. Names and qualities come only from what's in the save (your own discoveries). Phase 7 starts with research into how much planet detail the save actually holds.

## Open questions for the owner

- Where does the downloaded ship collection live, and in what formats?
- Should the Blender link go into Drydock itself, or be a separate small add-on that works alongside the Base Builder extension?
- Which test characters (save slots) are used for the Testing Facility?

## Learned from the real save (2026-10-28)

- Corvettes are ships whose model is `MODELS/COMMON/SPACECRAFT/BIGGS/BIGGS.SCENE.MBIN`. Their build lives in `PersistentPlayerBases` as a `PlayerShipBase` whose `UserData` equals the ship's index in `ShipOwnership`.
- Each part is `{Timestamp, ObjectID, UserData, Position, Up, At}`. `|Up|` is the part's scale; `Up` and `At` give its orientation. Part `UserData`: colour = `UserData & 0xFFFFFF` (palette index), finish = `(UserData >> 24) & 0xFF` (per Charon Forge's resources/COLOURS.md and colours.json).
- Several corvettes can share one ship seed; the seed doesn't identify a corvette.
- Ship entries carry an unmapped key `FA8` (an empty array in this save).
- Builds in this save: Formula1c 509 parts, Yautja Claw 753, The Cutting Remark 2,091, Max 2,921.
