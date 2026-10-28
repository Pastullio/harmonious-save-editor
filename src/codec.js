/* NMS Save Codec — Steam/GOG PC save format (Frontiers 3.60+).
 * Data file (saveN.hg): sequence of chunks [E5 A1 ED FE][u32 compressed][u32 decompressed][u32 0] + LZ4 block.
 * Meta file (mf_saveN.hg): XXTEA-encrypted little-endian u32 array, key derived from the storage slot.
 * Format knowledge ported from libNOM.io (GPL-3.0, zencq). This file is GPL-3.0 as well.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- LZ4 block
  function lz4Decode(src, srcStart, srcEnd, dst, dstStart) {
    let s = srcStart, d = dstStart;
    while (s < srcEnd) {
      const token = src[s++];
      let lit = token >>> 4;
      if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
      dst.set(src.subarray(s, s + lit), d); s += lit; d += lit;
      if (s >= srcEnd) break;
      const off = src[s] | (src[s + 1] << 8); s += 2;
      if (off === 0) throw new Error('LZ4: zero offset');
      let ml = token & 15;
      if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
      ml += 4;
      let m = d - off;
      if (m < dstStart) throw new Error('LZ4: offset out of range');
      if (off >= ml) { dst.copyWithin(d, m, m + ml); d += ml; }
      else { for (let i = 0; i < ml; i++) dst[d++] = dst[m++]; }
    }
    return d - dstStart;
  }

  const HASH_LOG = 16, MIN_MATCH = 4, LAST_LITERALS = 5, MF_LIMIT = 12;
  const hashTable = new Int32Array(1 << HASH_LOG);
  function lz4Bound(n) { return n + ((n / 255) | 0) + 16; }

  function lz4Encode(src, srcStart, srcLen, dst, dstStart) {
    const end = srcStart + srcLen;
    let d = dstStart, anchor = srcStart, s = srcStart;
    hashTable.fill(-1);
    const matchLimit = end - LAST_LITERALS;
    const mfLimit = end - MF_LIMIT;
    if (srcLen >= MF_LIMIT + 1) {
      s++;
      while (s < mfLimit) {
        const seq = src[s] | (src[s + 1] << 8) | (src[s + 2] << 16) | (src[s + 3] << 24);
        const h = Math.imul(seq, 2654435761) >>> (32 - HASH_LOG);
        const ref = hashTable[h];
        hashTable[h] = s;
        if (ref < 0 || s - ref > 65535 ||
            src[ref] !== src[s] || src[ref + 1] !== src[s + 1] || src[ref + 2] !== src[s + 2] || src[ref + 3] !== src[s + 3]) {
          s++; continue;
        }
        // extend backwards
        let mStart = s, rStart = ref;
        while (mStart > anchor && rStart > srcStart && src[mStart - 1] === src[rStart - 1]) { mStart--; rStart--; }
        // extend forwards
        let mEnd = s + MIN_MATCH, rEnd = ref + MIN_MATCH;
        while (mEnd < matchLimit && src[mEnd] === src[rEnd]) { mEnd++; rEnd++; }
        // emit sequence
        const litLen = mStart - anchor, matchLen = mEnd - mStart - MIN_MATCH;
        const tokenPos = d++;
        let token = (litLen >= 15 ? 15 : litLen) << 4;
        if (litLen >= 15) { let r = litLen - 15; while (r >= 255) { dst[d++] = 255; r -= 255; } dst[d++] = r; }
        dst.set(src.subarray(anchor, mStart), d); d += litLen;
        const off = mStart - rStart;
        dst[d++] = off & 255; dst[d++] = off >>> 8;
        token |= matchLen >= 15 ? 15 : matchLen;
        if (matchLen >= 15) { let r = matchLen - 15; while (r >= 255) { dst[d++] = 255; r -= 255; } dst[d++] = r; }
        dst[tokenPos] = token;
        s = anchor = mEnd;
        if (s >= mfLimit) break;
        // seed hash for position just before s
        const p = s - 2;
        const seq2 = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24);
        hashTable[Math.imul(seq2, 2654435761) >>> (32 - HASH_LOG)] = p;
      }
    }
    // last literals
    const litLen = end - anchor;
    if (litLen >= 15) { dst[d++] = 15 << 4; let r = litLen - 15; while (r >= 255) { dst[d++] = 255; r -= 255; } dst[d++] = r; }
    else dst[d++] = litLen << 4;
    dst.set(src.subarray(anchor, end), d); d += litLen;
    return d - dstStart;
  }

  // ---------------------------------------------------------------- data file
  const CHUNK_MAGIC = 0xFEEDA1E5; // bytes E5 A1 ED FE
  const CHUNK_MAX = 0x80000;

  function isChunked(buf) { return buf.length >= 16 && new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true) === CHUNK_MAGIC; }

  function decompressData(buf) {
    if (!isChunked(buf)) return { bytes: buf, compressed: false };
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 0, total = 0; const chunks = [];
    while (off < buf.length) {
      if (dv.getUint32(off, true) !== CHUNK_MAGIC) throw new Error('Bad chunk header at offset ' + off);
      const csize = dv.getUint32(off + 4, true), usize = dv.getUint32(off + 8, true);
      chunks.push([off + 16, csize, usize]); total += usize; off += 16 + csize;
    }
    const out = new Uint8Array(total); let d = 0;
    for (const [s, c, u] of chunks) {
      const n = lz4Decode(buf, s, s + c, out, d);
      if (n !== u) throw new Error('LZ4 size mismatch in chunk');
      d += n;
    }
    return { bytes: out, compressed: true };
  }

  function compressData(bytes) {
    const parts = []; let total = 0;
    const tmp = new Uint8Array(lz4Bound(CHUNK_MAX));
    for (let p = 0; p < bytes.length; p += CHUNK_MAX) {
      const n = Math.min(CHUNK_MAX, bytes.length - p);
      const c = lz4Encode(bytes, p, n, tmp, 0);
      const part = new Uint8Array(16 + c);
      const dv = new DataView(part.buffer);
      dv.setUint32(0, CHUNK_MAGIC, true); dv.setUint32(4, c, true); dv.setUint32(8, n, true); dv.setUint32(12, 0, true);
      part.set(tmp.subarray(0, c), 16);
      parts.push(part); total += part.length;
    }
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---------------------------------------------------------------- meta file (XXTEA)
  const META_HEADER = 0xEEEEEEBE;
  const KEY_TAIL = (() => { const s = 'NAESEVADNAYRTNRG'; const k = []; for (let i = 0; i < 16; i += 4) k.push((s.charCodeAt(i) | s.charCodeAt(i + 1) << 8 | s.charCodeAt(i + 2) << 16 | s.charCodeAt(i + 3) << 24) >>> 0); return k; })();
  const META_LEN = { VANILLA: 0x68, WAYPOINT: 0x168, WORLDS1: 0x180, WORLDS2: 0x1B0 };
  const DELTA = 0x9E3779B9;

  function metaKey(slot) {
    const x = (slot ^ 0x1422CB8C) >>> 0;
    const rot = ((x << 13) | (x >>> 19)) >>> 0;
    return [(Math.imul(rot, 5) + 0xE6546B64) >>> 0, KEY_TAIL[1], KEY_TAIL[2], KEY_TAIL[3]];
  }
  function rounds(len) { return len === META_LEN.VANILLA ? 8 : 6; }
  function mx(y, z, sum, k, p, e) { return ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z))) >>> 0; }

  function xxteaDecrypt(v, k, iter) {
    const n = v.length, last = n - 1;
    let sum = Math.imul(iter, DELTA) >>> 0, y = v[0], z;
    for (let i = 0; i < iter; i++) {
      const e = (sum >>> 2) & 3;
      for (let p = last; p > 0; p--) { z = v[p - 1]; v[p] = (v[p] - mx(y, z, sum, k, p, e)) >>> 0; y = v[p]; }
      z = v[last]; v[0] = (v[0] - mx(y, z, sum, k, 0, e)) >>> 0; y = v[0];
      sum = (sum - DELTA) >>> 0;
    }
    return v;
  }
  function xxteaEncrypt(v, k, iter) {
    const n = v.length, last = n - 1;
    let sum = 0, z = v[last], y;
    for (let i = 0; i < iter; i++) {
      sum = (sum + DELTA) >>> 0;
      const e = (sum >>> 2) & 3;
      for (let p = 0; p < last; p++) { y = v[p + 1]; v[p] = (v[p] + mx(y, z, sum, k, p, e)) >>> 0; z = v[p]; }
      y = v[0]; v[last] = (v[last] + mx(y, z, sum, k, last, e)) >>> 0; z = v[last];
    }
    return v;
  }

  function u32s(bytes) { const v = new Uint32Array(bytes.length >>> 2); new Uint8Array(v.buffer).set(bytes.subarray(0, v.length * 4)); return v; }

  /** Storage slot for a file name: accountdata.hg → 1, save.hg → 2, save2.hg → 3, … save30.hg → 31. */
  function slotFromName(name) {
    const n = name.toLowerCase().replace(/^mf_/, '');
    if (n.startsWith('accountdata')) return 1;
    const m = n.match(/^save(\d*)\.hg$/);
    if (!m) return -1;
    return (m[1] ? parseInt(m[1], 10) : 1) + 1;
  }

  function decryptMeta(bytes, preferredSlot) {
    if (![META_LEN.VANILLA, META_LEN.WAYPOINT, META_LEN.WORLDS1, META_LEN.WORLDS2].includes(bytes.length))
      throw new Error('Unknown meta file length ' + bytes.length + ' (expected 104/360/384/432)');
    const iter = rounds(bytes.length);
    const order = [preferredSlot]; for (let s = 0; s <= 31; s++) if (s !== preferredSlot) order.push(s);
    for (const slot of order) {
      if (slot < 0) continue;
      const v = xxteaDecrypt(u32s(bytes), metaKey(slot), iter);
      if (v[0] === META_HEADER) return { words: v, slot, iter };
    }
    throw new Error('Could not decrypt meta file (header not found for any slot)');
  }

  function encryptMeta(words, slot, iter) {
    const v = xxteaEncrypt(new Uint32Array(words), metaKey(slot), iter);
    return new Uint8Array(v.buffer);
  }

  function readCString(bytes, off, max) {
    let e = off; while (e < off + max && bytes[e] !== 0) e++;
    return new TextDecoder().decode(bytes.subarray(off, e));
  }

  function parseMeta(words) {
    const b = new Uint8Array(words.buffer, words.byteOffset, words.byteLength);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const len = b.length;
    const m = {
      length: len, format: words[1], sizeDecompressed: words[14], sizeDisk: words[15], baseVersion: words[17],
      gameMode: dv.getUint16(72, true), season: dv.getUint16(74, true),
      totalPlayTime: Number(dv.getBigUint64(76, true)),
    };
    if (len >= META_LEN.WAYPOINT) {
      m.saveName = readCString(b, 88, 128);
      m.saveSummary = readCString(b, 216, 128);
      m.difficultyPreset = b[344];
    }
    if (len >= META_LEN.WORLDS1) m.timestamp = words[89];
    return m;
  }

  function writeCString(bytes, off, max, str) {
    const enc = new TextEncoder().encode(str);
    const n = Math.min(enc.length, max - 1);
    bytes.fill(0, off, off + max);
    bytes.set(enc.subarray(0, n), off);
  }

  /** Patch a decrypted meta for a newly written data file. Keeps every unknown byte as-is. */
  function patchMeta(words, { sizeDecompressed, sizeDisk, timestamp, saveName, saveSummary }) {
    const w = new Uint32Array(words);
    const b = new Uint8Array(w.buffer);
    if (w[1] < 0x7D2) throw new Error('Pre-Frontiers (meta format ' + w[1] + ') saves are not supported');
    w[14] = sizeDecompressed >>> 0;
    if (b.length >= META_LEN.WORLDS1) {
      w[15] = sizeDisk >>> 0;
      if (timestamp != null) w[89] = timestamp >>> 0;
    }
    if (b.length >= META_LEN.WAYPOINT) {
      if (saveName != null) writeCString(b, 88, 128, saveName);
      if (saveSummary != null) writeCString(b, 216, 128, saveSummary);
    }
    return w;
  }

  // ---------------------------------------------------------------- bytes <-> text (lossless)
  // Valid UTF-8 decodes normally. Any byte that is not part of a valid sequence becomes U+F780+(b-0x80),
  // and is turned back into that exact byte when encoding. Hashed tech IDs therefore survive untouched.
  const RAW_BASE = 0xF700;
  function decodeText(bytes) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), raw: false }; } catch (_) { /* fall through */ }
    const out = []; let chunk = []; let i = 0; const n = bytes.length;
    const flush = () => { out.push(String.fromCharCode.apply(null, chunk)); chunk = []; };
    while (i < n) {
      const b = bytes[i];
      let cp = -1, len = 1;
      if (b < 0x80) cp = b;
      else if (b >= 0xC2 && b <= 0xDF && i + 1 < n && (bytes[i + 1] & 0xC0) === 0x80) { cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F); len = 2; }
      else if (b >= 0xE0 && b <= 0xEF && i + 2 < n && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
        const c = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
        if (c >= 0x800 && (c < 0xD800 || c > 0xDFFF) && !(c >= RAW_BASE + 0x80 && c <= RAW_BASE + 0xFF)) { cp = c; len = 3; }
      } else if (b >= 0xF0 && b <= 0xF4 && i + 3 < n && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80 && (bytes[i + 3] & 0xC0) === 0x80) {
        const c = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        if (c >= 0x10000 && c <= 0x10FFFF) { cp = c; len = 4; }
      }
      if (cp < 0) { chunk.push(RAW_BASE + b); }
      else if (cp > 0xFFFF) { const c = cp - 0x10000; chunk.push(0xD800 + (c >> 10), 0xDC00 + (c & 0x3FF)); }
      else chunk.push(cp);
      i += len;
      if (chunk.length > 8000) flush();
    }
    flush();
    return { text: out.join(''), raw: true };
  }

  const RAW_RE = /[\uF780-\uF7FF]/;
  function encodeText(text) {
    if (!RAW_RE.test(text)) return new TextEncoder().encode(text);
    const parts = []; let total = 0; let last = 0;
    const re = /[\uF780-\uF7FF]+/g; let m;
    const enc = new TextEncoder();
    while ((m = re.exec(text))) {
      if (m.index > last) { const p = enc.encode(text.slice(last, m.index)); parts.push(p); total += p.length; }
      const raw = new Uint8Array(m[0].length);
      for (let i = 0; i < m[0].length; i++) raw[i] = m[0].charCodeAt(i) - RAW_BASE;
      parts.push(raw); total += raw.length; last = m.index + m[0].length;
    }
    if (last < text.length) { const p = enc.encode(text.slice(last)); parts.push(p); total += p.length; }
    const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---------------------------------------------------------------- lossless JSON
  // Objects → Map (keeps order, including numeric-looking keys). Numbers → Num (raw lexeme kept).
  // Strings whose raw form isn't what we'd re-emit → Str (raw kept until edited).
  class Num { constructor(raw) { this.raw = raw; } valueOf() { return Number(this.raw); } toString() { return this.raw; } }
  class Str { constructor(value, raw) { this.value = value; this.raw = raw; } toString() { return this.value; } }

  function parseJSON(text) {
    let i = 0; const n = text.length;
    const ws = () => { let c; while (i < n && ((c = text.charCodeAt(i)) === 32 || c === 10 || c === 13 || c === 9)) i++; };
    const fail = (msg) => { throw new Error('JSON: ' + msg + ' at ' + i + ' near ' + JSON.stringify(text.slice(Math.max(0, i - 30), i + 30))); };
    function str() {
      const start = ++i; // after opening quote
      let simple = true;
      for (;;) {
        if (i >= n) fail('unterminated string');
        const c = text.charCodeAt(i);
        if (c === 34) break;
        if (c === 92) { simple = false; i += 2; continue; }
        if (c < 32) simple = false;
        i++;
      }
      const raw = text.slice(start, i); i++;
      if (simple) return raw;
      // decode escapes (lenient: a backslash followed by a raw control char is treated as its escape letter)
      let out = '';
      for (let j = 0; j < raw.length; j++) {
        const c = raw[j];
        if (c !== '\\') { out += c; continue; }
        const e = raw[++j];
        switch (e) {
          case '"': out += '"'; break; case '\\': out += '\\'; break; case '/': out += '/'; break;
          case 'b': out += '\b'; break; case 'f': out += '\f'; break; case 'n': case '\n': out += '\n'; break;
          case 'r': case '\r': out += '\r'; break; case 't': case '\t': out += '\t'; break;
          case 'u': out += String.fromCharCode(parseInt(raw.substr(j + 1, 4), 16)); j += 4; break;
          default: out += e;
        }
      }
      return escapeStr(out) === raw ? out : new Str(out, raw);
    }
    function val() {
      ws();
      const c = text.charCodeAt(i);
      if (c === 123) { // {
        i++; const m = new Map(); ws();
        if (text.charCodeAt(i) === 125) { i++; return m; }
        for (;;) {
          ws(); if (text.charCodeAt(i) !== 34) fail('expected key');
          let k = str(); if (k instanceof Str) k = k.value;
          ws(); if (text.charCodeAt(i) !== 58) fail('expected :'); i++;
          m.set(k, val()); ws();
          const d = text.charCodeAt(i++);
          if (d === 44) continue; if (d === 125) return m; i--; fail('expected , or }');
        }
      }
      if (c === 91) { // [
        i++; const a = []; ws();
        if (text.charCodeAt(i) === 93) { i++; return a; }
        for (;;) {
          a.push(val()); ws();
          const d = text.charCodeAt(i++);
          if (d === 44) continue; if (d === 93) return a; i--; fail('expected , or ]');
        }
      }
      if (c === 34) return str();
      if (c === 116 && text.startsWith('true', i)) { i += 4; return true; }
      if (c === 102 && text.startsWith('false', i)) { i += 5; return false; }
      if (c === 110 && text.startsWith('null', i)) { i += 4; return null; }
      const s = i;
      while (i < n) { const d = text.charCodeAt(i); if ((d >= 48 && d <= 57) || d === 45 || d === 43 || d === 46 || d === 101 || d === 69) i++; else break; }
      if (s === i) fail('unexpected character');
      return new Num(text.slice(s, i));
    }
    const v = val(); ws();
    return v;
  }

  const ESC_RE = /["\\\u0000-\u001f]/g;
  const ESC_MAP = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
  function escapeStr(s) { return s.replace(ESC_RE, (c) => ESC_MAP[c] || '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); }

  function stringifyJSON(v, indent) {
    const out = [];
    const nl = indent ? '\n' : '';
    (function w(x, depth) {
      if (x === null) out.push('null');
      else if (x === true) out.push('true');
      else if (x === false) out.push('false');
      else if (x instanceof Num) out.push(x.raw);
      else if (x instanceof Str) out.push('"', x.raw, '"');
      else if (typeof x === 'string') out.push('"', escapeStr(x), '"');
      else if (typeof x === 'number') out.push(Number.isFinite(x) ? String(x) : '0');
      else if (Array.isArray(x)) {
        if (!x.length) { out.push('[]'); return; }
        const pad = indent ? indent.repeat(depth + 1) : '';
        out.push('[');
        for (let j = 0; j < x.length; j++) { if (j) out.push(','); out.push(nl, pad); w(x[j], depth + 1); }
        out.push(nl, indent ? indent.repeat(depth) : '', ']');
      } else if (x instanceof Map) {
        if (!x.size) { out.push('{}'); return; }
        const pad = indent ? indent.repeat(depth + 1) : '';
        out.push('{'); let first = true;
        for (const [k, val] of x) { if (!first) out.push(','); first = false; out.push(nl, pad, '"', escapeStr(k), '":', indent ? ' ' : ''); w(val, depth + 1); }
        out.push(nl, indent ? indent.repeat(depth) : '', '}');
      } else throw new Error('Cannot serialize ' + typeof x);
    })(v, 0);
    return out.join('');
  }

  // ---------------------------------------------------------------- whole save
  /** Decode a save. data/meta are Uint8Array; name is the data file name (e.g. "save3.hg"). */
  function readSave(dataBytes, metaBytes, name) {
    const { bytes, compressed } = decompressData(dataBytes);
    let end = bytes.indexOf(0); if (end < 0) end = bytes.length;
    const { text, raw } = decodeText(bytes.subarray(0, end));
    const json = parseJSON(text);
    let meta = null;
    if (metaBytes && metaBytes.length) {
      const dec = decryptMeta(metaBytes, slotFromName(name || ''));
      meta = { ...dec, info: parseMeta(dec.words) };
    }
    return { json, meta, compressed, hadRawBytes: raw, originalSize: bytes.length, name };
  }

  /** Encode a save back to { data, meta } bytes. */
  function writeSave(save, opts = {}) {
    const text = stringifyJSON(save.json);
    const body = encodeText(text);
    const plain = new Uint8Array(body.length + 1); plain.set(body); // + null terminator
    const data = save.compressed ? compressData(plain) : plain;
    let meta = null;
    if (save.meta) {
      const words = patchMeta(save.meta.words, {
        sizeDecompressed: plain.length, sizeDisk: data.length,
        timestamp: opts.timestamp != null ? opts.timestamp : Math.floor(Date.now() / 1000),
        saveName: opts.saveName, saveSummary: opts.saveSummary,
      });
      meta = encryptMeta(words, save.meta.slot, save.meta.iter);
    }
    return { data, meta, plainSize: plain.length };
  }

  const api = { lz4Decode, lz4Encode, lz4Bound, decompressData, compressData, isChunked,
    metaKey, xxteaDecrypt, xxteaEncrypt, decryptMeta, encryptMeta, parseMeta, patchMeta, slotFromName, META_LEN,
    decodeText, encodeText, parseJSON, stringifyJSON, escapeStr, Num, Str, readSave, writeSave };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NMSCodec = api;
})(typeof self !== 'undefined' ? self : this);
