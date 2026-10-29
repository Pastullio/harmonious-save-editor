// Ported from hadsh/nms_namegen (fork of stuart/nms_namegen), MIT licensed.
// https://github.com/hadsh/nms_namegen

import { PRNG, MULTIPLIER } from './prng.js?v=20261013';
import { generateName } from './generator.js?v=20261013';
import { toRoman } from './roman.js?v=20261013';
import { planetSeeds } from './system.js?v=20261013';

const TINY_DOUBLE = 2.3283064370807974e-10;

const ADORNMENTS = [
  'Prime', 'Major', 'Minor', 'Alpha', 'Beta',
  'Gamma', 'Delta', 'Omega', 'Sigma', 'Tau',
];

// ---------------------------------------------------------------------
// Biome-flavoured adornment pools -- ORIGINAL work (elegra1965/Claude,
// 2026-08-18), NOT part of the hadsh/nms_namegen port above. There is no
// known real algorithm for how the actual game names a planet (confirmed
// via the decompiled game data, the upstream nms_namegen author's own
// README, and a direct read of a real save file -- see HANDOVER.md /
// CLAUDE.md session notes) -- planetName() below is, and always was, a
// plausible-sounding GUESS, not real save data. This block only makes
// that guess feel more tied to the planet actually shown on screen: the
// generic ADORNMENTS pool above ("Prime"/"Tau"/etc, used by roughly a
// fifth of the STYLES templates) gets swapped for a biome-appropriate
// word list when the caller knows the body's biome, so a Lush garden
// world is more likely to land on something like "Verdance" instead of
// "Omega", and a Volcanic world leans toward "Cinder" instead of "Beta".
// Still 100% disclosed as a stylistic guess in the About modal -- this
// does not make names any more "real," just less randomly mismatched to
// what the player is looking at.
const BIOME_ADORNMENTS = {
  Lush:          ['Verdance', 'Bloom', 'Meadow', 'Arbor', 'Petal', 'Grove', 'Thicket', 'Blossom'],
  Barren:        ['Dust', 'Wastes', 'Husk', 'Ashland', 'Drift', 'Erosion', 'Scrub', 'Flats'],
  Dead:          ['Husk', 'Silence', 'Void', 'Ruin', 'Ashfall', 'Requiem', 'Hollow', 'Stillness'],
  Exotic:        ['Anomaly', 'Prism', 'Enigma', 'Paradox', 'Warp', 'Flux', 'Mirage', 'Fold'],
  'Mega Exotic': ['Chimera', 'Aberration', 'Singularity', 'Nullspace', 'Rift', 'Eclipse', 'Vortex'],
  Scorched:      ['Ember', 'Ashen', 'Scorch', 'Sunscald', 'Parched', 'Cracked', 'Blaze', 'Char'],
  Frozen:        ['Rime', 'Glacia', 'Frost', 'Permafrost', 'Hoarfrost', 'Glacier', 'Sleet', 'Boreal'],
  Toxic:         ['Miasma', 'Blight', 'Fume', 'Noxa', 'Caustic', 'Vapour', 'Sludge', 'Bilious'],
  Radioactive:   ['Fallout', 'Isotope', 'Gamma', 'Halflife', 'Fission', 'Cinderglow', 'Decay'],
  Irradiated:    ['Fallout', 'Isotope', 'Gamma', 'Halflife', 'Fission', 'Cinderglow', 'Decay'],
  Marsh:         ['Mire', 'Bog', 'Fen', 'Sodden', 'Reeds', 'Silt', 'Peat', 'Wetland'],
  Volcanic:      ['Cinder', 'Ember', 'Magma', 'Ashfall', 'Pyroclast', 'Caldera', 'Flow', 'Vent'],
};

// NOT currently wired into planetName() (see 2026-09-07 note in that
// function) -- sentinel activity is its own invented per-body guess,
// already shown on its own info-panel line, and feeding a HIGH-tier
// word in here used to stomp the biome pool and produce names like
// "Waynett Sentinel" instead of "Waynett Prime". Kept/exported in case
// this is wanted back later as an explicit opt-in elsewhere.
const SENTINEL_HOSTILE_ADORNMENTS = [
  'Sentinel', 'Corrupted', 'Purge', 'Vigil', 'Enforced', 'Interdicted', 'Quarantine',
];
const SENTINEL_HOSTILE_SET = new Set([
  'Aggressive', 'Frenzied', 'High Security', 'Hostile Patrols', 'Threatening', 'Hateful',
  'Zealous', 'Malicious', 'Inescapable', 'Corrupted', 'Forsaken', 'Rebellious',
  'Answer To None', 'Sharded from the Atlas', 'Dissonant', 'De-Harmonised',
]);

/** Same peek-and-scale technique as the default adornmentIdx below, just
 * generalised to any pool length -- reads rng.seed WITHOUT calling
 * rng.random() (a stateless peek), so picking a differently-sized flavour
 * pool never disturbs the rng draw sequence every later value in
 * planetName() depends on. */
