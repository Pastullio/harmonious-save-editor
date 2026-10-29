// Ported from hadsh/nms_namegen (fork of stuart/nms_namegen), MIT licensed.
// https://github.com/hadsh/nms_namegen
//
// This is a disassembly-derived, corpus-verified reimplementation of the
// Threefish/Skein-style 64-bit mixing function No Man's Sky uses to turn a
// "universal address" into a system seed. All arithmetic is BigInt and
// masked to 64 bits after every op, matching the Python reference exactly.

const MASK64 = 0xFFFFFFFFFFFFFFFFn;
const KEY_SCHEDULE_CONST = 0x1BD11BDAA9FC1A22n;

function ror64(x, r) {
  // r can be negative in the caller's rotation table (meaning "rotate left").
  let rr = BigInt(((Number(r) % 64) + 64) % 64);
  if (rr === 0n) return x & MASK64;
  return ((x >> rr) | (x << (64n - rr))) & MASK64;
}

function hashRound(a, b, c, d, rota, rotb) {
  const a1 = (ror64(b, rota) ^ c) & MASK64;
  const b1 = (ror64(a, rotb) ^ d) & MASK64;
  const c1 = (b1 + c) & MASK64;
  const d1 = (a1 + d) & MASK64;
  return [a1, b1, c1, d1];
}

function doHash(a, b, c, d, key, seed) {
  key &= MASK64;
  seed &= MASK64;

  [a, b, c, d] = hashRound(a, b, c, d, -0x17, 0x18);
  [a, b, c, d] = hashRound(a, b, c, d, -0x5, 0x1B);
  a = (a + key + 1n) & MASK64;
  d = (d + key + 1n) & MASK64;
  [a, b, c, d] = hashRound(a, b, c, d, -0x19, 0x1F);
  [a, b, c, d] = hashRound(a, b, c, d, 0x12, -0xC);
  [a, b, c, d] = hashRound(a, b, c, d, 0x6, -0x16);
  [a, b, c, d] = hashRound(a, b, c, d, -0x20, -0x20);
  a = (a + seed + 2n) & MASK64;
  d = (d + key + seed + 2n) & MASK64;
  [a, b, c, d] = hashRound(a, b, c, d, -0xE, -0x10);
  [a, b, c, d] = hashRound(b, a, d, c, 0x7, 0xC);
  [a, b, c, d] = hashRound(b, a, d, c, -0x17, 0x18);
  [a, b, c, d] = hashRound(a, b, c, d, -0x5, 0x1B);
  a = (a + 3n) & MASK64;
  b = (b + key) & MASK64;
  c = (c + key) & MASK64;
  d = (d + 3n + seed) & MASK64;
  [a, b, c, d] = hashRound(a, b, c, d, -0x19, 0x1F);
  [a, b, c, d] = hashRound(a, b, c, d, 0x12, -0xC);
  [a, b, c, d] = hashRound(a, b, c, d, 0x6, -0x16);
  [a, b, c, d] = hashRound(a, b, c, d, -0x20, -0x20);
  a = (a + 4n) & MASK64;
  b = (b + seed) & MASK64;
  c = (c + seed + key) & MASK64;
  d = (d + 4n) & MASK64;
  [a, b, c, d] = hashRound(a, b, c, d, -0xE, -0x10);
  [a, b, c, d] = hashRound(a, b, c, d, 0xC, 0x7);
  [a, b, c, d] = hashRound(a, b, c, d, -0x17, 0x18);

  const o = new Array(4);
  o[0] = (c + seed) & MASK64;
  o[1] = (ror64(a, 0x1B) ^ d) & MASK64;
  o[2] = d & MASK64;
  o[3] = ((ror64(b, -0x5) ^ c) + 5n) & MASK64;
  return o;
}

/**
 * Derives the "primed" 32-bit system seed from a 64-bit universal address.
 * universalAddress must be a BigInt.
 * Returns a BigInt in [0, 2^32).
 */
function indexPrimedPRNG(universalAddress) {
  const lUA = BigInt.asUintN(64, universalAddress);

  const seed = lUA & 0xFFFFFFFFFFn;
  const systemId = ((lUA >> 0x20n) >> 8n) & 0xFFFn;
  const key = (seed ^ KEY_SCHEDULE_CONST) & MASK64;

  let a = seed;
  let b = (ror64(seed, 7n) ^ seed) & MASK64;
  let c = (b + a) & MASK64;
  let d = (seed + seed) & MASK64;
  let o = doHash(a, b, c, d, key, seed);

  let oCounter;
  if (systemId >= 9n) {
    const systemIndex = systemId - 1n;
    const sysHigh = (systemIndex - 8n) >> 3n;
    oCounter = (systemIndex - 8n) & 7n;

    a = (sysHigh + 1n + seed) & MASK64;
    b = (ror64(a, 7n) ^ a) & MASK64;
    c = (b + a) & MASK64;
    d = (a + a) & MASK64;
    o = doHash(a, b, c, d, key, seed);
  } else {
    oCounter = systemId - 1n;
  }

  let index = oCounter >> 1n;
  oCounter += 1n;

  // Python's `o[index]` wraps a negative index from the end of the list
  // (o[-1] === o[3]) -- reachable here whenever the raw (undecremented)
  // system_id field of the universal address is exactly 0 (e.g. portal
  // code 0 itself), which drives oCounter to -1 and index to -1. A plain
  // JS array access at a negative index returns undefined instead, so this
  // has to be wrapped explicitly to match.
  if (index < 0n) index += 4n;

  let out;
  if ((oCounter & 1n) === 0n) {
    out = (o[Number(index)] >> 0x20n) & MASK64;
  } else {
    out = o[Number(index)] & MASK64;
  }

  return out & 0xFFFFFFFFn;
}

export { indexPrimedPRNG };
