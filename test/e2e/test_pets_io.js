// Companions in and out as files (owner 2026-11-16, a tester's request): Export writes a .pet.json with the companion
// and its accessories in plain key names; Import puts one into an empty slot or over another, exactly as exported,
// with its keys in the save's own order; bare companion entries import too; other JSON is refused; it all saves.
// Usage: node test/e2e/test_pets_io.js <scratch dir with dbroot/NMS (a real save with companions)>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const SP = process.argv[2];
const fails = []; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
(async () => {
  const T = path.join(SP, 'petsio'); fs.rmSync(T, { recursive: true, force: true });
  const root = path.join(T, 'root'), home = path.join(T, 'home'); fs.cpSync(SP + '/dbroot/NMS', root, { recursive: true }); fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
  const proc = spawn(path.join(__dirname, '../../dist/hse-linux'), ['-no-window', '-root', root, '-port', '47994'], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(T, 'cfg'), HSE_BLENDER: '/nonexistent' } });
  const url = await new Promise((res) => proc.stdout.on('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(url); await p.waitForSelector('.slot-row'); await p.click('.slot-row'); await p.waitForSelector('#app:not(.hidden)'); await p.evaluate(() => go('companions')); await p.waitForSelector('#pName'); };
  await open();
  // the companion picked first, as text, and its accessories
  const entry = (i) => p.evaluate((i) => ({ pet: C.stringifyJSON(g(ps(), 'Pets')[i]), acc: C.stringifyJSON((g(ps(), 'PetAccessoryCustomisation') || [])[i] || null), keys: [...g(ps(), 'Pets')[i].keys()].join('|') }), i);
  const info = await p.evaluate(() => { const pets = g(ps(), 'Pets'); const have = pets.map((q, i) => i).filter((i) => isPet(pets[i])); const slots = g(ps(), 'UnlockedPetSlots'); return { pick: S.pets.pick, have, free: pets.map((q, i) => i).filter((i) => !isPet(pets[i]) && (!Array.isArray(slots) || slots[i] !== false)), name: petName(pets[S.pets.pick], S.pets.pick) }; });
  console.log(info.name, 'slot', info.pick, '|', info.have.length, 'companions,', info.free.length, 'free slots');
  ok('the page has Add, Import and Export buttons', !!(await p.$('#addPet')) && !!(await p.$('#importPet')) && /Export/.test(await p.textContent('#exportPet')));
  // ---- export
  await p.click('#exportPet'); await p.waitForTimeout(800);
  const exp = path.join(home, 'Documents', 'Harmonious Save Editor', 'Exports');
  const file = fs.existsSync(exp) && fs.readdirSync(exp).find((f) => f.endsWith('.pet.json'));
  ok('Export writes a .pet.json to Exports', !!file);
  const text = file ? fs.readFileSync(path.join(exp, file), 'utf8') : '{}', doc = JSON.parse(text);
  ok('…with the companion in plain key names and its accessories', doc.Harmonious && doc.Harmonious.kind === 'companion' && /^\^/.test(doc.Companion.CreatureID) && 'Trust' in doc.Companion && 'Descriptors' in doc.Companion && !!doc.Accessories);
  const before = await entry(info.pick);
  // ---- import into an empty slot (or over another companion when there is none)
  const put = async (txt, name, choose) => {
    await p.evaluate(([txt, name]) => { importPetDialog(g(ps(), 'Pets'), g(ps(), 'UnlockedPetSlots'), new File([txt], name)); }, [txt, name]);
    await p.waitForSelector('#petWhere');
    const opts = await p.$$eval('#petWhere option', (o) => o.map((x) => [x.value, x.textContent]));
    if (choose) await p.selectOption('#petWhere', choose(opts));
    const slot = +(await p.$eval('#petWhere', (s) => s.value));
    await p.click('#dlgActs .btn.primary'); await p.waitForTimeout(400);
    return { slot, opts };
  };
  const target = info.free.length ? null : info.have.find((i) => i !== info.pick);
  const r1 = await put(text, file || 'x.pet.json', target != null ? () => String(target) : null);
  console.log('options:', r1.opts.map((o) => o[1]).slice(0, 4).join(' / '));
  ok('Import offers an empty slot first when there is one', info.free.length ? /Empty slot/.test(r1.opts[0][1]) : /Replace/.test(r1.opts[0][1]));
  const after = await entry(r1.slot);
  ok('…and the imported companion is exactly the one exported', after.pet === before.pet && after.acc === before.acc);
  ok('…keys in the save\'s order', after.keys === before.keys);
  ok('…the page shows it, and there are unsaved changes', await p.evaluate((s) => S.pets.pick === s && S.dirty, r1.slot) && (await p.$eval('#pName', (e) => e.value)) === (await p.evaluate((s) => str(g(g(ps(), 'Pets')[s], 'CustomName')), r1.slot)));
  // ---- replacing another companion
  const other = await p.evaluate((skip) => g(ps(), 'Pets').map((q, i) => i).find((i) => isPet(g(ps(), 'Pets')[i]) && !skip.includes(i)), [info.pick, r1.slot]);
  if (other != null) {
    const r2 = await put(text, 'again.pet.json', (opts) => opts.find(([v]) => +v === other)[0]);
    ok('Import can replace a chosen companion', r2.slot === other && (await entry(other)).pet === before.pet);
  }
  // ---- a bare companion entry (as other tools write them) and a file that isn't one
  const bare = await p.evaluate((t) => C.stringifyJSON(C.parseJSON(t).get('Companion')), text);
  const r3 = await put(bare, 'bare.json', (opts) => opts[opts.length - 1][0]);
  ok('a bare companion entry imports too', (await entry(r3.slot)).pet === before.pet);
  await p.evaluate(() => importPetDialog(g(ps(), 'Pets'), g(ps(), 'UnlockedPetSlots'), new File(['{"Ship": {}}'], 'ship.json'))); await p.waitForTimeout(300);
  const tt = await p.textContent('#toast'); console.log('toast:', tt);
  ok('a file without a companion is refused', /doesn't hold a companion/.test(tt) && !(await p.$('#dlg[open] #petWhere')));
  // ---- it all saves and comes back
  await p.click('#saveBtn'); await p.waitForSelector('#dlg[open]'); await p.click('#dlgActs .btn.primary'); await p.waitForFunction(() => !S.dirty, null, { timeout: 30000 }).catch(() => {});
  await open();
  ok('after saving and reopening, the imported companion is there', (await entry(r1.slot)).pet === before.pet && (await entry(r1.slot)).acc === before.acc);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close(); proc.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
})();
