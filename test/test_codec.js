// Round-trip tests for the codec against fixtures built with python-lz4 + the literal libNOM port.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const C = require('../src/codec.js');
const dir = process.argv[2];
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
const eq = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const py = (...a) => execFileSync('python3', a, { encoding: 'utf8' });

// 1. LZ4: our encoder → reference decoder, and reference encoder → our decoder, on varied inputs
const samples = [Buffer.alloc(0), Buffer.from('a'), Buffer.from('abcabcabcabcabcabcabcabc'), Buffer.alloc(100000, 7),
  require('crypto').randomBytes(70000), Buffer.from(JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i, v: 'x'.repeat(i % 40) }))))];
samples.forEach((s, idx) => {
  const dst = new Uint8Array(C.lz4Bound(s.length));
  const n = C.lz4Encode(new Uint8Array(s), 0, s.length, dst, 0);
  const f = path.join(dir, 'lz.bin'); fs.writeFileSync(f, dst.subarray(0, n));
  const back = py('-c', `import lz4.block,sys;d=open('${f}','rb').read();sys.stdout.write(lz4.block.decompress(d,uncompressed_size=${s.length}).hex())`);
  ok(back === s.toString('hex'), `lz4 encode→python decode sample ${idx} (${s.length}B → ${n}B)`);
  fs.writeFileSync(f, s);
  const ref = Buffer.from(py('-c', `import lz4.block,sys;sys.stdout.write(lz4.block.compress(open('${f}','rb').read(),store_size=False).hex())`), 'hex');
  const out = new Uint8Array(s.length);
  const m = s.length ? C.lz4Decode(new Uint8Array(ref), 0, ref.length, out, 0) : 0;
  ok(m === s.length && eq(out, s), `python encode→lz4 decode sample ${idx}`);
});

// 2. XXTEA: our encrypt is inverse of our decrypt for non-zero tails; matches libNOM port both ways
const rnd = new Uint32Array(108); require('crypto').randomFillSync(rnd);
for (const [len, it] of [[26, 8], [90, 6], [96, 6], [108, 6]]) {
  const v = rnd.slice(0, len);
  const enc = C.xxteaEncrypt(new Uint32Array(v), C.metaKey(5), it);
  const dec = C.xxteaDecrypt(new Uint32Array(enc), C.metaKey(5), it);
  ok(eq(new Uint8Array(dec.buffer), new Uint8Array(v.buffer)), `xxtea inverse len=${len}`);
  const fin = path.join(dir, 'x_in.bin'), fout = path.join(dir, 'x_out.bin');
  fs.writeFileSync(fin, new Uint8Array(enc.buffer));
  py(path.join(__dirname, 'libnom_port.py'), 'd', '5', String(it), fin, fout);
  ok(eq(fs.readFileSync(fout), new Uint8Array(v.buffer)), `libNOM decrypt of our encrypt len=${len}`);
  const z = new Uint32Array(v); z[len - 1] = 0; // libNOM encrypt assumes zero tail
  fs.writeFileSync(fin, new Uint8Array(z.buffer));
  py(path.join(__dirname, 'libnom_port.py'), 'e', '5', String(it), fin, fout);
  const ours = C.xxteaEncrypt(new Uint32Array(z), C.metaKey(5), it);
  ok(eq(fs.readFileSync(fout), new Uint8Array(ours.buffer)), `our encrypt == libNOM encrypt (zero tail) len=${len}`);
}

// 3. Full save read
const data = new Uint8Array(fs.readFileSync(path.join(dir, 'save3.hg')));
const meta = new Uint8Array(fs.readFileSync(path.join(dir, 'mf_save3.hg')));
const plain = fs.readFileSync(path.join(dir, 'plain.bin'));
let t = Date.now();
const save = C.readSave(data, meta, 'save3.hg');
console.log(`  read ${(plain.length / 1e6).toFixed(1)} MB in ${Date.now() - t} ms`);
ok(save.meta.slot === 4, 'meta decrypted with slot 4 (save3.hg)');
ok(save.meta.info.saveName === 'Harmonious Café ★', 'meta save name: ' + save.meta.info.saveName);
ok(save.meta.info.sizeDecompressed === plain.length, 'meta decompressed size');
ok(save.hadRawBytes, 'raw (hashed tech) bytes detected');
const ps = save.json.get('vLc').get('6f=');
ok(String(ps.get('wGS')) === '4294967295', 'units read');
ok(String(ps.get('Big')) === '18446744073709551615', 'u64 kept exact');
ok(String(ps.get('Float')) === '1.0', 'float lexeme kept');
ok([...ps.keys()].slice(9, 12).join() === '623,100,2', 'numeric-looking key order kept');
ok(String(ps.get('Esc')) === 'a/b é "q" tab\tend', 'escapes decoded: ' + JSON.stringify(String(ps.get('Esc'))));

