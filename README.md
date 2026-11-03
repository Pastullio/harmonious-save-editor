<p align="center"><img src="docs/logo.png" alt="Harmonious Save Editor" width="560"></p>

# Harmonious Save Editor

A save editor for No Man's Sky on PC (Steam and GOG, Frontiers 3.60 or newer). Edit your traveller, ships, corvettes, bases and inventories. Keep a library of every ship you've owned. Find places by portal glyphs and warp there. Build corvettes and bases in Blender and send them straight into your save.

Nothing is uploaded anywhere. Item names and icons come from your own copy of the game.

**New here? Open the [user guide](dist/Harmonious%20Save%20Editor%20Guide.html)** (download it and open it in your browser, or press **Guide** in the app): every page of the editor, with screenshots.

- [Getting started](#getting-started)
- [How saving keeps your data safe](#how-saving-keeps-your-data-safe)
- [The sections](#the-sections)
  - [Overview](#overview) · [Shipwright](#shipwright) · [Coordinates](#coordinates) · [Garage](#hangar) · [Dock Yard](#dock-yard)
  - [Exosuit](#exosuit) · [Multi-tools](#multi-tools) · [Starships](#starships) · [Freighter](#freighter) · [Exocraft](#exocraft) · [Companions](#companions)
  - [Bases](#bases) · [Storage](#storage) · [Cargo](#cargo)
  - [Knowledge](#knowledge) · [Rewards](#rewards) · [Standing](#standing) · [Difficulty](#difficulty)
  - [Item names](#item-names) · [Raw data](#raw-data)
- [Things that work everywhere](#things-that-work-everywhere)
- [Blender: renders and LiveLink](#blender-renders-and-livelink)
- [The browser version](#the-browser-version)
- [For developers](#for-developers)
- [Credits](#credits)

## Getting started

1. Download **`dist/Harmonious Save Editor.exe`** from this repository. It's one small program with no installer. `dist/Harmonious Save Editor Guide.html` next to it is the user guide; the app also opens it from **Guide** on the save list and **User guide** in the sidebar.
2. Run it. Windows SmartScreen warns the first time because the exe isn't code-signed: choose **More info**, then **Run anyway**.
3. The editor finds your saves in `%APPDATA%\HelloGames\NMS` and opens in its own window. Pick a save.
4. On first start it builds an item library from your No Man's Sky install (about a minute). That's where item names, icons and descriptions come from.
5. Make your changes, then press **Save to game** at the bottom of the sidebar.

**Close No Man's Sky before saving.** The editor warns you if the game is still running. Steam Cloud can also restore an older copy if it syncs before the game starts.

The app updates itself. When a new version is out it offers to install it, checks the download, swaps itself over and restarts.

**Pin it to the taskbar** from its own taskbar button (right-click, **Pin to taskbar**): it shows the editor's icon, not Edge's. If an older pin shows Edge's icon, unpin it and pin again. You can also right-click the exe in Explorer and choose **Pin to taskbar**.

**Exported files** (ship and multi-tool backups, `.nmsship`, `.so`, place cards…) go to `Documents\Harmonious Save Editor\Exports`, and the folder opens in Explorer with the file selected. Nothing is ever overwritten: a second file with the same name gets `(2)` added.

## How saving keeps your data safe

- **Backups every time.** Before replacing a save, the app copies the current pair to `%LOCALAPPDATA%\HarmoniousSaveEditor\backups\<account>\<time>_saveN`. **Show backups** in the sidebar opens that folder.
- **Back up all saves** on the save list zips every slot into `Documents\Harmonious Save Editor backups`.
- **Copy to a new slot** on the save list copies a save into an empty slot. It never overwrites one.
- **Checked before writing.** The new save is decoded again and compared with what's in the editor; if anything differs, nothing is written.
- **Nothing changes by accident.** An unedited save re-encodes to exactly the same data: key order, number spelling and special bytes are all kept.
- **New saves from the game.** While a save is open, the editor notices when the game writes a newer one and offers to open it. It asks first if you have unsaved edits.
- **Locked to your PC.** The app only listens on 127.0.0.1 with a random token per run, so other web pages can't talk to it. It quits a few seconds after you close its window.

## The sections

The sidebar groups the sections the way you'd use them: getting around and your fleet; what you carry and ride; where things are kept; progress and settings; and tools.

### Overview

Your traveller at a glance.

- **Traveller cards**: your portrait (pick one of your screenshots or any image), current ship, multi-tool and location, with portal glyphs and galactic address.
- **Journey**: discoveries and the milestones the game counts.
- **Currencies**: units, nanites and quicksilver, with +1M, +100M and Max buttons.
- **Save name** as it appears in the game's load menu.
- **Quick fixes** for every inventory in the save at once: **Repair all technology**, **Recharge all technology** and **Fill every stack**.

### Shipwright

Corvette build tools.

- **Tune up** puts a corvette's parts in the order the game reads them, so performance parts aren't listed too late and lose stats. The order follows TAZmd's documented priority list; the camera cockpit, boarding cockpit and beam-up bay stay where they are.
- **Health check** for each build: no cockpit, no landing bay, a beam-up bay scaled too small to work, parts out of order, or parts stacked exactly on top of an identical part (with a one-click fix).
- **Copy and paste builds**: copy all parts or just the build, and paste a build from TAZ's tools, another corvette or a file. Pasting replaces only the parts; the corvette keeps its name, class and owner.
- **Save to a file** and **Save as…** for builds.
- **Load from a .blend…** reads a Charon Forge corvette file straight from Blender (see [Blender](#blender-renders-and-livelink)).
- **Add corvette** creates a new corvette in an empty ship slot with a starter build.
- **LiveLink** from Blender: save your `.blend` and the corvette updates in your save.

### Coordinates

Find a place by its portal glyphs or galactic address, see what your save knows about it, and warp there.

- **You are here**: your current system, galaxy, portal glyphs and galactic address. **Start from here** copies it into the destination.
- **Destination**: type or click portal glyphs, or enter a galactic address. Both stay in step.
- **System prediction**: the system's name, region, star colour and planets, worked out from the address.
- **What your save knows**: the system and planet names you've discovered, biomes from your discovery records, and your bases there.
- **Biome odds**: the chances of each biome for every planet, from the game's own table, by star colour and galaxy type (lush, harsh, empty or normal). The bodies the game adds after a system's regular planets use their own odds.
- **Place card**: a picture of the destination's glyphs and details to share (**Save card**, **Copy card**, **Copy as text**).
- **Warp here** puts you in your ship at the destination. **Arrive here** lands you at one of your bases there, and **Arrive on your freighter** puts you aboard with the freighter in that system.

### Garage

Your ships, multi-tools and corvettes as cover art.

- **Cover Flow** (scroll, drag or use the arrow keys) or a **Grid**, with filters for corvettes, starships and multi-tools.
- **Covers**: a 3D model of each ship and multi-tool read from your game's files, which spins on hover and turns when you drag it. **Change picture** to drop in an image or choose one of your in-game screenshots.
- **Choose parts** picks which hull, wings and other options the model shows. Each choice appears as a tile with its own picture.
- **Corvettes** show as a hologram of their build: each part as a block at its real size, coloured by type (cockpit, engines and wings, weapons, shields, reactors, landing gear, bays, hull and decor). With Blender and Charon Forge installed you get real renders instead, with **front, side, back and top views** (see [Blender](#blender-renders-and-livelink)).
- **Render all corvettes**, and **Cover settings** to point the app at Blender and choose automatic renders.
- **Open loadout** jumps to that ship's editor.

### Dock Yard

Every ship you own, build or download, in one place, kept in `Documents\Harmonious Save Editor\Dock Yard`.

- **Pick a ship to work on it**: a ship in the open save says **Loaded, slot N** on its cover (loaded ships come first, in slot order), and the bar above the covers shows what you can do. **Edit ship** opens it on Starships (and **Edit build** opens a corvette in Shipwright); a ship that isn't in the save has **Load ship into game…**; **Details** opens its card. In the grid each card shows **Loaded, slot N** with **Edit ship**, or **Load ship into game…** (it goes into the open save; **Save to game** writes it).
- **Hangar**: fills itself. Every ship in every save you open is copied here, and a ship you replace is copied before it's overwritten, so nothing is lost. Each ship has one card with its versions stacked inside, newest first. A new version is kept only when the ship itself changes (its build, model, name, class, colours or installed tech), not when fuel, charge or cargo do. Copies that only differ in those can be moved to Deleted in one click.
- **Ship storage**: ships you keep on purpose. **Import files** (`.json`, `.txt`, TAZ's `.nmsship` and `.so`, Base Building App `.nmsprefab`) or **Add this save's ships**.
- **Favourites**: ships you star, from anywhere in the Dock Yard.
- **Linked folders**: point the Dock Yard at folders where you already keep ship files. They show up here without being moved or changed. In **Manage folders**, paste a folder's path and press **Add path**, or use **Browse…** (pressing **Add path** with an empty box opens Browse too).
- **Ship cards** with tags, notes and a link to where you found the ship. **Get art from the link** pulls the artwork, author and description from a listing.
- **Load ship into game…** drops a ship or corvette into an empty slot or replaces one. Corvettes bring their build. A build on its own goes onto one of your corvettes, and a `.so` gives a corvette its tech and class while it keeps its build.
- **Export** as `.nmsship` (the whole corvette) or `.so` (the ship entry, as TAZ's tools write it).
- **Search** names, tags and notes; filter by type and tag.
- **Delete** moves files to a Deleted folder, so they can always be brought back.

### Exosuit

Your exosuit's technology and cargo, laid out as in the game. Everything in [Inventories](#inventories) works here, including supercharged slots.

### Multi-tools

Every multi-tool you own.

- **Name, type** (standard, royal, sentinel, atlas, staff and more), **class** and **seed** (with **Generate** for a new look).
- **Base stats**: damage, mining and scanning.
- **Profiles**: **Save as profile** keeps a loadout as a file; **Apply a profile** puts it on another multi-tool. Share a profile by sending the file.
- **Export** a `.json` backup and **Import** it again; **Delete multi-tool** (works even when all six slots are full: the slot is left empty, the way the game leaves one).
- **Add a multi-tool** and **Choose parts** for the cover model.

### Starships

Every ship you own.

- **Name, type** (hauler, explorer, shuttle, fighter, exotic, living ship, solar, interceptor, corvette and the special ships), **class**, **seed** and **use old colours**.
- **Base stats**: damage, shields, hyperdrive and maneuverability, plus ship health and shield.
- **Ship slots** at the top: drag ships into a new order (corvette builds, colours and your current ship move with them), **Close the gaps**, and fixes for problems such as a build that points at the wrong slot.
- **Add a ship**: a new corvette, or a copy of a ship you own with its colours and build.
- **Archived ships**: see the ships the game keeps in its archive, **Restore** one into a slot, or **Archive a ship**.
- **Versions in the Dock Yard** opens the ship's card in the Hangar, with every version kept.
- **To the Dock Yard…** asks whether to **Keep a copy** (the ship stays in your game) or **Move it** (it's stored in Ship storage and its slot is emptied; not for the ship you're flying).
- **Profiles**, **Export** (`.json`, `.nmsship`, `.so`), **Import** and **Delete ship**, as for multi-tools.

### Freighter

Your capital ship and its fleet.

- **Name, type, class and seed** of the freighter, and its base stats (hyperdrive and fleet coordination).
- **Inventories**: technology and cargo.
- **Frigates**: each one's name, type, class, expeditions and damage, its stats and its traits. **Repair every frigate** at once.

### Exocraft

Cargo and technology for each exocraft you've summoned, with a model of each. **Add exocraft** learns the geobay blueprints for the ones you don't have yet.

### Companions

Your creature companions.

- **A picture of each one**: the desktop app draws each companion's real model from your game files, with the head, wings, tail and other parts it was born with. The model also shows beside its name in the list. **Change picture** uses a screenshot or any image instead.
- **Name, size, trust, temperament and mood**, as sliders.
- **Fed, happy and fully trusting** in one click.
- **Add a companion** to an empty slot.

### Bases

Your bases and settlements.

- **Bases**: name, place and parts. **Copy parts** and **Paste parts** between bases, **Add a prefab** from the Base Building App, **Load from a .blend…** from NMS Base Builder, and **Delete base**. LiveLink works for bases too.
- **Settlements**: an **Owned** and a **Visited** tab. For settlements you run: name, stats (population, happiness, production, upkeep, sentinels, debt, alerts and bug attacks), perks (**Remove the negative perks**), and **Clear debt, alerts and bug attacks**. Settlements you've only visited belong to other players and are shown read-only.

### Storage

Base storage containers and the other standalone inventories in the save, each with the full set of [inventory tools](#inventories).

### Cargo

Every stack in every inventory, in one place.

- **Find** where an item is, across exosuit, ships, freighter, exocraft and storage.
- **Gather** one item into a single inventory.
- **Consolidate**: tidy partial stacks into one inventory. You see the plan (what moves where) before anything happens. Special lockers are left alone unless you include them.
- **Drag and drop** stacks between slots and inventories. Matching stacks are topped up first. Technology always stays in its own inventory.

### Knowledge

What your traveller has learned.

- **Technology and base parts**: the blueprints you know. **Learn…** adds one, **Learn all technology** or **Learn all base parts** adds everything your game lists, and you can forget ones you don't want.
- **Words**: alien words per race. **Learn every word, every race**.

### Rewards

Every expedition reward, past and current, plus Twitch drops and platform rewards.

- **Unlock this expedition's rewards**, single rewards, or everything at once.
- Rewards live in a separate account file, so they have their own save button. You collect them in the game on the Space Anomaly.
- **Quit the game before saving rewards.** The game reads them only when it starts and writes its own copy back when it saves. The editor notices if the game takes rewards back and tells you why.
- Platform rewards (a Switch pre-order, The Game Awards) are checked against the store you play on, and the game removes them on PC, so **Unlock all rewards** leaves them alone.
- Some unlocked rewards from older expeditions, eggs and multi-tools in particular, may not claim even with free slots. That's the game, not the save: the editor's empty slots are the same as the game's own.

### Standing

Your reputation with each race and guild, and the journey milestones the game counts. **Max every standing** in one click, or set each one, with the game's rank names shown.

### Difficulty

The game's difficulty settings, the same ones as its options menu, including those it only lets you pick when starting a new game. **Make everything easy** and **Back to normal** set them all at once.

### Item names

Where item names, icons and descriptions come from.

- **Build item library** reads your game's own files and keeps the names and icons on your PC. It rebuilds itself after a game update. Point it at your No Man's Sky folder if Steam doesn't find it.
- Goatfungus's `NMSSaveEditor.jar` works as a fallback until your library is built: the app can search your PC for it.

### Raw data

Every value in the save, translated from the game's short keys (the original key is shown beside each one). Search keys and values, edit any value, and **Export JSON** or **Import JSON**.

## Things that work everywhere

### Inventories

Every inventory grid (exosuit, ships, multi-tools, freighter, exocraft, storage) has the same tools:

- **Technology / Cargo / Both** switch, laid out as the game shows them, with item icons, names and amounts.
- **Add an item**: click an empty slot, type part of its name (Carbon, Orbital Exocraft Materialiser…) and press Enter or click a result. It goes in as a full stack, sized like the game sizes that inventory. Cargo takes anything; a technology grid only offers technology that fits it (exosuit, multi-tool, freighter, each kind of ship and exocraft), with **Show all technology** to lift that. **Add by item ID** is there too.
- **Click a filled slot** to see the item, change its amount, fill the stack, replace it or remove it.
- **Drag and drop** stacks; drag a box across empty slots to select several and move them together.
- **Unlock all slots**, **Fill stacks**, **Repair**, and **Size and class** to resize an inventory or change its class.
- **Supercharge slots** on exosuit, starship, multi-tool, freighter and exocraft technology.

Each page's own buttons (**Add a ship**, **Add a multi-tool**, **Render corvettes**, **Add a companion**…) sit in a row just above what they work on, on the left; on pages with covers the **Cover Flow / Grid** switch is on the right of the same row.

### Your own sidebar

The customise button at the bottom of the sidebar (lines with a pencil) lets you drag pages up and down or into another group, move groups with their arrows, and hide pages you never use with the eye. Hidden pages still turn up in **Find anything**. **Reset to default** puts it back. The layout is kept between sessions, and pages added in later updates show up in their usual group.

### Find

Press **Ctrl+K** (or use the box at the top of the sidebar) to jump to any ship, base, frigate, companion, setting or item in your inventories.

### Look

A dark mode and a light mode (the theme button at the bottom of the sidebar), and a "?" beside anything that has more to say.

## Blender: renders and LiveLink

These need [Blender](https://www.blender.org) (4.2 or newer) with [Charon Forge](https://github.com/xX-Charon-Xx/charon_forge) for corvettes, or NMS Base Builder for bases. The app finds both on your PC and never includes anything from them.

- **Corvette renders**: real pictures of your corvettes, made by your Blender in the background. Renders are cached, so a build is only rendered once. Turn on **automatic renders** in Cover settings and new corvettes get a picture a few seconds after a save opens. **Render the other angles** adds front, side, back and top views.
- **Load from a .blend…**: on the Shipwright and Bases pages, read a corvette or base straight from a `.blend` file, without opening Blender yourself.
- **LiveLink**: get the Blender add-on from the LiveLink panel (**Get the Blender add-on**). Turn LiveLink on for a corvette or base, then every time you save in Blender (or press **Send now** in the Harmonious tab), the build goes into your save. The app backs up the save each time. Both sides show that they're linked. Each `.blend` remembers which corvette or base it's for, and the editor asks before putting a build somewhere else. **Open in Blender** opens the file a corvette was last built from.

## The browser version

`dist/nms-save-editor.html` is the same editor as a single web page for Chrome or Edge. It edits saves but can't do the parts that need your PC: the Dock Yard, renders, LiveLink and reading your game files (it can use Goatfungus's jar for item names instead).

- **Folder mode**: choose `%APPDATA%\HelloGames\NMS` or the `st_…` folder inside it. Chrome blocks AppData for web pages, so you may need to copy the folder somewhere else first, which is why the desktop app is the easier option. Saving copies the current pair into `_editor_backups\<timestamp>_saveN\` first.
- **File mode**: drop both files (`saveN.hg` and `mf_saveN.hg`); the edited pair downloads and you copy it back.

## For developers

### Building

```
node build.js            # dist/nms-save-editor.html + desktop/index.html
./build-desktop.sh       # dist/Harmonious Save Editor.exe (Go 1.22+)
```

### Testing

```
python3 test/make_fixture.py <dir>     # synthetic save built with python-lz4 + a literal port of libNOM's meta crypto
node test/test_codec.js <dir>          # codec round-trips against those references
node test/test_ui.js <dir> <shots>     # end-to-end in headless Chromium, file mode
node test/test_folder.js <dir>         # folder mode with a mocked File System Access API
```

More end-to-end tests for each feature are in `test/e2e`. `CLAUDE.md` describes the code layout and `ROADMAP.md` the plans.

### Format notes

- **Data file**: 512 KiB chunks, each `E5 A1 ED FE` + u32 compressed size + u32 decompressed size + u32 0, then an LZ4 block. The JSON ends with a NUL.
- **Meta file**: XXTEA over little-endian u32 words, 8 rounds for 104-byte metas and 6 otherwise. The key's first word comes from the storage slot (`save.hg` = 2, `save2.hg` = 3, …). The editor decrypts, patches only the decompressed size, the on-disk size, the timestamp and the save name, and keeps every other byte untouched.
- **JSON** is parsed losslessly: key order, number spelling (`1.0`, 64-bit integers), string escapes and raw tech-pack ID bytes all survive.

Format details are ported from [libNOM.io](https://github.com/zencq/libNOM.io) and the key names come from [libNOM.map](https://github.com/zencq/libNOM.map), both GPL-3.0.

## Credits

- [libNOM.map and libNOM.io](https://github.com/zencq) by zencq: save keys and format
- [MBINCompiler](https://github.com/monkeyman192/MBINCompiler) by monkeyman192 and contributors: game table layouts
- [HGPAKtool](https://github.com/monkeyman192/HGPAKtool) by monkeyman192: game archive format
- [Charon Forge](https://github.com/xX-Charon-Xx/charon_forge) by xX-Charon-Xx: corvette renders and builds from Blender
- TAZmd's [corvette optimizer](https://tazmd.nl/corvette-optimizer) notes: the part order the game reads
- [nms_namegen](https://github.com/hadsh/nms_namegen) by Stuart Coyle, hadsh and GoodGuysFree, and its JavaScript port [nms-core](https://github.com/elegra1965-source/nms-core) by elegra1965: system and planet prediction (MIT, in `vendor/nms-core`)
- Pillow (texture decoding), klauspost/compress (zstd), Jost by indestructible type* (typeface)

Free software under GPL-3.0. Not affiliated with Hello Games.