function pickAdornment(rng, pool) {
  const idx = Number(((rng.seed & 0xFFFFFFFFn) * BigInt(pool.length)) >> 0x20n);
  return pool[idx];
}

const STYLES = [
  '%PROCNORM%',
  '%PROCNORM% %ADORNMENT%',
  '%PROCNORM% %NUMERAL%',
  '%PROCNORM% %SHORTCODE%',
  '%PROCLONG% %PROCSHORT%',
  '%PROCSHORT% %LONGCODE%',
  '%PROCNORM%',
  '%PROCNORM% %ADORNMENT%',
  '%PROCNORM% %NUMERAL%',
  'Style 9',
  'New %PROCNORM%',
];

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * portalCode, galaxy -> the specific planet seed (BigInt) for the planet
 * index encoded in the portal code (the leading hex digit, "P" in
 * PSSSYYZZZXXX).
 */
function planetSeed(portalCode, galaxy) {
  const pc = BigInt(portalCode);
  const planetId = (pc & 0xF00000000000n) >> 44n;
  const seeds = planetSeeds(pc, galaxy).planet_seeds;
  return seeds[Number(planetId) - 1];
}

function formatLongcode(longcode, digit, alpha) {
  return `${longcode}/${String.fromCharCode(Number(alpha))}${digit}`;
}

function formatShortcode(alpha, num) {
  return `${String.fromCharCode(Number(alpha))}${num}`;
}

/**
 * Returns a planet name given either:
 *   - a raw planet seed (BigInt) as the first argument, with galaxy omitted, or
 *   - a portal code + galaxy, in which case the seed is derived automatically
 *     for the planet index encoded in the portal code.
 *
 * letterMap: parsed letter_map.json (see README for the lazy-loading pattern).
 */
function planetName(planetSeedOrCode, galaxy, letterMap, opts) {
  let seed0 = BigInt(planetSeedOrCode);
  if (galaxy !== undefined && galaxy !== null) {
    seed0 = planetSeed(planetSeedOrCode, galaxy);
  }

  const lowword = seed0 & 0xFFFFFFFFn;
  const highword = seed0 >> 32n;

  let rol16 = ((lowword & 0x0000FFFFn) << 16n) | ((lowword & 0xFFFF0000n) >> 16n);
  rol16 = (rol16 ^ lowword ^ highword) & 0xFFFFFFFFn;

  let seed;
  if (lowword === 0n) {
    seed = (lowword + 1n) * MULTIPLIER + rol16;
  } else {
    seed = lowword * MULTIPLIER + rol16;
  }

  const rng = new PRNG(seed);
  // 2026-09-07 (Tony): confirmed the biome pool below is a "sub name"
  // concept (e.g. a Radioactive planet's flavour word like "Dissident"),
  // never the actual planet name's %ADORNMENT% slot -- BIOME_ADORNMENTS
  // and SENTINEL_HOSTILE_ADORNMENTS (see above) are now BOTH disabled
  // here. planetName() always draws from the classic 10-entry ADORNMENTS
  // array ("Prime", "Major", etc.), exactly as the original disassembly
  // did, regardless of opts.biome/opts.sentinel. Both pools are kept
  // (still exported) for a real, separate sub-name feature elsewhere,
  // rather than deleted.
  var adornmentPool = ADORNMENTS;
  const adornmentWord = adornmentPool === ADORNMENTS
    ? ADORNMENTS[Number(((rng.seed & 0xFFFFFFFFn) * 10n) >> 0x20n)]
    : pickAdornment(rng, adornmentPool);
  const code = rng.random(50) + 1;
  const shortcode = rng.random(0x1a) + 0x41;
  const numeral = rng.random(0x12) + 2;
  const digit = rng.random(0x09) + 1;
  const alpha = rng.random(0x1a) + 0x41;
  const longcode = rng.random(0x59) + 0xb;

  const procnorm = generateName(letterMap, rng, 7, 4, 8);
  const procshort = generateName(letterMap, rng, 5, 4, 5);
  const proclong = generateName(letterMap, rng, 7, 6, 10);

  let namegenStyle = rng.random(9);

  const target = Number(rng.randi()) * TINY_DOUBLE;
  if (!(0.0350000001 <= target)) {
    namegenStyle = 10;
  }

  let name = STYLES[namegenStyle];

  name = name.replace('%PROCNORM%', capitalize(procnorm));
  name = name.replace('%PROCSHORT%', capitalize(procshort));
  name = name.replace('%PROCLONG%', capitalize(proclong));
  name = name.replace('%ADORNMENT%', adornmentWord);
  name = name.replace('%SHORTCODE%', formatShortcode(shortcode, code % 0x50));
  name = name.replace('%NUMERAL%', toRoman(numeral));
  name = name.replace('%LONGCODE%', formatLongcode(longcode, digit, alpha));

  return name;
}

export { planetName, planetSeed, BIOME_ADORNMENTS, SENTINEL_HOSTILE_ADORNMENTS, SENTINEL_HOSTILE_SET };
