#!/usr/bin/env node
// Build a clean ./dist folder for hosting (Cloudflare Pages, GitHub Pages, ...).
//
//   node tools/build.js
//
// 1. regenerates the data bundles from the JSON files in ./data (tools/build-data.js), after validating them
// 2. copies only what the site needs. Upload or drag the contents of ./dist.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

execFileSync(process.execPath, [path.join(__dirname, 'validate.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'build-data.js')], { stdio: 'inherit' });

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'data'), { recursive: true });

const copy = f => {
  if (!fs.existsSync(path.join(root, f))) { console.log('skip (missing):', f); return; }
  fs.copyFileSync(path.join(root, f), path.join(dist, f));
};
['index.html', 'style.css', 'app.js', 'viz.js', 'fonts.css', 'og.png'].forEach(copy);
fs.readdirSync(path.join(root, 'data')).filter(f => /^bundle..*.js$/.test(f)).forEach(f => copy('data/' + f));
fs.cpSync(path.join(root, 'fonts'), path.join(dist, 'fonts'), { recursive: true });

// Cache busting. Every script and stylesheet is requested as "file?v=<hash of its content>", so a changed file has a new address and a
// browser can never combine an old stylesheet with a new script. index.html itself is always revalidated (see _headers).
const crypto = require('crypto');
const stamp = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(dist, f))).digest('hex').slice(0, 10);
const lazy = ['viz.js', ...fs.readdirSync(path.join(dist, 'data')).filter(f => /^bundle\..*\.js$/.test(f)).map(f => 'data/' + f)];
const versioned = {};
lazy.forEach(f => { versioned[f] = stamp(f); });
// app.js loads viz.js and the lazy data bundles by name
let appJs = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
appJs = appJs.replace(/(['"])((?:viz|data\/bundle\.[a-z]+)\.js)\1/g, (m, q, f) => (versioned[f] ? q + f + '?v=' + versioned[f] + q : m));
fs.writeFileSync(path.join(dist, 'app.js'), appJs);
const direct = ['style.css', 'fonts.css', 'app.js', 'data/bundle.core.js'];
direct.forEach(f => { versioned[f] = stamp(f); });
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/(href|src)="(style\.css|fonts\.css|app\.js|data\/bundle\.core\.js)"/g, (m, a, f) => a + '="' + f + '?v=' + versioned[f] + '"');
fs.writeFileSync(path.join(dist, 'index.html'), html);
console.log('versioned asset URLs:', Object.keys(versioned).length);


fs.writeFileSync(path.join(dist, '_headers'),
`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/*.js
  Cache-Control: public, max-age=0, must-revalidate
/*.css
  Cache-Control: public, max-age=0, must-revalidate
/data/*
  Cache-Control: public, max-age=0, must-revalidate
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`);

let total = 0;
for (const f of [...fs.readdirSync(dist).filter(x => x !== 'data' && x !== 'fonts'), ...fs.readdirSync(path.join(dist, 'data')).map(x => 'data/' + x)]) {
  const size = fs.statSync(path.join(dist, f)).size;
  total += size;
  console.log(f.padEnd(24), (size / 1024).toFixed(0).padStart(5), 'KB');
}
console.log('total'.padEnd(16), (total / 1024).toFixed(0).padStart(5), 'KB  ->', dist);
