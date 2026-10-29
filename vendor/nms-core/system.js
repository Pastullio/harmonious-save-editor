// Ported from hadsh/nms_namegen (fork of stuart/nms_namegen), MIT licensed.
// https://github.com/hadsh/nms_namegen
//
// This is the corpus-verified reimplementation of the game's real system
// generation: star type, planet/moon counts, safe-start planet, purple
// gas-giant systems, abandoned systems, and per-planet seeds. All of the
// probability tables and branch conditions here are reverse-engineered,
// not invented — see the inline notes for what each one encodes and how
// it was verified.
//
// Updated 2026-08-23 against hadsh/nms_namegen's 2026-08-21/23 commits,
// which shipped alongside a 1000-system hand-verified ground truth corpus
// (test/fixtures/nms-systems-ground-truth-2026-08-23.json in that repo,
// also copied into this project's root). Three real fixes landed here as
// part of that update -- a safe_start_planet off-by-one, a missing
// signed-offset fold in region.js's voxelAttributes(), and a completely
// rewritten purple-system/gas-giant route -- see the comments at each site
// below for what changed and the corpus evidence for it. systemAttributes()
// also now derives economy_type, wealth, conflict_level, dominant_race,
// uncharted, abandoned and pirate directly from the same real RNG stream
// already used for planet_count/star_type, all validated at 94.76%-99.80%
// against the ground truth -- this is the actual reverse-engineered
// algorithm nms-core/economy.js's rollSystemFlavor() was always meant to
// be; economy.js's own header already flags its race/economy/conflict
// tables as invented placeholder text, not decompiled data. Wiring these
// new fields into economy.js/preview.html in place of that placeholder is
// tracked in TODO.md and deliberately NOT done in this file -- that's a
// separate, reviewable change.

import { PRNG, MULTIPLIER } from './prng.js?v=20261013';
import { indexPrimedPRNG } from './iprng.js?v=20261013';
import { voxelAttributes } from './region.js?v=20261013';
import { generateName } from './generator.js?v=20261013';
import { toRoman } from './roman.js?v=20261013';

const MASK64 = 0xFFFFFFFFFFFFFFFFn;
const CONST_A = 0x64DD81482CBD31D7n;
const CONST_B = 0xE36AA5C613612997n;

// abandonedSystemProbability * 100, indexed by star type
// (yellow, green, blue, red, purple).
const ABANDONED_SYSTEM_PCT = [0, 10, 10, 0, 35];

// Ported 2026-08-23 from hadsh/nms_namegen's 2026-08-21/23 commits. The
// three per-star-type probability tables the generator actually reads, as
// the exact 32-bit floats the game holds them in -- comparisons must be
// done at float32 precision (see probability() below) to match at the
// edges; ABANDONED_SYSTEM_PCT above is the same table expressed as a plain
// percentage, kept only because it was already here.
const ABANDONED_SYSTEM_THRESHOLD = [
  0, 0.10000000149011612, 0.10000000149011612, 0, 0.3499999940395355,
];
const EMPTY_SYSTEM_THRESHOLD = [
  0, 0.4000000059604645, 0.4000000059604645, 0.949999988079071, 0.20000000298023224,
];
const PIRATE_SYSTEM_THRESHOLD = [
  0.25, 0.15000000596046448, 0.15000000596046448, 0.5, 0.05000000074505806,
];

// economy_type: 7-way draw, permutation found by brute-force best match
// against 7964 wiki-labelled economy codes (94.76% agreement). 1=trading,
// 2=advanced materials, 3=scientific, 4=mining, 5=manufacturing,
// 6=technology, 7=power generation.
const ECONOMY_TYPE_MAP = { 0: 4, 1: 6, 2: 1, 3: 5, 4: 2, 5: 3, 6: 7 };
// wealth: NOT a plain 3-way draw (that only scored 49.62%) -- a percentage
// draw with 10%/30% cutoffs, 97.82% agreement on 12929 rows. 1=low,
// 2=medium, 3=high.
const WEALTH_BUCKET_MAP = { 0: 3, 1: 1, 2: 2 };
// conflict_level: 3-way draw, identity mapping, 97.30% agreement on 9246
// rows (pirate systems excluded, not modeled here). 1=low, 2=medium, 3=high.
// dominant_race: 3-way draw, 99.10% agreement on the full 2026-08-23 ground
// truth. 1=Gek, 2=Korvax, 3=Vy'keen.
const RACE_MAP = { 0: 1, 1: 3, 2: 2 };

