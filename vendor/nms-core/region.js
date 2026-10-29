// Ported from hadsh/nms_namegen (fork of stuart/nms_namegen), MIT licensed.
// voxelAttributes() replaces the "black hole = index 079, Atlas = 07A"
// assumption with the real distance-from-galaxy-centre model.

import { PRNG } from './prng.js?v=20261013';
import { generateName } from './generator.js?v=20261013';

const MASK64 = 0xFFFFFFFFFFFFFFFFn;
const CONST_A = 0x64DD81482CBD31D7n;
const CONST_B = 0xE36AA5C613612997n;

/**
 * portalCode: BigInt or Number, the 12-hex-digit portal code (P SSS YY ZZZ XXX).
 * Returns guide_star_count, black_hole_count, atlas_station_count,
 * inside_gap, guide_star_renegade_count for the region this portal code
 * belongs to.
 */
function voxelAttributes(portalCode) {
  const pc = BigInt(portalCode);

  let x = Number(pc & 0xFFFn);
  let y = Number((pc & 0xFF000000n) >> 24n);
  let z = Number((pc & 0xFFF000n) >> 12n);

  // Ported 2026-08-23 (was missing entirely before): x/z run 12 bits
  // (0x000-0xFFF), y runs 8 bits (0x00-0xFF), and both are SIGNED offsets
  // from the galactic centre, folded the same way the game does (0.00%
  // median error vs 5531 labelled regions in upstream's corpus). Using the
  // raw unsigned value instead, as this file did until now, makes every
  // high-half coordinate look artificially "far" from centre, which pushes
  // guide_star_renegade_count to 0 and silently disables the star_type
  // renegade override for roughly half of all voxels.
  if (x > 0x7FF) x -= 0x1000;
  if (z > 0x7FF) z -= 0x1000;
  if (y > 0x7F) y -= 0x100;

  const va = {
    guide_star_count: 0x78,
    black_hole_count: 1,
    atlas_station_count: 1,
    inside_gap: 0,
    guide_star_renegade_count: 0,
  };

  // Ported 2026-08-23: distance is truncated to an integer BEFORE both the
  // gap test and the renegade subtraction, and the subtraction is itself an
  // integer divide -- this file previously kept the float distance
  // throughout. Per upstream's own measurement (2026-08-23 ground truth,
  // 1000 hand-recorded systems): holding everything else fixed, this one
  // change alone carries economy/wealth/conflict/race from ~97% to ~99%,
  // star colour 98.2->99.1, planet counts 98.3->98.8. Affects voxels at
  // distance 8.0-8.9 and ~1330 specifically (87 of the 1000 ground-truth
  // systems).
  const distance = Math.trunc(Math.sqrt(x * x + y * y + z * z));

  if (distance < 8) {
    va.guide_star_count = 0;
    va.black_hole_count = 0;
    va.atlas_station_count = 0;
    va.inside_gap = 1;
  }

  if (distance > 8 && distance < 1440) {
    let diff = Math.trunc(((distance - 8) * 120) / 1440);
    if (diff < 0) diff = 0;
    if (diff > 0x78) diff = 0x78;
    va.guide_star_renegade_count = 0x78 - diff;
  }

  return va;
}

const REGION_NAME_ADORNMENTS = [
  "{} Adjunct", "{} Void", "{} Expanse", "{} Terminus", "{} Boundary",
  "{} Fringe", "{} Cluster", "{} Mass", "{} Band", "{} Cloud",
  "{} Nebula", "{} Quadrant", "{} Sector", "{} Anomaly", "{} Conflux",
  "{} Instability", "Sea of {}", "The Arm of {}", "{} Spur", "{} Shallows",
];

/**
 * Derives the region-level seed. Needs generateName() from generator.js to
 * actually produce a name string; exported separately so callers that only
 * need voxelAttributes() don't have to pull in the (large) name generator.
 */
function regionSeed(portalCode, galaxy) {
  const pc = BigInt(portalCode);
  const gal = BigInt(galaxy);

  let register = gal >> 1n;
  register ^= (gal << 32n) | (pc & 0xFFFFFFFFn);
  register = (register * CONST_A) & MASK64;
  register = (((register >> 33n) ^ register) * CONST_B) & MASK64;
  register = ((register >> 33n) ^ register) & MASK64;

  const seedH0 =
    (((register & 0xFFFF0000n) >> 16n) | ((register & 0x0000FFFFn) << 16n)) ^
    (register & 0xFFFFFFFFn) ^
    (register >> 32n);
  let seed = register & 0xFFFFFFFFn;
  let seedH = seedH0;
  if (seedH === 0n) seedH = 1n;

  seed |= seedH << 32n;
  return seed;
}

/**
 * portalCode, galaxy, letterMap -> region name string (e.g. "Yihelli
 * Quadrant"). ~50% of regions get an adornment phrase; the rest are a bare
 * generated name.
 *
 * letterMap: the parsed letter_map.json object (see README for the
 * lazy-loading pattern).
 */
function regionName(portalCode, galaxy, letterMap) {
  const seed = regionSeed(portalCode, galaxy);
  const rng = new PRNG(seed);

  const minLength = 6;
  const maxLength = rng.random(4) + 6;
  const alphasetIndex = 0;
  let name = generateName(letterMap, rng, alphasetIndex, minLength, maxLength);
  name = name.charAt(0).toUpperCase() + name.slice(1);

  if (rng.random(0x64) < 0x50) {
    const adornment = REGION_NAME_ADORNMENTS[rng.random(0x14)];
    name = adornment.replace('{}', name);
  }

  return name;
}

export { voxelAttributes, regionSeed, regionName, REGION_NAME_ADORNMENTS };
