#!/usr/bin/env node
// Cross-check album release years against a second, independent source.
//
//   node tools/verify-releases.js
//
// MusicBrainz gives every album its "first release date". Wikidata keeps its own publication date (P577) for notable albums,
// linked to the same MusicBrainz release-group id (P436). This tool asks Wikidata about the albums the site highlights (the
// key releases of both criteria), compares the years and writes:
//   data/release-checks.json   { "<release-group id>": { wd: <year>, mb: <year>, ok: true|false } } for albums Wikidata knows
//   tools/release-report.md    the disagreements, so each can be settled against a real source
// Albums that Wikidata does not know stay "single source" (MusicBrainz only).

const fs = require('fs');
const path = require('path');
const { cachedGet } = require('./lib/http');
const { writeKeyed, read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const acts = read(path.join(data, 'acts.json'));
const mb = read(path.join(data, 'musicbrainz.json'));

// the albums to check: every album that is a key release under either criterion, found by rebuilding the selection
const { execFileSync } = require('child_process');
execFileSync(process.execPath, [path.join(__dirname, 'build-data.js')], { stdio: 'ignore' });
const w = {};
new Function('window', fs.readFileSync(path.join(data, 'bundle.core.js'), 'utf8'))(w);
const keyKeys = new Set();                                                   // "<act id>|<title>|<year>"
for (const [id, list] of Object.entries(w.ATLAS.rel)) for (const r of list) keyKeys.add(id + '|' + r[0]);
const todo = [];
for (const a of acts) {
  const m = mb[a.id];
  if (!m) continue;
  for (const s of m.studio) if (keyKeys.has(a.id + '|' + s.t.replace(/[’‘`´]/g, "'").replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim())) todo.push({ act: a.name, t: s.t, y: s.y, rg: s.rg });
}

(async () => {
  const out = fs.existsSync(path.join(data, 'release-checks.json')) ? read(path.join(data, 'release-checks.json')) : {};
  const pending = todo.filter(x => !(x.rg in out));
  console.log(`${todo.length} key albums, ${pending.length} not yet checked`);
  for (let i = 0; i < pending.length; i += 80) {
    const batch = pending.slice(i, i + 80);
    const q = `SELECT ?mbid (SAMPLE(?item) AS ?item) (MIN(YEAR(?d)) AS ?y) WHERE { VALUES ?mbid { ${batch.map(b => '"' + b.rg + '"').join(' ')} } ?item wdt:P436 ?mbid; wdt:P577 ?d. } GROUP BY ?mbid`;
    const r = await cachedGet('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { gap: 1500, prefix: 'wq' });
    const got = new Map(((r && r.results && r.results.bindings) || []).map(x => [x.mbid.value, { y: +x.y.value, q: x.item.value.split('/').pop() }]));
    for (const b of batch) out[b.rg] = got.has(b.rg) ? { wd: got.get(b.rg).y, mb: b.y, ok: got.get(b.rg).y === b.y, q: got.get(b.rg).q } : { mb: b.y };
    process.stdout.write(`  ${Math.min(i + 80, pending.length)}/${pending.length}\r`);
  }
  // Where MusicBrainz and Wikidata disagree, ask the English Wikipedia article's infobox ("released") and go with two out of three.
  const dis = todo.filter(x => out[x.rg] && out[x.rg].wd != null && !out[x.rg].ok && out[x.rg].wp === undefined);
  if (dis.length) console.log('Tie-breaking ' + dis.length + ' disagreements against Wikipedia...');
  for (let i = 0; i < dis.length; i += 50) {
    const batch = dis.slice(i, i + 50);
    const r = await cachedGet('https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&sitefilter=enwiki&format=json&ids=' + batch.map(b => out[b.rg].q).join('|'), { gap: 700, prefix: 'wd' });
    for (const b of batch) {
      const e = r && r.entities && r.entities[out[b.rg].q], title = e && e.sitelinks && e.sitelinks.enwiki && e.sitelinks.enwiki.title;
      out[b.rg].wp = null;
      if (!title) continue;
      const pg = await cachedGet('https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&rvsection=0&redirects=1&format=json&formatversion=2&titles=' + encodeURIComponent(title), { gap: 600, prefix: 'wp' });
      const text = pg && pg.query && pg.query.pages && pg.query.pages[0].revisions && pg.query.pages[0].revisions[0].slots.main.content;
      const m = text && text.match(/\|\s*released\s*=\s*([^\n]*(?:\n(?!\s*\|)[^\n]*)*)/i);
      const y = m && (m[1].match(/\b(19[3-9]\d|20[0-3]\d)\b/) || [])[1];
      if (y) out[b.rg].wp = +y;
    }
  }
  for (const x of todo) {                                   // settle: any year two sources agree on wins; otherwise it stays a manual case
    const c = out[x.rg];
    if (!c || c.wd == null) continue;
    if (c.ok) { c.final = c.mb; continue; }
    const votes = [c.mb, c.wd, c.wp].filter(v => v != null), top = votes.find(v => votes.filter(u => u === v).length >= 2);
    if (top) c.final = top; else delete c.final;
  }
  writeKeyed(path.join(data, 'release-checks.json'), out);
  const known = todo.filter(x => out[x.rg] && out[x.rg].wd != null);
  const bad = known.filter(x => !out[x.rg].ok), fixed = bad.filter(x => out[x.rg].final != null && out[x.rg].final !== x.y), open = bad.filter(x => out[x.rg].final == null);
  const summary = `Wikidata knows ${known.length} of ${todo.length} key albums; ${known.length - bad.length} agree with MusicBrainz, ${bad.length} differ: ${bad.length - fixed.length - open.length} settled in MusicBrainz's favour, ${fixed.length} corrected by two sources, ${open.length} undecided.`;
  console.log('\n' + summary);
  const lines = ['# Release date cross-check', '', 'Generated ' + new Date().toISOString().slice(0, 10) + ' by tools/verify-releases.js (MusicBrainz first-release-date vs Wikidata publication date, Wikipedia infobox as tie-breaker).', '',
    summary, '', '## Disagreements', '',
    ...bad.map(x => '- **' + x.act + '**: ' + x.t + ' — MusicBrainz ' + x.y + ', Wikidata ' + out[x.rg].wd + ', Wikipedia ' + (out[x.rg].wp ?? 'n/a') + ' → ' + (out[x.rg].final ?? 'UNDECIDED, check by hand')), ''];
  fs.writeFileSync(path.join(__dirname, 'release-report.md'), lines.join('\n'));
  bad.slice(0, 80).forEach(x => console.log('  ' + x.act + ' — ' + x.t + ': MusicBrainz ' + x.y + ', Wikidata ' + out[x.rg].wd + ', Wikipedia ' + (out[x.rg].wp ?? 'n/a') + ' -> ' + (out[x.rg].final ?? 'UNDECIDED')));
})();