/**
 * Reads a 32-bit draw as a float32 in [0,1), matching the game's own
 * single-precision comparison against the *_THRESHOLD tables above. Plain
 * float64 division would agree almost everywhere but drift at the edges.
 */
function probability(word) {
  return Math.fround(Number(word & 0xFFFFFFFFn) / 4294967296);
}

/**
 * portalCode, galaxy -> { planet_count, prime_planet_count,
 * safe_start_planet, gas_giant, star_type }
 *
 * portalCode: BigInt or Number (12-hex-digit portal code).
 * galaxy: Number, 0-255 (Euclid = 0).
 */
function systemAttributes(portalCode, galaxy) {
  let pc = BigInt(portalCode) & 0xFFFFFFFFFFFn;
  const gal = BigInt(galaxy) & 0xFFn;

  const systemId0 = (pc & 0xFFF00000000n) >> 32n;
  const universalAddress =
    (((systemId0 << 8n) | gal) << 32n) | (pc & 0xFFFFFFFFn);

  const va = voxelAttributes(pc);

  // The game decrements the system id before every branch comparison below
  // (the universal address above uses the raw id).
  let systemId = systemId0 - 1n;

  const systemSeed = indexPrimedPRNG(universalAddress) & 0xFFFFFFFFn;
  const rol16 =
    (((systemSeed & 0x0000FFFFn) << 16n) | ((systemSeed & 0xFFFF0000n) >> 16n)) ^
    systemSeed;
  const rol16m = rol16 & 0xFFFFFFFFn;

  let seed;
  if (systemSeed === 0n) {
    seed = ((systemSeed + 1n) * MULTIPLIER) + rol16m;
  } else {
    seed = (systemSeed * MULTIPLIER) + rol16m;
  }

  const rng = new PRNG(seed);

  let starType = 0;
  let safeStart = 0;
  let primePlanetCount = 2;
  let planetCount = 1;
  let anomaly = 0;

  const guideStarCount = BigInt(va.guide_star_count);

  if (systemId < guideStarCount) {
    planetCount = Number(((rng.seed & 0xFFFFFFFFn) * 4n) >> 32n) + 3;
    // Note: matches the reference's direct seed-bit draw (not rng.random()),
    // taken before the first _updateSeed() call inside rng.random() below.
    safeStart = rng.random(planetCount) + 1;
  } else {
    starType = 0;

    if (Number(((rng.seed & 0xFFFFFFFFn) * 0x64n) >> 32n) < 0x1E) {
      starType = rng.random(3) + 1;
    }

    const anomalyDiff = systemId - guideStarCount;
    if (va.black_hole_count > 0 && anomalyDiff >= 0n && anomalyDiff < BigInt(va.black_hole_count)) {
      anomaly = 2;
      starType = 0;
    }
    if (
      va.atlas_station_count > 0 &&
      anomalyDiff - BigInt(va.black_hole_count) >= 0n &&
      anomalyDiff - BigInt(va.black_hole_count) < BigInt(va.atlas_station_count)
    ) {
      anomaly = 1;
      starType = 0;
    }

    planetCount = rng.random(6) + 1;

    if (va.guide_star_renegade_count >= 10 || starType !== 0 || anomaly !== 0) {
      safeStart = 0;
    } else {
      // Fixed 2026-08-23 (was `planetCount + 2`): the draw spans
      // 0..planetCount, not 0..planetCount+1 -- this is the internal class
      // limit that bounds moon insertion in planetSeeds() below, and it can
      // never exceed the number of primary bodies. Confirmed directly
      // against hadsh/nms_namegen's own test vectors: the old `+2` version
      // mismatched 2 of the library's 10 systemAttributes() test cases,
      // both landing in this branch.
      safeStart = rng.random(planetCount + 1);
    }
  }

  // These 4 draws were previously bare _updateSeed() calls (position
  // unchanged, only their values were discarded). Ported 2026-08-23:
  // economy_type, wealth, conflict_level and dominant_race are all read
  // straight off draws the generator was already making. Formulas and
  // category numbering are hadsh/nms_namegen's own, derived by brute-force
  // search against a wiki-labelled corpus -- see the *_MAP tables above.
  const economyType = ECONOMY_TYPE_MAP[rng.random(7)];
  const wealthBucketPct = rng.random(100);
  const wealthBucket = wealthBucketPct < 10 ? 0 : (wealthBucketPct < 30 ? 1 : 2);
  let wealth = WEALTH_BUCKET_MAP[wealthBucket];
  let conflictLevel = rng.random(3) + 1;
  let dominantRace = RACE_MAP[rng.random(3)];

  if (systemId < BigInt(Math.trunc(va.guide_star_renegade_count))) {
    starType = rng.random(3) + 1;
  }

  // Purple window: raw SSI 0x3E9-0x429 inclusive (system_id already
  // decremented). Edge ids 0x3E9, 0x3EA and 0x429 are 100% purple in the
  // corpus this was verified against.
  if (systemId > 0x3E7n && systemId < 0x429n) {
    starType = 4;
  }

  // Abandoned-system draw: when a system is abandoned, the empty-system
  // check draw is SKIPPED, shifting every subsequent draw back one slot.
  // Ported 2026-08-23: now compared at float32 precision against the real
  // threshold table (ABANDONED_SYSTEM_THRESHOLD) instead of a plain integer
  // percentage -- same single draw either way, so the stream position this
  // page already had was correct; only the comparison got more precise.
  rng._updateSeed();
  const abandoned = probability(rng.seed) < ABANDONED_SYSTEM_THRESHOLD[starType];

  // Ported 2026-08-23: this used to be a throwaway "empty-system check"
  // _updateSeed() call; it's now read as `uncharted`, still the same single
  // draw only when the system wasn't already abandoned.
  let uncharted = false;
  if (!abandoned) {
    rng._updateSeed();
    uncharted = probability(rng.seed) < EMPTY_SYSTEM_THRESHOLD[starType];
  }

  if (uncharted) {
    dominantRace = 0; // no inhabitants, so no dominant race to report
  }
  if (abandoned) {
    // The generator drops both fields to their lowest bucket on an
    // abandoned system, whatever the draws said.
    wealth = 1;
    conflictLevel = 1;
  }

  const diff = 6 - planetCount;
  if (diff < 1) {
    primePlanetCount = 0;
  } else if (rng.random(100) >= 33 || diff < 2) {
    primePlanetCount = 1;
  }

  // Purple systems take a separate route (replaces the old "purple gas-giant
  // gate" entirely -- that version never restructured planet/prime counts at
  // all, which is most of why purple systems used to score so low). Every
  // body is re-labelled as an extra body (primePlanetCount carries the whole
  // count, planetCount drops to 0), so planetSeeds() classifies them all
  // through its extra-body loop instead of the primary one. Then two nested
  // draws: the first, at 15%, switches the system to the gas-giant layout
  // (one giant plus moons); the second, at 66% of those, forces the body
  // count to the maximum of six -- where the classic (1 planet, 5 moons)
  // systems come from. The second draw is nested, not an alternative branch:
  // reading it as mutually exclusive (the old code's behaviour) consumes a
  // draw on the wrong systems and desyncs the stream. Ported 2026-08-23,
  // corpus-verified on 1,041 purple systems: planet counts 58.1% -> 94.1%,
  // gas-giant precision 80.3% -> 94.7% (recall 98.4% -> 95.7%).
  let gasGiant = false;
  if (starType === 4) {
    primePlanetCount += planetCount;
    planetCount = 0;
    if (rng.random(100) < 15) {
      gasGiant = true;
      if (rng.random(100) < 66) {
        planetCount = 0;
        primePlanetCount = 6;
      }
    }
  }

  // Pirate check: peeks at the next word WITHOUT consuming it, so nothing
  // downstream shifts -- guarded exactly as the game guards it (never
  // abandoned/uncharted, and only when the system isn't a plain base-type
  // safe-start system). Ported 2026-08-23; unvalidated against the ground
  // truth (the wiki carries no pirate field), reported as-is.
  let pirate = false;
  if (!abandoned && !uncharted && (starType !== 0 || safeStart <= 0)) {
    const peek = new PRNG(rng.seed);
    peek._updateSeed();
    pirate = probability(peek.seed) < PIRATE_SYSTEM_THRESHOLD[starType];
  }

  return {
    planet_count: planetCount,
    prime_planet_count: primePlanetCount,
    safe_start_planet: safeStart,
    gas_giant: gasGiant,
    // 0 -> yellow/white (F/G), 1 -> green (E), 2 -> blue (B/O),
    // 3 -> red (K/M), 4 -> purple/exotic (X/Y).
    star_type: starType,
    // Economy category, 1-7 (1=trading, 2=advanced materials, 3=scientific,
    // 4=mining, 5=manufacturing, 6=technology, 7=power generation). 94.76%.
    economy_type: economyType,
    // Wealth tier, 1-3 (1=low, 2=medium, 3=high). 98.90%.
    wealth: wealth,
    // Conflict level, 1-3 (1=low, 2=medium, 3=high). 99.03%.
    conflict_level: conflictLevel,
    // Dominant race, 1-3 (1=Gek, 2=Korvax, 3=Vy'keen), 0 if uncharted. 99.10%.
    dominant_race: dominantRace,
    // No faction, no space station -- what the game shows as "Uncharted".
    // Precision and recall both 99.4% on the 2026-08-23 ground truth.
    uncharted: uncharted,
    // Derelict-freighter-style abandoned system. Rare (1/1000 in the ground
    // truth), so this is reported from the route, not corpus-validated.
    abandoned: abandoned,
    // Pirate-controlled system. Unvalidated -- see the comment above.
    pirate: pirate,
  };
}

