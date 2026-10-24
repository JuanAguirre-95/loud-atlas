#!/usr/bin/env node
// Build a clean ./dist folder for hosting (Cloudflare Pages, GitHub Pages, ...).
//
//   node tools/build.js
//
// Copies only what the site needs and slims data.mb.js (the app ignores MusicBrainz album lists,
// so they are dropped). Upload or drag the contents of ./dist.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);

const copy = f => {
  if (!fs.existsSync(path.join(root, f))) { console.log('skip (missing):', f); return; }
  fs.copyFileSync(path.join(root, f), path.join(dist, f));
};
['index.html', 'style.css', 'app.js', 'data.js', 'data.extra.js', 'data.wiki.js'].forEach(copy);

// data.mb.js: keep mbid, confidence, members; drop albums
const w = {};
new Function('window', fs.readFileSync(path.join(root, 'data.mb.js'), 'utf8'))(w);
for (const k of Object.keys(w.MB)) {
  delete w.MB[k].albums;
  w.MB[k].members = w.MB[k].members.map(m => ({ name: m.name, from: m.from, to: m.to }));   // person ids are unused by the app
}
fs.writeFileSync(path.join(dist, 'data.mb.js'),
  '// slimmed by tools/build.js (MusicBrainz, CC0)\n' +
  'window.MB = ' + JSON.stringify(w.MB) + ';\nwindow.MB_LINKS = ' + JSON.stringify(w.MB_LINKS) + ';\n');

fs.writeFileSync(path.join(dist, '_headers'),
`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/*.js
  Cache-Control: public, max-age=3600
/*.css
  Cache-Control: public, max-age=3600
`);

let total = 0;
for (const f of fs.readdirSync(dist)) {
  const size = fs.statSync(path.join(dist, f)).size;
  total += size;
  console.log(f.padEnd(16), (size / 1024).toFixed(0).padStart(5), 'KB');
}
console.log('total'.padEnd(16), (total / 1024).toFixed(0).padStart(5), 'KB  ->', dist);
