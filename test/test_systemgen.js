// System prediction: the bundled nms-core must give exactly what the Python reference (hadsh/nms_namegen,
// commit in vendor/nms-core/README.md) gives for 300 random addresses across galaxies, plus a system checked
// in the game by the owner (ATLAS APF screenshot, Eissentam 115A30E59ECB). Usage: node test/test_systemgen.js
const fs = require('fs'), path = require('path');
const { bundle } = require('../tools/bundle-nms-core.js');
const G = new Function(bundle() + '\nreturn NMSGEN;')();
const lm = {}; for (let i = 0; i < 8; i++) lm[String(i)] = JSON.parse(fs.readFileSync(path.join(__dirname, `../vendor/nms-core/letter-map/letter_map_${i}.json`)));
const keys = ['planet_count', 'prime_planet_count', 'gas_giant', 'star_type', 'economy_type', 'wealth', 'conflict_level', 'dominant_race', 'uncharted', 'abandoned', 'pirate'];
const sortObj = (o) => Object.keys(o).sort().reduce((r, k) => ((r[k] = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? sortObj(o[k]) : o[k]), r), {});
let fails = 0, n = 0;
for (const line of fs.readFileSync(path.join(__dirname, 'fixtures/systemgen-nms_namegen.jsonl'), 'utf8').trim().split('\n')) {
  const want = JSON.parse(line), pc = BigInt('0x' + want.code), gal = want.gal, a = G.systemAttributes(pc, gal);
  const attrs = {}; for (const k of keys) if (k in a) attrs[k] = a[k];
  const got = sortObj({ code: want.code, gal, sys: G.systemName(pc, gal, lm), region: G.regionName(pc, gal, lm), attrs, planets: G.planetSeeds(pc, gal).planet_seeds.map((s) => G.planetName(s, null, lm)) });
  n++; if (JSON.stringify(got) !== JSON.stringify(sortObj(want))) { fails++; if (fails < 4) console.log('FAIL', want.code, gal, '\n want', JSON.stringify(want), '\n got ', JSON.stringify(got)); }
}
console.log(`${n - fails}/${n} match the Python reference`);
const c = 0x115A30E59ECBn, names = G.planetSeeds(c, 9).planet_seeds.map((s) => G.planetName(s, null, lm));
const atlas = G.systemName(c, 9, lm) === 'Iqueri-Rep' && names.join('|') === 'Nadyak Prime|Tomi 47/B2|Beherylano Dori';
console.log((atlas ? 'PASS' : 'FAIL') + ' Iqueri-Rep matches the game'); if (!atlas) fails++;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
