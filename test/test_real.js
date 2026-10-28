// Round-trip check against a real save from the owner's game. The save itself is not in the repo
// (saves are personal and *.hg is ignored); point REAL_SAVE_DIR at a folder holding save.hg + mf_save.hg.
//   REAL_SAVE_DIR=/path/to/folder node test/test_real.js
const fs = require('fs'), path = require('path');
const C = require('../src/codec.js');
const dir = process.env.REAL_SAVE_DIR || process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'save.hg'))) { console.log('SKIP no real save (set REAL_SAVE_DIR)'); process.exit(0); }
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const data = new Uint8Array(fs.readFileSync(path.join(dir, 'save.hg'))), meta = new Uint8Array(fs.readFileSync(path.join(dir, 'mf_save.hg')));
const s = C.readSave(data, meta, 'save.hg');
ok(s.meta.info.sizeDecompressed === s.originalSize, 'meta decompressed size matches the data (' + s.originalSize + ' bytes)');
const plain = C.decompressData(data).bytes;
const w = C.writeSave(s, { timestamp: s.meta.info.timestamp });
ok(Buffer.compare(Buffer.from(plain), Buffer.from(C.decompressData(w.data).bytes)) === 0, 'unedited save re-encodes byte-identical');
const a = Buffer.from(s.meta.words.buffer), b = Buffer.from(C.decryptMeta(w.meta, s.meta.slot).words.buffer);
const diff = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
ok(diff.every((i) => i >= 60 && i < 64), 'meta unchanged except the compressed-size field');
const back = C.readSave(w.data, w.meta, 'save.hg');
ok(C.stringifyJSON(back.json) === C.stringifyJSON(s.json), 'written save decodes to the same JSON');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