// 4. Untouched write is byte-identical in content
t = Date.now();
const w0 = C.writeSave(save, { timestamp: 1761000000 });
console.log(`  write in ${Date.now() - t} ms`);
const re0 = C.decompressData(w0.data).bytes;
ok(eq(re0, plain), 'unedited save re-encodes to identical plaintext');
// reference LZ4 can read our chunks
fs.writeFileSync(path.join(dir, 'out_save3.hg'), w0.data); fs.writeFileSync(path.join(dir, 'out_mf_save3.hg'), w0.meta);
const chk = py('-c', `
import struct,lz4.block,sys
d=open('${dir}/out_save3.hg','rb').read();o=0;out=b''
while o<len(d):
  m,c,u,z=struct.unpack_from('<IIII',d,o);assert m==0xFEEDA1E5 and z==0;out+=lz4.block.decompress(d[o+16:o+16+c],uncompressed_size=u);o+=16+c
sys.stdout.write(str(out==open('${dir}/plain.bin','rb').read()))`);
ok(chk === 'True', 'python-lz4 decodes our data file to the original plaintext');
py(path.join(__dirname, 'libnom_port.py'), 'd', '4', '6', path.join(dir, 'out_mf_save3.hg'), path.join(dir, 'out_meta_plain.bin'));
const mOut = fs.readFileSync(path.join(dir, 'out_meta_plain.bin')), mIn = fs.readFileSync(path.join(dir, 'meta_plain.bin'));
ok(eq(mOut.subarray(0, 60), mIn.subarray(0, 60)) && eq(mOut.subarray(64), mIn.subarray(64)) && mOut.readUInt32LE(60) === w0.data.length,
  'libNOM-decrypted meta identical to original except compressed size (now ' + w0.data.length + ')');

// 5. Edited write: sizes patched, everything else in meta preserved
ps.set('wGS', new C.Num('999999'));
ps.set('Esc', 'changed "value" \\ ok');
const w1 = C.writeSave(save, { timestamp: 1761111111, saveName: 'Renamed' });
fs.writeFileSync(path.join(dir, 'out2_mf.hg'), w1.meta);
py(path.join(__dirname, 'libnom_port.py'), 'd', '4', '6', path.join(dir, 'out2_mf.hg'), path.join(dir, 'out2_meta_plain.bin'));
const m2 = fs.readFileSync(path.join(dir, 'out2_meta_plain.bin'));
ok(m2.readUInt32LE(0) === 0xEEEEEEBE, 'edited meta header ok via libNOM decrypt');
ok(m2.readUInt32LE(56) === w1.plainSize && m2.readUInt32LE(60) === w1.data.length, 'edited meta sizes patched');
ok(m2.readUInt32LE(356) === 1761111111, 'timestamp patched');
ok(m2.toString('utf8', 88, 95) === 'Renamed' && m2[95] === 0, 'save name patched');
const untouched = [[0, 56], [64, 88], [216, 356], [360, 432]];
ok(untouched.every(([a, b]) => eq(m2.subarray(a, b), mIn.subarray(a, b))), 'all other meta bytes preserved');
const again = C.readSave(w1.data, w1.meta, 'save3.hg');
const ps2 = again.json.get('vLc').get('6f=');
ok(String(ps2.get('wGS')) === '999999' && String(ps2.get('Esc')) === 'changed "value" \\ ok', 'edits survive re-read');
const tech = again.json.get('vLc').get('6f=').get('PMT').get(':No')[0].get('b2n');
const techBytes = C.encodeText(String(tech));
const hashed = fs.readFileSync(require('path').join(__dirname, '../vendor/libnom/hashed_technology.bin')).toString('latin1').split('\0')[3];
ok(eq(techBytes, Buffer.from('^' + hashed + '#', 'latin1')), 'hashed tech id bytes preserved through edit');

// 6. Wrong-slot meta (file renamed by user) still decrypts
const s3 = C.readSave(data, meta, 'save7.hg');
ok(s3.meta.slot === 4, 'falls back to scanning slots when file was renamed');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
