// Builds dist/nms-save-editor.html: inlines the codec and the key mapping into src/app.html.
const fs = require('fs'), path = require('path');
const MAP_DIR = process.env.LIBNOM_MAP || path.join(__dirname, 'vendor/libnom');

function loadMap(file) { return JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), 'utf8')); }
const mb = loadMap('mapping_mbincompiler.json');
const legacy = loadMap('mapping_legacy.json');

// libNOM splits the list at "UserSettingsData": entries before it are for saves, from it onward for accountdata.
function split(list) { const i = list.findIndex((p) => p.Value === 'UserSettingsData'); return i < 0 ? [list, []] : [list.slice(0, i), list.slice(i)]; }
const save = {}, account = {};
for (const src of [mb.Mapping, legacy.Mapping]) {
  const [s, a] = split(src);
  for (const p of s) if (!(p.Key in save)) save[p.Key] = p.Value;
  for (const p of a) if (!(p.Key in account)) account[p.Key] = p.Value;
}
const mapping = { version: mb.libMBIN_version, save, account };

let html = fs.readFileSync(path.join(__dirname, 'src/app.html'), 'utf8');
const codec = fs.readFileSync(path.join(__dirname, 'src/codec.js'), 'utf8');
const hero = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, 'src/assets/traveller.webp')).toString('base64');
html = html.replace('@@HERO@@', () => hero).replace('/*@@CODEC@@*/', () => codec).replace('/*@@MAPPING@@*/', () => 'const MAPPING = ' + JSON.stringify(mapping) + ';');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/nms-save-editor.html'), html);
fs.writeFileSync(path.join(__dirname, 'desktop/index.html'), html); // embedded into the desktop app
console.log('built dist/nms-save-editor.html', (html.length / 1024).toFixed(0) + ' KB', 'mapping keys', Object.keys(save).length, 'libMBIN', mb.libMBIN_version);
