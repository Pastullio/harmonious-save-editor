// Ported from hadsh/nms_namegen (fork of stuart/nms_namegen), MIT licensed.
// The game's simple 32-bit multiplicative PRNG used to draw star type,
// planet counts, name lengths, etc. once a system seed has been derived.

const MASK64 = 0xFFFFFFFFFFFFFFFFn;
const MASK32 = 0xFFFFFFFFn;
const MULTIPLIER = 0x5A76F899n;

class PRNG {
  constructor(seed) {
    this.seed = BigInt.asUintN(64, BigInt(seed));
  }

  _updateSeed() {
    this.seed = (((this.seed & MASK32) * MULTIPLIER) + (this.seed >> 32n)) & MASK64;
  }

  /** Returns an integer in [0, range) as a Number. */
  random(range) {
    this._updateSeed();
    const r = BigInt(range);
    return Number(((this.seed & MASK32) * r) >> 32n);
  }

  /** Returns 32 random bits as a BigInt. */
  randi() {
    this._updateSeed();
    return this.seed & MASK32;
  }

  /** Returns 64 random bits as a BigInt. */
  randl() {
    this._updateSeed();
    return this.seed & MASK64;
  }
}

export { PRNG, MULTIPLIER };
