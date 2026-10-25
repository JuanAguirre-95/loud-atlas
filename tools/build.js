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
['index.html', 'style.css', 'app.js', 'fonts.css'].forEach(copy);
fs.readdirSync(path.join(root, 'data')).filter(f => /^bundle..*.js$/.test(f)).forEach(f => copy('data/' + f));
fs.cpSync(path.join(root, 'fonts'), path.join(dist, 'fonts'), { recursive: true });

fs.writeFileSync(path.join(dist, '_headers'),
`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/*.js
  Cache-Control: public, max-age=3600
/*.css
  Cache-Control: public, max-age=3600
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
