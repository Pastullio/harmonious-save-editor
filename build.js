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
// Jost (SIL OFL, vendor/fonts/jost) is inlined so the app looks the same offline
const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};
const fonts = [300, 400, 500, 600].flatMap((w) => Object.entries(RANGES).map(([set, range]) => {
  const data = fs.readFileSync(path.join(__dirname, `vendor/fonts/jost/jost-${set}-${w}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:"Jost";font-style:normal;font-display:swap;font-weight:${w};src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range}}`;
})).join('\n');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src/assets/icon.png')).toString('base64');
const logo = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, 'src/assets/logo.webp')).toString('base64');
const glyphs = [...'0123456789ABCDEF'].map((d) => JSON.stringify('data:image/png;base64,' + fs.readFileSync(path.join(__dirname, `src/assets/glyphs/g${d}.png`)).toString('base64'))).join(',');
const hero = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, 'src/assets/traveller.webp')).toString('base64');
html = html.replace('/*@@FONTS@@*/', () => fonts).replace('@@HERO@@', () => hero).replace('@@ICON@@', () => icon).replace('@@LOGO@@', () => logo).replace('/*@@GLYPHS@@*/', () => glyphs).replace('/*@@CODEC@@*/', () => codec).replace('/*@@MAPPING@@*/', () => 'const MAPPING = ' + JSON.stringify(mapping) + ';');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/nms-save-editor.html'), html);
fs.writeFileSync(path.join(__dirname, 'desktop/index.html'), html); // embedded into the desktop app
console.log('built dist/nms-save-editor.html', (html.length / 1024).toFixed(0) + ' KB', 'mapping keys', Object.keys(save).length, 'libMBIN', mb.libMBIN_version);