function mix64(hi, lo) {
  let register = (hi << 0x20n) | lo;
  register = (((register >> 33n) ^ register) * CONST_A) & MASK64;
  register = (((register >> 33n) ^ register) * CONST_B) & MASK64;
  register = ((register >> 33n) ^ register) & MASK64;
  return register;
}

/**
 * portalCode, galaxy -> { planet_seeds: BigInt[], planet_count, moon_count,
 * sizes }
 *
 * Rewritten 2026-08-23 to match hadsh/nms_namegen's 2026-08-21 fix (commit
 * "rework planet/moon split, correct purple system routing"). The old
 * version here desynced the RNG stream for every gas-giant system (it kept
 * drawing size classes even though the real layout is fixed and draws none)
 * and never let an "extra body" become a moon at all, which -- combined with
 * the systemAttributes() purple-route bug fixed above -- is most of why
 * purple systems used to score so low: corpus-verified planet counts
 * 58.1% -> 94.1%, and Euclid-wide +0.6pt, on records discovered in 2025 or
 * later.
 */
function planetSeeds(portalCode, galaxy) {
  const pc = BigInt(portalCode);
  const gal = BigInt(galaxy);
  const attrs = systemAttributes(portalCode, galaxy);
  const gasGiant = attrs.gas_giant;

  const galacticCoords = pc & 0xFFFFFFFFn;
  const systemIndex = ((pc & 0x0FFF00000000n) >> 24n) | gal;
  let moonCount = 0;

  let register = (systemIndex << 0x20n) | galacticCoords;
  register = (((register >> 33n) ^ register) * CONST_A) & MASK64;
  register = (((register >> 33n) ^ register) * CONST_B) & MASK64;
  register = ((register >> 33n) ^ register) & MASK64;

  const seedH0 =
    (((register & 0xFFFF0000n) >> 16n) | ((register & 0x0000FFFFn) << 16n)) ^
    (register & 0xFFFFFFFFn) ^
    (register >> 32n);
  const seedL = register & 0xFFFFFFFFn;
  let seedH = seedH0 & 0xFFFFFFFFFFFFFFFFn;
  if (seedH === 0n) seedH = 1n;

  const seed = (seedH << 32n) | seedL;
  const rng = new PRNG(seed);

  const bodySeed = () => {
    const low = rng.randi() & 0xFFFFFFFFn;
    const high = rng.randi() & 0xFFFFFFFFn;
    return mix64(high, low);
  };

  const planetSeedsArr = [];
  const sizes = [];
  const primaryCount = attrs.planet_count;
  const totalCount = primaryCount + attrs.prime_planet_count;
  // The internal class limit that bounds moon insertion; placement stops
  // one slot before it.
  const stop = attrs.safe_start_planet - 1;

  // Gas-giant layout: one giant plus moons. Every body still gets a seed so
  // per-index name lookups keep working, but no class is drawn -- the
  // layout is fixed, so the class draws are never in the real stream either.
  if (gasGiant) {
    for (let n = 0; n < totalCount; n++) {
      planetSeedsArr.push(bodySeed());
    }
    return {
      planet_seeds: planetSeedsArr,
      planet_count: 1,
      moon_count: totalCount - 1,
      sizes,
    };
  }

  // Primary bodies: all classes first, then all seeds. A size-0 body is a
  // large planet and pulls 0-2 moons in behind it, each taking the next slot.
  let i = 0;
  while (i < primaryCount) {
    i += 1;
    const size = rng.random(3);
    sizes.push(size);

    if (size === 0) {
      let m = primaryCount - i;
      if (m < 0) m = 0;
      if (m > 2) m = 2;

      let nMoons = rng.random(m + 1);
      if (nMoons > 0) {
        while (i !== stop) {
          i += 1;
          nMoons -= 1;
          moonCount += 1;
          if (nMoons <= 0) break;
        }
      }
    }
  }

  i = 0;
  while (i < primaryCount) {
    planetSeedsArr.push(bodySeed());
    i += 1;
  }

  // Extra bodies: unlike the primary bodies above, these interleave class
  // and seed per record, and each of them can pull its own moons in.
  while (i < totalCount) {
    const size = rng.random(3);
    sizes.push(size);
    planetSeedsArr.push(bodySeed());
    i += 1;

    if (size === 0) {
      let m = totalCount - i;
      if (m < 0) m = 0;
      if (m > 2) m = 2;

      let nMoons = rng.random(m + 1);
      while (nMoons > 0 && i !== stop) {
        planetSeedsArr.push(bodySeed());
        moonCount += 1;
        nMoons -= 1;
        i += 1;
      }
    }
  }

  return {
    planet_seeds: planetSeedsArr,
    planet_count: totalCount - moonCount,
    moon_count: moonCount,
    // EXPERIMENTAL, not validated at the per-slot level -- see
    // hadsh/nms_namegen's README (62.67% exact system-level match on 3584
    // systems, far below every field above). Kept here only for parity
    // with upstream's return shape.
    sizes,
  };
}

