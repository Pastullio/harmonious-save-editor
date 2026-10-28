# Roadmap

The owner's wishlist (2026-10-28), sorted into phases. Each phase ships as a new `.exe` that gets tested on a spare save slot before the next one starts. Numbers in brackets point back to the original list.

New features are built for the desktop app. Most of them need to keep files on disk (a ship library, artwork, profiles) or stay running in the background, which the browser version can't do.

## Before phase 1: real files to learn from

Everything so far was tested on a synthetic save. These files decide how several features get built:

- [ ] A real save pair (`save.hg` + `mf_save.hg`) with at least one corvette and a fitted ship (e.g. The Cutting Remark)
- [ ] `accountdata.hg` + `mf_accountdata.hg` (expedition and Twitch reward unlocks live there) [7]
- [ ] One corvette exported from TAZ's optimizer (`.nmsship`, plus a `.json` if you have one) [11]
- [ ] One build exported from Blender / Drydock [1]
- [ ] A few files from the downloaded ship collection, whatever formats they're in [5]

## Phase 1 — Loadout profiles (the owner's biggest win) [3]

Save a ship's or multi-tool's whole fit as a named profile ("S-class corvette loaded up"), then apply it to any other ship or tool in one click.

- [ ] A profile captures: class, slot counts and which slots are unlocked, every technology module with its exact slot position, charge and damage state, and the general/cargo layout if wanted
- [ ] Apply: unlock and resize the target to match, then place the tech exactly as in the source
- [ ] Profiles for multi-tools as well as starships; corvettes once their structure is mapped
- [ ] Profiles are files on disk, so they can be shared with other players
- [ ] Preview before applying: what will be added, replaced, or removed

## Phase 2 — Ship library: Hangar, Garage and Testing Facility [3] [5] [6]

One personal library of ship files outside the game, with three views onto it.

- [ ] **Hangar**: your own collection (the hundreds of downloaded ships). Swap a ship into an empty or chosen slot, or pull a ship out of the game into the library
- [ ] **Garage**: every ship that has been in any of your saves, captured automatically when a save is opened, so nothing is ever lost
- [ ] **Testing Facility**: ships you're testing for other creators, kept apart from the main library. Versions of the same ship are grouped, each with test notes, a date, and which test character it's on
- [ ] Import the formats in the collection (`.nmsship`, `.json`, `.so` tech files)
- [ ] Each entry can link to a Charon or NMA listing to pull artwork, author and description
- [ ] Search, tags and favourites

## Phase 3 — Visuals: Cover Flow and the overall look [2] [9]

- [ ] Cover Flow browser (iTunes-style, scroll and flick) for the Hangar, Garage, Testing Facility, multi-tools and profiles
- [ ] Artwork, in order of preference: a picture captured from Blender when a build is saved; artwork pulled from a linked Charon/NMA listing; a screenshot you drop in; an auto-generated card from the ship's class, type and colours as the fallback
- [ ] Stretch: render a 3D preview of a corvette from its part list using the Base Builder part models already on your PC
- [ ] Graphic-heavy pass across the whole app: item icons everywhere, class colours, ship and tool art, inventory grids as the visual centre

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
- [ ] Bulk moves between inventories
- [ ] Unlock expedition rewards and Twitch drops (these live in `accountdata.hg`, so the app gains carefully limited write access to it)

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
