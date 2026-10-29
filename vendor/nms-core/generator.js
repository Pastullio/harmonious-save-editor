// Ported from hadsh/nms_namegen (fork of stuart/nms_namegen), MIT licensed.
// https://github.com/hadsh/nms_namegen
//
// Weighted-Markov name generator: builds a name character-triplet by
// character-triplet, weighted by real observed frequencies from a corpus
// of in-game names (letterMap). Ported 1:1 from generator.py, including a
// couple of odd-looking-but-intentional details (the `& 0x08000007` mask,
// the `name.slice(0, 64)` cap) that are kept for output fidelity with the
// original rather than "cleaned up."

import { ALPHASETS } from './alphasets.js?v=20261013';

const TINY_DOUBLE = 2.3283064370807974e-10; // 1 / 2^32
const VOWELS = 'aeiou';

function isVowel(ch) {
  return VOWELS.includes(ch);
}

function getCharactersFromAlphaset(rng, alphasetIndex) {
  const alphaset = ALPHASETS[alphasetIndex];
  const r = rng.random(Math.floor(alphaset.length / 3)) * 3;
  return alphaset.slice(r, r + 3);
}

/**
 * letterMap: the parsed letter_map.json object (keyed "0".."7" -> letter ->
 * nested [str, childOrWeights, tag] arrays).
 */
function recursiveSearch(arr, str) {
  let result = null;
  let i = 0;
  while (result === null) {
    if (i >= arr.length) return null;
    const entry = arr[i];
    if (entry[2] === 'ja') {
      const revStr = [...str].reverse().join('');
      const revKey = [...entry[0]].reverse().join('');
      if (revStr > revKey) {
        result = recursiveSearch(entry[1], str);
      }
    } else if (entry[2] === 'jz') {
      if (str === entry[0]) return entry[1];
      result = null;
    }
    i += 1;
  }
  return result;
}

function getStringWeights(letterMap, st, alphaset) {
  const table = letterMap[String(alphaset)][st[0]];
  return recursiveSearch(table, st);
}

function insertVowel(name, rng, index) {
  const vowel = VOWELS[rng.random(5)];
  return name.slice(0, index) + vowel + name.slice(index);
}

function getConsecutiveConsonants(name) {
  let consonance = 0;
  for (let i = 0; i < name.length; i++) {
    if (consonance < 3) {
      if (!isVowel(name[i])) {
        consonance += 1;
      } else {
        consonance = 0;
      }
    } else {
      if (!('aeiouy'.includes(name[i]))) {
        return i - 3;
      } else {
        consonance = 0;
      }
    }
  }
  return -1;
}

/**
 * letterMap: parsed letter_map.json (load once, pass in — see README for
 * lazy-loading pattern).
 * rng: a PRNG instance (see prng.js), already positioned where the game
 * would be when it starts generating this name.
 * alphasetIndex: 0-7.
 * minLength/maxLength: bounds on name length before suffix/prefix vowel
 * insertion (the final name can end up slightly outside this range).
 */
function generateName(letterMap, rng, alphasetIndexIn, minLength, maxLength) {
  let alphasetIndex = alphasetIndexIn;
  let name = getCharactersFromAlphaset(rng, alphasetIndex);

  let alternateCharGetter = false;
  if (rng.randi() & 1n) {
    alternateCharGetter = true;
  }

  let register = rng.random(maxLength - minLength + 1);
  register = register + minLength - 3;
  let add = register;

  if (register > 0) {
    let tries = 8;
    let i = 0;

    while (i < register) {
      const charWeights = getStringWeights(letterMap, name.slice(i, i + 3), alphasetIndex);
      const target = Number(rng.randi()) * TINY_DOUBLE;

      if (charWeights === null || charWeights === undefined) {
        tries -= 1;
        i -= 1;
        alphasetIndex = (alphasetIndex + 1) & 0x08000007;
        if (alphasetIndex < 0) alphasetIndex = -alphasetIndex;

        if (tries === 0) {
          if (add < 3) break;
          const temp = getCharactersFromAlphaset(rng, alphasetIndex);

          if (isVowel(name[i + 2]) && isVowel(temp[0])) {
            name += "'";
          } else if (!isVowel(temp[0])) {
            name += VOWELS[rng.random(5) & 0xff];
          }
          name += temp;
          tries = 1;
          i += 2;
          add -= 3;
        }
      } else {
        let index;
        if (alternateCharGetter) {
          const scaled = target * (charWeights.length - 1);
          const sign = scaled > 0 ? 1 : scaled < 0 ? -1 : 0;
          index = Math.trunc(sign * 0.5 + scaled);
        } else {
          let weight = 0.0;
          let j = 0;
          for (; j < charWeights.length; j++) {
            weight += charWeights[j].Item2;
            if (weight >= target) break;
          }
          index = Math.min(j, charWeights.length - 1);
        }
        name += charWeights[index].Item1;
        add -= 1;
      }

      if (name.length > 63) {
        name = name.slice(0, 64);
      }

      i += 1;
    }
  }

  const first = name[0];
  const second = name[1];

  // Insert vowel at start where needed.
  if (!isVowel(first) && !isVowel(second)) {
    if (first !== 's' || !'hklmnprtwy'.includes(second)) {
      const exempt =
        (second === 'h' && 'ctw'.includes(first)) ||
        (second === 'l' && 'bcfgps'.includes(first)) ||
        (second === 'r' && 'bcdfgkpt'.includes(first)) ||
        (second === 'w' && 'dgt'.includes(first)) ||
        (second === 'y' && 'hmr'.includes(first));
      if (!exempt) {
        name = insertVowel(name, rng, 1);
      }
    }
  }

  // Insert vowel at end where needed.
  if (name.length > 1) {
    const ult = name[name.length - 1];
    const penult = name[name.length - 2];
    if (penult !== 'g' || isVowel(ult)) {
      const needsVowel =
        (ult === 'b' && 'gn'.includes(penult)) ||
        (ult === 'd' && 'bdfghkmpst'.includes(penult)) ||
        (ult === 'g' && penult === 'l') ||
        (ult === 'p' && 'bdhkt'.includes(penult)) ||
        (ult === 'r' && 'bfg'.includes(penult)) ||
        (ult === 't' && penult === 'g') ||
        (ult === 'w' && !isVowel(penult));
      if (needsVowel) {
        name = insertVowel(name, rng, name.length - 1);
      }
    }
  }

  // Insert vowels in the middle.
  const consonanceIndex = getConsecutiveConsonants(name);
  if (consonanceIndex !== -1) {
    const idx = consonanceIndex + rng.random(3) + 1;
    name = insertVowel(name, rng, idx);
  }

  return name;
}

export { generateName };
