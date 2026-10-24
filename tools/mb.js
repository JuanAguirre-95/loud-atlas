#!/usr/bin/env node
// MusicBrainz sync for Loud Atlas.
//
//   node tools/mb.js enrich            match every band in data.js, pull studio albums + members,
//                                      write data.mb.js (albums, lineups, shared-member links)
//   node tools/mb.js add "Band" ...    look up new bands and append them to data.extra.js
//
// Requests are throttled to ~1/s (MusicBrainz limit) and cached in tools/.cache, so reruns are cheap
// and an interrupted run resumes where it stopped.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const cacheDir = path.join(__dirname, '.cache');
fs.mkdirSync(cacheDir, { recursive: true });

const UA = 'LoudAtlas/0.1 (hobby timeline project)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;

async function mb(endpoint, params) {
  const qs = new URLSearchParams({ ...params, fmt: 'json' }).toString();
  const url = `https://musicbrainz.org/ws/2/${endpoint}?${qs}`;
  const file = path.join(cacheDir, Buffer.from(url).toString('base64url').slice(-120) + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 503 || res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const json = await res.json();
    fs.writeFileSync(file, JSON.stringify(json));
    return json;
  }
  throw new Error('gave up: ' + url);
}

function loadData() {
  const sandbox = { window: {} };
  new Function('window', fs.readFileSync(path.join(root, 'data.js'), 'utf8'))(sandbox.window);
  return sandbox.window;
}

// ids whose best MusicBrainz match is a different act with the same name
const BAD_MATCH = new Set(['kino']);

const year = d => (d ? +d.slice(0, 4) : null);

// Pick the search hit that really is our band: right year (+/-2) and a group, else best score.
function pickArtist(results, band) {
  const groups = results.filter(a => a.score >= 85);
  const good = groups.filter(a => {
    const y = year(a['life-span']?.begin);
    return a.name.toLowerCase() === band.name.toLowerCase() && y && Math.abs(y - band.formed) <= 3;
  });
  if (good.length) return { artist: good[0], confidence: 'high' };
  const loose = groups.find(a => a.name.toLowerCase() === band.name.toLowerCase());
  return loose ? { artist: loose, confidence: 'low' } : null;
}

async function albumsOf(mbid) {
  const out = []; let offset = 0;
  for (;;) {
    const r = await mb('release-group', { artist: mbid, type: 'album', limit: 100, offset });
    out.push(...r['release-groups']);
    offset += 100;
    if (offset >= r['release-group-count']) break;
  }
  const seen = new Set();
  return out
    .filter(g => !(g['secondary-types'] || []).length && year(g['first-release-date']))
    .map(g => ({ year: year(g['first-release-date']), title: g.title }))
    .sort((a, b) => a.year - b.year)
    .filter(a => { const k = a.title.toLowerCase(); return seen.has(k) ? false : seen.add(k); });
}

async function membersOf(mbid) {
  const r = await mb(`artist/${mbid}`, { inc: 'artist-rels' });
  const members = {};
  for (const rel of r.relations || []) {
    if (rel.type !== 'member of band' || rel.direction !== 'backward' || !rel.artist) continue;
    const m = members[rel.artist.id] ||= { mbid: rel.artist.id, name: rel.artist.name, spans: [] };
    m.spans.push([year(rel.begin), year(rel.end)]);
  }
  return Object.values(members).map(m => ({
    name: m.name, mbid: m.mbid,
    from: Math.min(...m.spans.map(s => s[0] ?? 9999)) === 9999 ? null : Math.min(...m.spans.map(s => s[0] ?? 9999)),
    to: m.spans.some(s => s[1] == null) ? null : Math.max(...m.spans.map(s => s[1])),
  })).sort((a, b) => (a.from ?? 9999) - (b.from ?? 9999));
}

