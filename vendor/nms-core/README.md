# nms-core (vendored)

Game-accurate system and name generation for No Man's Sky: star colour, planet and moon counts, system, region and planet names, economy, wealth, conflict, race, pirate/abandoned/uncharted flags and buy/sell percentages, all from a portal code and galaxy.

- JavaScript port: https://github.com/elegra1965-source/nms-core (MIT, elegra1965), commit f8eeef324859fb9003618c3c8f0356794991a0eb
- Reverse-engineered algorithms: https://github.com/hadsh/nms_namegen (MIT, Stuart Coyle, hadsh and GoodGuysFree), commit 52ad48affaa4089c8f487a470a888dc9b7a650aa
- `sellBuy()` in system.js is elegra1965's own work (No Man's Sky Hub, https://nomansskyhub.app).

Both licences are in this folder. The files are unchanged copies of these eight modules plus `letter-map/`. `build.js` bundles them into the page and gzips the letter map. Not used: `economy.js` (its word tables are placeholders), the biome/sentinel adornments in `planetName()`'s optional `opts`, and `sizes` from `planetSeeds()` (not validated per planet upstream).

To update: copy the same files from a newer nms-core checkout, then run `node test/test_systemgen.js`.