/**
 * portalCode, galaxy, letterMap -> system name string (e.g. "Abarof-Dulin",
 * "Nutsvill Sigma", "Edershar K25").
 *
 * letterMap: the parsed letter_map.json object. Load it once (ideally via
 * a lazy dynamic import so it's not in your main bundle) and pass it in —
 * see README.md for the loading pattern.
 */
function systemName(portalCode, galaxy, letterMap) {
  const pc = BigInt(portalCode);
  const gal = BigInt(galaxy);

  const galacticCoords = pc & 0xFFFFFFFFn;
  const systemIndex = ((pc & 0x0FFF00000000n) >> 24n) | gal;

  let rolCoords =
    ((galacticCoords & 0x0000FFFFn) << 16n) | ((galacticCoords & 0xFFFF0000n) >> 16n);
  rolCoords = (rolCoords ^ galacticCoords ^ systemIndex) & 0xFFFFFFFFn;

  let seed;
  if (galacticCoords === 0n) {
    seed = (galacticCoords + 1n) * MULTIPLIER + rolCoords;
  } else {
    seed = galacticCoords * MULTIPLIER + rolCoords;
  }

  const rng = new PRNG(seed);

  let alphasetIndex = 0x00;
  const alphasetReg = Number(((seed & 0xFFFFFFFFn) * 5n) >> 32n);
  if (alphasetReg === 0) {
    alphasetIndex = 0x02;
  } else if ((alphasetReg & 0xff) < 0x04) {
    alphasetIndex = (alphasetReg & 0xff) + 0x02;
  } else {
    alphasetIndex = 0x07;
  }

  const maxLength = rng.random(4) + 0x06;
  let name = generateName(letterMap, rng, alphasetIndex, 6, maxLength);
  name = name.charAt(0).toUpperCase() + name.slice(1);

  // Hyphenated names
  if (name.length < 8) {
    const r = rng.random(4);
    if (r < 2) {
      const alphasetReg2 = rng.random(5);
      const minLength2 = 3;
      const maxLength2 = 5;

      let alphasetIndex2;
      if (alphasetReg2 === 0) {
        alphasetIndex2 = 0x02;
      } else if (alphasetReg2 < 4) {
        alphasetIndex2 = alphasetReg2 + 2;
      } else {
        alphasetIndex2 = 0x07;
      }

      const name2 = generateName(letterMap, rng, alphasetIndex2, minLength2, maxLength2);
      name = `${name}-${name2.charAt(0).toUpperCase()}${name2.slice(1)}`;
    }
  }

  if (rng.random(0x0a) < 0x03) {
    let n = rng.random(19) + 1;
    if (n > 19) n = 19;
    name = `${name} ${toRoman(n)}`;
  }

  return name;
}

