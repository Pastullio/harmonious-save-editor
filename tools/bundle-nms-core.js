// Bundles vendor/nms-core (ES modules) into one plain script for the page: each module runs in its own
// function scope, imports become lookups in a small module table, and the result is `const NMSGEN = {...}`.
// The letter map (3 MB of JSON) goes in gzipped and base64-encoded; the page unpacks it on first use.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DIR = path.join(__dirname, '../vendor/nms-core');
const ORDER = ['prng', 'iprng', 'roman', 'alphasets', 'generator', 'region', 'system', 'planet'];

function bundle() {
  let out = '// nms-core (MIT): elegra1965, from hadsh/nms_namegen by Stuart Coyle, hadsh and GoodGuysFree. See vendor/nms-core.\nconst NMSGEN = (() => {\nconst __m = {};\n';
  for (const name of ORDER) {
    let src = fs.readFileSync(path.join(DIR, name + '.js'), 'utf8');
    const exported = [];
    src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)\.js(?:\?[^']*)?';?\s*$/gm, (_, names, mod) => {
      if (!ORDER.includes(mod)) throw new Error(`${name}.js imports unknown module ${mod}`);
      return `const {${names}} = __m[${JSON.stringify(mod)}];`;
    });
    src = src.replace(/^export\s+(const|function|class|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, id) => { exported.push(id); return `${kw} ${id}`; });
    src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => { for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) exported.push(n.replace(/\s+as\s+/, ':')); return ''; });
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${name}.js has an import/export the bundler doesn't handle`);
    const obj = exported.map((e) => (e.includes(':') ? `${e.split(':')[1]}: ${e.split(':')[0]}` : e)).join(', ');
    out += `__m[${JSON.stringify(name)}] = (() => {\n${src}\nreturn { ${obj} };\n})();\n`;
  }
  out += 'return Object.assign({}, ...Object.values(__m));\n})();\n';
  return out;
}

function letterMap() {
  const all = {};
  for (let i = 0; i < 8; i++) all[String(i)] = JSON.parse(fs.readFileSync(path.join(DIR, `letter-map/letter_map_${i}.json`), 'utf8'));
  return zlib.gzipSync(Buffer.from(JSON.stringify(all)), { level: 9 }).toString('base64');
}

module.exports = { bundle, letterMap };
if (require.main === module) { const b = bundle(); fs.writeFileSync(process.argv[2] || '/dev/stdout', b + '\nif (typeof module !== "undefined") module.exports = NMSGEN;\n'); }