async function enrich() {
  const { BANDS } = loadData();
  const out = {}, report = [];
  for (const [i, band] of BANDS.entries()) {
    process.stdout.write(`[${i + 1}/${BANDS.length}] ${band.name} `);
    if (BAD_MATCH.has(band.id)) { console.log('— skipped (known wrong match)'); continue; }
    try {
      const s = await mb('artist', { query: `artist:"${band.name.replace(/"/g, '')}"`, limit: 10 });
      const pick = pickArtist(s.artists || [], band);
      if (!pick) { console.log('— no match'); report.push(`NO MATCH   ${band.name}`); continue; }
      const { artist, confidence } = pick;
      const albums = await albumsOf(artist.id);
      const members = await membersOf(artist.id);
      const f = year(artist['life-span']?.begin), e = year(artist['life-span']?.end);
      out[band.id] = { mbid: artist.id, confidence, formed: f, ended: e, albums, members };
      if (f && Math.abs(f - band.formed) > 1) report.push(`FORMED     ${band.name}: ours ${band.formed}, MB ${f}`);
      if ((e ?? null) !== (band.ended ?? null) && Math.abs((e ?? 0) - (band.ended ?? 0)) > 1)
        report.push(`ENDED      ${band.name}: ours ${band.ended ?? 'active'}, MB ${e ?? 'active'}`);
      if (confidence === 'low') report.push(`LOW MATCH  ${band.name} -> https://musicbrainz.org/artist/${artist.id}`);
      console.log(`— ${albums.length} albums, ${members.length} members (${confidence})`);
    } catch (err) { console.log('— error', err.message); report.push(`ERROR      ${band.name}: ${err.message}`); }
  }

  // shared members across our bands, ignoring only-ever-overlapping noise by requiring the same MB person id
  const byPerson = {};
  for (const [id, d] of Object.entries(out))
    for (const m of d.members) (byPerson[m.mbid] ||= { name: m.name, bands: [] }).bands.push(id);
  const links = [];
  for (const p of Object.values(byPerson))
    for (let i = 0; i < p.bands.length; i++)
      for (let j = i + 1; j < p.bands.length; j++) links.push([p.bands[i], p.bands[j], p.name]);

  const stamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(root, 'data.mb.js'),
    `// Generated by tools/mb.js on ${stamp} from MusicBrainz (CC0 core data). Do not edit by hand.\n` +
    `window.MB = ${JSON.stringify(out)};\nwindow.MB_LINKS = ${JSON.stringify(links)};\n`);
  fs.writeFileSync(path.join(__dirname, 'report.txt'), report.join('\n') + '\n');
  console.log(`\nWrote data.mb.js (${Object.keys(out).length} bands, ${links.length} shared-member links). ${report.length} notes in tools/report.txt`);
}

const TAGS = [
  [/post-punk|new wave|gothic rock|darkwave|synth-pop|synthpop/, 'postpunk'], [/delta blues|chicago blues|electric blues|rock and roll|rock & roll|rockabilly|rhythm and blues/, 'roots'],
  [/thrash/, 'thrash'], [/grindcore|death metal/, 'death'], [/black metal/, 'black'],
  [/doom|stoner|sludge/, 'doom'], [/power metal|speed metal/, 'power'], [/progressive metal|progressive rock|djent/, 'prog'],
  [/gothic|symphonic/, 'gothic'], [/grunge|alternative rock/, 'grunge'],
  [/industrial|nu metal|nu-metal/, 'industrial'], [/metalcore|deathcore|post-hardcore/, 'modern'],
  [/hardcore|punk/, 'punk'], [/glam|hair metal/, 'glam'], [/heavy metal|nwobhm/, 'heavy'],
  [/hard rock/, 'hard'], [/rock|psychedelic|blues/, 'classic'],
];
function guessGenre(tags) {
  const names = (tags || []).sort((a, b) => b.count - a.count).map(t => t.name.toLowerCase());
  for (const n of names) for (const [re, g] of TAGS) if (re.test(n)) return g;
  return 'classic';
}

async function add(names) {
  const file = path.join(root, 'data.extra.js');
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^[^[]*/, '').replace(/;\s*$/, '')) : [];
  const { BANDS } = loadData();
  const taken = new Set([...BANDS, ...existing].map(b => b.id));
  for (const name of names) {
    const s = await mb('artist', { query: `artist:"${name}"`, limit: 5 });
    const a = (s.artists || []).find(x => x.score >= 90);
    if (!a) { console.log(`✗ ${name}: no match`); continue; }
    const id = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (taken.has(id)) { console.log(`• ${name}: already present`); continue; }
    const tag = await mb(`artist/${a.id}`, { inc: 'tags' });
    const genre = guessGenre(tag.tags);
    const albums = await albumsOf(a.id);
    existing.push({
      id, name: a.name, kind: a.type === 'Person' ? 'artist' : 'band', genre, sub: null, country: a.area?.name || a.country || '?',
      formed: year(a['life-span']?.begin) || 0, ended: a['life-span']?.ended ? year(a['life-span']?.end) : null,
      albums, from: [],
    });
    taken.add(id);
    console.log(`✓ ${a.name} → ${genre}, ${albums.length} albums (set "from"/"genre" in data.extra.js if needed)`);
  }
  fs.writeFileSync(file, `// Bands added with tools/mb.js. Edit freely: fix genre, add "from" ids.\nwindow.EXTRA = ${JSON.stringify(existing, null, 1)};\n`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'enrich') enrich();
else if (cmd === 'add' && rest.length) add(rest);
else console.log('usage: node tools/mb.js enrich | add "Band Name" ...');