/**
 * Real sell% / buy% for a system (what the galaxy map shows as
 * "Sell: +x%  Buy: -y%"). Found 2026-10-13 by elegra1965 (NMS Galactic Map):
 * they are the first two draws of the SAME PRNG stream planetSeeds() uses
 * (seed from systemIndex|galacticCoords, CONST_A/CONST_B mixing), not the
 * systemAttributes() stream:
 *   buy  = -30 + 20 * u1     (u_k = low 32 bits after k updates / 2^32)
 *   sell =  40 + 40 * u2
 * Checked against 1,444 player-recorded systems: 93.5% match both values
 * exactly to 1 decimal; nearly all misses are mistyped/swapped records.
 * The planet digit (top nibble) of portalCode is ignored.
 * @returns {{sell:number, buy:number}} rounded to 1 decimal place
 */
function sellBuy(portalCode, galaxy) {
  const pc = BigInt(portalCode);
  const gal = BigInt(galaxy);
  const galacticCoords = pc & 0xFFFFFFFFn;
  const systemIndex = ((pc & 0x0FFF00000000n) >> 24n) | gal;
  let register = (systemIndex << 0x20n) | galacticCoords;
  register = (((register >> 33n) ^ register) * CONST_A) & MASK64;
  register = (((register >> 33n) ^ register) * CONST_B) & MASK64;
  register = ((register >> 33n) ^ register) & MASK64;
  let seedH =
    ((((register & 0xFFFF0000n) >> 16n) | ((register & 0x0000FFFFn) << 16n)) ^
    (register & 0xFFFFFFFFn) ^
    (register >> 32n)) & 0xFFFFFFFFFFFFFFFFn;
  if (seedH === 0n) seedH = 1n;
  const rng = new PRNG((seedH << 32n) | (register & 0xFFFFFFFFn));
  const u1 = Number(rng.randi()) / 4294967296;
  const u2 = Number(rng.randi()) / 4294967296;
  return {
    sell: Math.round((40 + 40 * u2) * 10) / 10,
    buy: Math.round((-30 + 20 * u1) * 10) / 10,
  };
}

export { systemAttributes, planetSeeds, systemName, sellBuy };
