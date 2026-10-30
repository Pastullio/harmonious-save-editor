# Roadmap

The owner's wishlist (2026-10-28), sorted into phases. Each phase ships as a new `.exe` that gets tested on a spare save slot before the next one starts. Numbers in brackets point back to the original list.

New features are built for the desktop app. Most of them need to keep files on disk (a ship library, artwork, profiles) or stay running in the background, which the browser version can't do.

## Before phase 1: real files to learn from

Everything so far was tested on a synthetic save. These files decide how several features get built:

- [x] A real save pair (`save.hg` + `mf_save.hg`) with at least one corvette and a fitted ship (e.g. The Cutting Remark). Received 2026-10-28 (GodMode_2.9): round-trips byte-identical
- [x] `accountdata.hg` + `mf_accountdata.hg` (expedition and Twitch reward unlocks live there) [7]: both received 2026-10-29; the pair round-trips byte-identical
- [x] One corvette exported from TAZ's optimizer (`.nmsship`, plus a `.json` if you have one) [11]: Death n Glory, 2026-10-29
- [ ] One build exported from Blender / Drydock [1] (on hold, owner 2026-10-30: Drydock isn't ready)
- [x] A few files from the downloaded ship collection, whatever formats they're in [5]: `.txt` corvette builds (whole PlayerShipBase), 2026-10-29

## Shipped alongside

- [x] Save list shows one card per slot (newest of its auto and manual saves; the other is a click away)
- [x] Copy a save into the next empty slot, with a new name; nothing existing is ever overwritten
- [x] Back up all saves: zips the whole account folder into Documents\Harmonious Save Editor backups (landing page and sidebar)
- [x] Overview: traveller portrait (own screenshot), current ship and multi-tool covers, location (galaxy, portal code, galactic address) and journey stats from the save
- [x] Change picture on every cover (Cover Flow button, freighter and exocraft cards, the traveller): Steam screenshot, image file, paste or drop
- [x] Portal code drawn as glyphs (reuse the Portal Glyph Banner's glyph art)

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

- [x] **Dock Yard** (renamed from Ship library by the owner, 2026-10-29; the "Hangar" of the original list; the Hangar page already shows the save's own ships): one place in `Documents\Harmonious Save Editor\Dock Yard` with big Ship storage / Garage / Favourites tabs, a New badge and an Overview spotlight until it's opened, and Blender renders of its corvettes, plus linked folders the owner already keeps ships in (read only). Put a ship into an empty slot or replace one (corvette builds re-linked to the slot through the base's UserData, owner set to this player), put a build onto an existing corvette, save a ship from the save into the library, import files, delete to a Deleted folder
- [x] **Garage**: every ship in every save opened, captured automatically, one file per distinct version (ignoring where it's parked); a replaced ship is captured before it's overwritten
- [ ] **Testing Facility** (later, owner 2026-10-29): ships you're testing for other creators, kept apart from the main library. Versions of the same ship are grouped, each with test notes, a date, and which test character it's on
- [x] Reads our own `.ship.json` (now with the whole corvette base), bare ship entries, and corvette builds (a base with Objects, or just the Objects)
- [x] TAZ's `.nmsship` (a zip of `objects.json`, `so.json` and `ccd.json`; read and written, matching TAZ's BOM + CRLF JSON) and `.so` (a ship entry: put onto an existing corvette, which keeps its name and build); the owner's `.txt` corvette builds. Checked on the owner's Death n Glory files
- [x] Confirmed against a `.so` written by TAZ itself (owner, 2026-10-29): it reads as a corvette loadout, and our new .so export (Starships and Dock Yard) writes the same format byte for byte
- [x] Each entry can store a link (Charon, NMA or anywhere) and notes
- [x] Pull artwork, author and description from a linked listing (Dock Yard: "Get art from the link")
- [x] Search, type and tag filters, tags and favourites

## Phase 3 — Visuals: Cover Flow and the overall look [2] [9]

- [x] Cover Flow browser (iTunes-style: scroll, drag, arrow keys, slider) — shipped as the Hangar page and as the picker on Starships and Multi-tools
- [x] Cover Flow in the Dock Yard (Garage, Ship storage, favourites), with a Cover Flow / Grid switch on every cover page
- [ ] Cover Flow for the Testing Facility once it exists; profiles have no pictures yet, so they stay a list
- [x] Corvette hologram as solid blocks at each part's real size from the game files, coloured by part type with a key in the Hangar (2026-10-30)
- [x] Generated covers: corvettes render as a rotating hologram of their real part layout; other ships and multi-tools get a type silhouette on a nebula seeded by the item's own seed
- [x] Drop a screenshot on any cover (or use Set cover image) to replace it; kept in the app's browser profile
- [x] Real renders of corvettes: the desktop app runs the owner's Blender with Charon Forge's part models in the background (Render with Blender / Render all corvettes) and caches each PNG by a hash of the build, so a cover re-renders only when the build changes
- [ ] Corvettes in 3D from the game files alone: tried 2026-10-30 and taken out. A corvette part's placement scene is only a bounding box, snap points and every variant mesh at once; the visible hull (wings, cockpits, structural shells, `_BIGGS_*` parts) is chosen by the game at run time from snap-point conditions on each part's neighbours (entity files, `GcSnapPointCondition`/`GcOutSnapSocketCondition`). Would need those rules worked out first; Blender + Charon Forge renders stay the way to get a real picture
- [x] Covers for regular ships and multi-tools from the owner's own No Man's Sky screenshots: the app lists Steam's screenshot folder for the account (or a folder set in Cover settings), and a square crop frames the ship. Any image file or drop goes through the same crop
- [x] Default covers are turning wire-grid holograms of generic shapes of our own (fighter, hauler, explorer, shuttle, exotic, living ship, solar, interceptor, freighter, exocraft; pistol, rifle, staff), not copies of the game's models
- [x] Real ship, multi-tool, freighter and exocraft models read from the owner's own game files (scene trees, referenced parts, geometry streams) and drawn as a shaded WebGL hologram that turns on the centre cover; the wireframes stay as the fallback
- [x] Parts picker for procedural models (cockpit, wings, engines, barrels...), remembered per ship; the seed's default is a stable guess, since the game's selection code isn't in its files
- [x] Parts picker shows a picture of each part, nests parts under the choice they belong to, and names them plainly (Accessory on grip, Magazine barrel…)
- [x] Biome odds checked against the real game table; lush and empty galaxies use their own yellow-star lists
- [x] Name the parts better than the game's internal labels, with a picture per option (2026-10-30)
- [ ] Their look is generated in-game from the seed, so it can't be rendered outside the game; artwork for fixed-look specials (Golden Vector, Atlas Sceptre, Starborn ships) could come from the web later
- [x] Artwork from a linked Charon/NMA listing
- [x] Turntable: cover cards (Overview, ship pages, Dock Yard details) turn while hovered and follow a drag
- [x] More camera angles per corvette: front, side, back and top render together on request, picked in the Hangar (2026-10-30)
- [x] Automatic corvette renders: corvettes without a cover are rendered in the background when a save opens (setting in Cover settings, 2026-10-30)
- [x] Shipwright: Load a corvette from a .blend (Charon Forge's serialiser when installed; the corvette the file is set to is chosen) (2026-10-30)
- [x] Custom covers live on disk in `Dock Yard\Covers` (with `covers.json`); ones the app kept in the browser profile move there by themselves
- [x] Stretch: a 3D preview of a corvette from its part list. Done as the solid-block hologram at real part sizes (2026-10-30); the true hull needs the snap rules above
- [x] Glacial look to match the Portal Glyph Banner: icy light theme, deep-teal dark theme (toggle, remembered), Jost, pill buttons, wide-tracked titles; no yellow or purple anywhere
- [x] Cover Flow motion: spring physics, 1:1 drag with momentum, continuous trackpad/wheel glide, covers swing smoothly through the centre
- [x] Neutral text (dark gray / white) with a Spectrum accent per section, chosen by the owner
- [x] Item icons and names in every inventory, Goatfungus-style (icon, name, amount/max): the desktop app finds the owner's `NMSSaveEditor.jar` by itself and reads them from it in place
- [x] Graphic-heavy pass across the rest of the app: class colours, ship and tool art, inventory grids as the visual centre (quieter empty slots, lifted filled ones, class badges, one Export menu, section glow behind page titles)

The save file holds no images, so a ship's picture has to come from one of these sources.

## Phase 4 — Corvettes: easy loading and the live Blender link [1] [11]

- [x] Map exactly how a corvette is stored: the PlayerShipBase whose UserData is the ship's slot, plus the slot's CharacterCustomisationData entry
- [x] Import and export TAZ's `.nmsship` (Ship library and the ship details' Export .nmsship); part fields are put back in the game's order on import
- [x] **Shipwright** (our own take on TAZ's optimizer, right under Overview): Tune up puts parts in the priority order TAZ documents (Rockhopper wings, reactors, thrusters/boosters/wings, weapons, shields, landing gear, landing bays, cockpits, everything else; stable, so cockpit and bay order are kept); build check (cockpits, beam-up bay scale ≥ 0.058, order, exact duplicates, builds pointing at the wrong slot); Copy all / Paste all (whole build, Objects or a single part) / Load file / Save as .json or .nmsship; part list with names, groups, search, move and delete; Build JSON with Apply
- [x] Add corvette / Delete corvette in Shipwright (owner, 2026-10-29): a corvette ship entry copied from one in the save (C class, empty inventories, new seed) plus a starter build of the essentials (reactor, thruster, weapon, landing gear, landing bay, cockpit, walkway, Paragon core) to paste a real build over
- [x] Ship slot manager (Starships page): swap slots by drag or click, close gaps; a ship's build, colours, customisation, current-ship marker and corvette-workshop link move with it. Repairs: builds pointing at empty, missing or non-corvette slots, several builds on one corvette, corvettes without a build, current ship on an empty slot (the first fix offered never deletes a build)
- [x] BBA's `.nmsprefab` (load into Dock Yard/Shipwright, "Add a prefab" on Bases)
- [x] Bases from Blender instead of `.nmsbase` (the owner has none; their Base Builder `.blend` files hold the whole base): "Load from a .blend…" on the Bases page puts a file's parts on the base it names, and LiveLink works for bases too, with the same wrong-target checks (2026-10-30)
- [x] **Live Blender link**: Ctrl+S in Blender writes the build straight into the chosen corvette in your save, through the Harmonious LiveLink add-on (Charon Forge or the Base Builder add-on reads the scene). Turned on per corvette in Shipwright while the editor is open
- [x] Every live update is backed up, so any version can be rolled back
- [ ] To test early: whether No Man's Sky picks up the new file when you load the save from the main menu, and how Steam Cloud reacts to a file changing outside the game

- [x] Supercharge slots (owner, 2026-10-29): button next to Unlock all slots on exosuit and starship technology, per-slot toggle and multi-select; exocraft technology too (owner, 2026-10-29); supercharged slots get a steady electric edge and bolt badge; the lightning crackles on hover or selection and once when a slot is charged (owner found a fully charged grid too busy)

## Phase 5 — Cargo and Loadout Ops [7]

- [x] Find an item across every inventory (exosuit, ships, freighter, storage containers, exocraft) and see where every stack is (Cargo page, Where is everything), and gather every stack of it into one inventory
- [x] Consolidate: pick a destination, see the plan, untick anything to leave alone, then apply. Stack limits are each stack's own limit (the game sets them from the difficulty's stack-size setting)
- [x] Select several slots (Ctrl-click, Shift-click, Ctrl+A) and fill, repair, remove, unlock or move them to any other inventory in one go
- [x] Drag and drop between slots of any grids on the same page: same item merges, different items swap, technology only rearranges within its own grid. Moving to another inventory (side panel) now tops up matching stacks first
- [x] Drag a box across empty slots to select a block (Ctrl adds)
- [x] Rewards page: every expedition reward (past and current, read from the game's tables), Twitch drops and platform rewards; unlock all at once, a whole expedition, or single rewards; saved to `accountdata.hg` with its own button and a backup (the app may now read and write only that pair besides saves)

## Own item library (so Goatfungus isn't needed)

- [x] "Build item library from your game": reads the owner's No Man's Sky install (HGPAK archives, zstd), the product/substance/technology/procedural tables and English text (MBIN), converts icons (BC7 DDS) to PNG, caches it all in the app folder. Built automatically on first start, rebuilt after a game update. 5,400+ items; names resolve for IDs Goatfungus lacks (e.g. HULK_REACTOR → Fuel Rod)
- [x] `tools/extract-nms-item-files.bat`: collects the tables, English text, an icon sample and the full pak file list from the owner's install (via HGPAKtool) so the reader can be built against real files
- [x] Tech packs stored as hashed IDs get names (`techPackId`, the game's joaat hash)
- [ ] Goatfungus's jar stays as a fallback

## Phase 6 — Streamlined editing (no more digging through JSON) [4]

- [x] Plain-language editors for the sections people actually change: bases (rename, place, parts in and out, delete), frigates (on the Freighter page), settlements, companions, known technology, recipes and cosmetics, words for every race, standing and journey milestones, difficulty settings (preset also written to the meta file for the load menu), current location (Coordinates)
- [x] "Find anything" box (sidebar, Ctrl+K): ships, multi-tools, exocraft, bases, corvettes, settlements, frigates, companions, settings, standings and every item in every inventory; Enter jumps to it
- [x] Raw data stays available as the expert fallback (the last find result searches it)
- [ ] Companion battle stats (class overrides, treats, moves): their keys aren't in libNOM's mapping yet, so they stay in Raw data
- [x] Check the standing rank names against a real `leveledstatstable.mbin` (2026-10-30: the layout matches and every rank name resolves, e.g. Gek Trade Lord, Vy'keen Templar, Korvax Traveller of the Atlas)

## Phase 7 — Coordinates and planets [8] [10]

- [x] Coordinate selector: enter glyphs (tap or type), a portal code or nmsportals link, or a signal-booster address, and see the same place in every form, with the galaxy, address facts (black hole, Atlas, purple star, distance to centre) and what the save knows there (discoveries, bases, stations). Your places picker lists every base and teleport destination
- [x] Warp: sets the location, keeps the old one as the previous location and arrives in the ship in space (same fields as Goatfungus)
- [x] Predicted system for any address, visited or not: system, region and planet names, star colour, planets and moons, race, economy and wealth, conflict, pirate/abandoned/uncharted, station prices (nms-core / nms_namegen, MIT; about 99% against 1,000 player-recorded systems)
- [ ] Predicted planet details: biome, weather, resources, sentinels, flora and fauna. Our own research (owner 2026-10-30; ATLAS APF not used):
  - [x] Biome of planets you've discovered, from discovery records (`VP[1]` low 16 bits = GcBiomeType, bit 16 = infested), shown in the planet table
  - [x] Biome odds per star colour from the owner's own `METADATA/SIMULATION/SOLARSYSTEM/BIOMES/BIOMELISTPERSTARTYPE.MBIN` (GcBiomeListPerStarType), labelled as odds; checked against the real file 2026-10-30, and lush and empty galaxies use their own yellow-star lists
  - [x] Per-planet biome odds (2026-10-30): prime bodies use the prime list and Dead can turn Exotic; matches all 1,487 discovered planets in the owner's save
  - [ ] Exact biome: tried 2026-10-30 against the 1,487 planets (planet seed, the system's stream after the planet seeds, name transform, address hash; several generators and draw positions): nothing beats chance. Needs the draw order from the game's solar-system generator (disassembly)
  - [ ] Weather, sentinels, resources, flora and fauna need planet generation itself (much harder, no labelled data beyond what players note down)
- [x] Arrive on foot at a base (Coordinates, "Arrive at a base"): works in any system the app has seen a save made in
- [x] Arrive on the freighter (Coordinates, "Arrive on your freighter"): calls the freighter to the system and spawns you aboard
- [x] Place card: Copy card (a PNG with glyphs, address, system, race, economy, conflict and planets), Save card, or Copy as text, on the Coordinates page

What these can show is limited by the game: planets are generated by the game itself, so the editor can't draw what a planet looks like. Names and qualities come only from what's in the save (your own discoveries). What the save holds (checked on the owner's save, 2026-10-29): planet discovery records carry a type, the planet seed, the biome and a packed address, no names or resources; bases and teleport destinations carry names. The system itself (names, planets, race, economy) is predicted from the address with nms-core; planet details aren't yet.

## Open questions for the owner

- ~~Where does the downloaded ship collection live, and in what formats?~~ Answered: linked folders in the Dock Yard (`.txt` builds, `.nmsship`, `.so`, JSON), 2026-10-29
- ~~Should the Blender link go into Drydock itself, or be a separate small add-on?~~ Answered: the separate Harmonious LiveLink add-on, working with Charon Forge and the Base Builder, 2026-10-30
- Which test characters (save slots) are used for the Testing Facility?

## Learned from the real save (2026-10-28)

- Corvettes are ships whose model is `MODELS/COMMON/SPACECRAFT/BIGGS/BIGGS.SCENE.MBIN`. Their build lives in `PersistentPlayerBases` as a `PlayerShipBase` whose `UserData` equals the ship's index in `ShipOwnership`.
- Each part is `{Timestamp, ObjectID, UserData, Position, Up, At}`. `|Up|` is the part's scale; `Up` and `At` give its orientation. Part `UserData`: colour = `UserData & 0xFFFFFF` (palette index), finish = `(UserData >> 24) & 0xFF` (per Charon Forge's resources/COLOURS.md and colours.json).
- Several corvettes can share one ship seed; the seed doesn't identify a corvette.
- Ship entries carry an unmapped key `FA8` (an empty array in this save).
- Builds in this save: Formula1c 509 parts, Yautja Claw 753, The Cutting Remark 2,091, Max 2,921.
- [x] Other resources in the sidebar (Portal Glyph Banner, Traveller credentials) and a glyph banner link on Coordinates
- [x] Notice new saves the game writes while the app is open (save list refreshes; an open save offers the newer one)
- [x] Overview location card: portal digits sit under their glyphs on one line
- [x] Sidebar in tinted groups of related pages, in the owner's order
- [x] Hangar above Dock Yard in the sidebar
- [x] Close buttons in the top-right corner of every dialog
- [x] Add a ship (new corvette or a copy), Add a multi-tool (copy), Add exocraft (geobay blueprints), Add a companion (copy)
- [x] Render corvettes on the Starships page
- [x] Archived ships: listed under Ship slots, restore into an empty slot, archive a ship, delete from the archive
- [x] Update check: a newer published version is offered on start (About has Check for updates); the app downloads, checks and swaps itself, then restarts
- [x] Dock Yard ship card: actions grouped under the picture (Use, Picture, Export, File)
- [x] Settlements split into Owned and Visited; other players' settlements are view only
- [x] Overview: Quick fixes moved under the traveller cards as one thin bar
- [x] Panel and field descriptions moved behind "?" tips; page descriptions stay visible
- [x] Cover Flow is the default view again for everyone
- [x] LiveLink: turning it on asks to open the corvette's .blend in Blender; each corvette remembers which .blend its build came from; the link ends when the editor closes
- [x] LiveLink wrong-corvette guard: each .blend remembers its corvette (picked from a list in the Blender add-on, which warns when you switch); the editor asks before writing a build meant for another corvette or from a .blend it hasn't seen
