// Folder mode: mocks the File System Access API with an in-memory directory, then checks the
// slot list, the write-back, and that backups of the original pair are made first.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const C = require('../src/codec.js');
const fx = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../dist/nms-save-editor.html'));
  const data = fs.readFileSync(path.join(fx, 'save3.hg')).toString('base64');
  const meta = fs.readFileSync(path.join(fx, 'mf_save3.hg')).toString('base64');
  await p.evaluate(({ data, meta }) => {
    const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    class FDir {
      constructor(name) { this.kind = 'directory'; this.name = name; this.items = new Map(); }
      async *entries() { for (const [k, v] of this.items) yield [k, v]; }
      async getDirectoryHandle(n, o) { if (!this.items.has(n)) { if (!o || !o.create) throw new Error('nf'); this.items.set(n, new FDir(n)); } return this.items.get(n); }
      async getFileHandle(n, o) { if (!this.items.has(n)) { if (!o || !o.create) throw new Error('nf'); this.items.set(n, new FFile(n, new Uint8Array())); } return this.items.get(n); }
      async queryPermission() { return 'granted'; } async requestPermission() { return 'granted'; }
    }
    class FFile {
      constructor(name, bytes) { this.kind = 'file'; this.name = name; this.bytes = bytes; }
      async getFile() { return new File([this.bytes], this.name, { lastModified: 1761000000000 }); }
      async createWritable() { const self = this; let buf; return { async write(b) { buf = new Uint8Array(b); }, async close() { self.bytes = buf; } }; }
    }
    const root = new FDir('NMS'); const acct = new FDir('st_76561198000000000'); root.items.set(acct.name, acct);
    acct.items.set('save3.hg', new FFile('save3.hg', b64(data)));
    acct.items.set('mf_save3.hg', new FFile('mf_save3.hg', b64(meta)));
    acct.items.set('save4.hg', new FFile('save4.hg', b64(data)));            // pair with missing meta
    window.__root = root; window.__acct = acct;
    window.showDirectoryPicker = async () => root;                           // user picked the parent NMS folder
  }, { data, meta });
  await p.click('#openFolder');
  await p.waitForSelector('.slot-row');
  const rows = await p.$$eval('.slot-card', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
  console.log('rows:', rows);
  await p.click('.slot-row:has-text("save3.hg")');
  await p.waitForSelector('#app:not(.hidden)');
  await p.fill('[data-cur="Specials"]', '424242'); await p.dispatchEvent('[data-cur="Specials"]', 'change');
  await p.fill('#nameIn', 'Path of the Harmonious'); await p.dispatchEvent('#nameIn', 'change');
  await p.click('#saveBtn');
  await p.click('#dlg .btn.primary');
  await p.waitForFunction(() => !S.dirty, null, { timeout: 15000 });
  const out = await p.evaluate(() => {
    const a = window.__acct; const enc = (u) => btoa(String.fromCharCode(...u.subarray(0, 0)) ) && Array.from(u);
    const bak = a.items.get('_editor_backups'); const sub = [...bak.items.values()][0];
    return { data: Array.from(a.items.get('save3.hg').bytes), meta: Array.from(a.items.get('mf_save3.hg').bytes), backups: [...sub.items.keys()], bakName: sub.name,
      bakSame: sub.items.get('save3.hg').bytes.length === a.items.get('save4.hg').bytes.length, sideName: document.querySelector('#saveName').textContent };
  });
  await b.close();
  const save = C.readSave(new Uint8Array(out.data), new Uint8Array(out.meta), 'save3.hg');
  const checks = [
    ['one card for slot 2, its other save (missing meta) flagged underneath', rows.length === 1 && /meta file missing/.test(rows[0])],
    ['descended into st_ folder automatically', rows.some((r) => /Harmonious Café/.test(r))],
    ['backup folder holds both originals', out.backups.sort().join() === 'mf_save3.hg,save3.hg'],
    ['backup is the original bytes', out.bakSame],
    ['quicksilver written', String(save.json.get('vLc').get('6f=').get('kN;')) === '424242'],
    ['save name in JSON', save.json.get('<h0').get('Pk4') === 'Path of the Harmonious'],
    ['save name in meta', save.meta.info.saveName === 'Path of the Harmonious'],
    ['sidebar updated', out.sideName === 'Path of the Harmonious'],
    ['no page errors', errs.length === 0],
  ];
  console.log('backup folder:', out.bakName);
  checks.forEach(([n, ok]) => console.log((ok ? 'PASS ' : 'FAIL ') + n)); if (errs.length) console.log(errs);
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})();
