#!/usr/bin/env node
// Turn the JSON source files in ./data into the bundles the page loads.
//
//   node tools/build-data.js
//
// Reads    data/acts.json genres.json shared.json members.json musicbrainz.json links.json summaries.json
//          [data/popularity.json] [data/releases-manual.json]
// Writes   data/bundle.core.js        always loaded: acts, lineups, shared members and each act's key releases
//          data/bundle.releases.js    lazy: every cleaned studio and live album ("All albums" mode, "On this day")
//          data/bundle.summaries.js   lazy: Wikipedia summaries
//          data/bundle.links.js       lazy: official sites, social profiles, listening pages
//          data/bundle.songs.js       lazy: top songs per act (only when data/popularity.json exists)
//
// KEY RELEASES are chosen by rule, not by hand. Each act keeps its top N studio albums under two criteria:
//   acclaimed  MusicBrainz community rating, Bayesian-weighted so one 5-star vote cannot beat 70 votes averaging 4.6:
//              score = (votes * rating + M * mean) / (votes + M), M = 3, mean = average rating of all rated albums
//   popular    ListenBrainz listen count for the album (data/popularity.json, from tools/fetch-popularity.js)
// An act with fewer than two rated albums also gets its debut album (marked as a fallback: it has no rating).

const fs = require('fs');
const path = require('path');
const { read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const has = f => fs.existsSync(path.join(data, f));
const NOW = new Date().getFullYear();
const TOP_N = 4, PRIOR_VOTES = 3;

const { genres, subOrder } = read(path.join(data, 'genres.json'));
const acts = read(path.join(data, 'acts.json'));
const shared = has('shared.json') ? read(path.join(data, 'shared.json')) : [];
const members = has('members.json') ? read(path.join(data, 'members.json')) : {};
const mb = has('musicbrainz.json') ? read(path.join(data, 'musicbrainz.json')) : {};
const links = has('links.json') ? read(path.join(data, 'links.json')) : {};
const summaries = has('summaries.json') ? read(path.join(data, 'summaries.json')) : {};
const pop = has('popularity.json') ? read(path.join(data, 'popularity.json')) : null;
const sources = has('meta.json') ? read(path.join(data, 'meta.json')) : {};
const checks = has('release-checks.json') ? read(path.join(data, 'release-checks.json')) : {};   // second-source years from tools/verify-releases.js
const manual = has('releases-manual.json') ? read(path.join(data, 'releases-manual.json')) : {};

// ---------- which MusicBrainz "studio albums" are real albums ----------
const norm = t => t.toLowerCase().replace(/\((remaster|deluxe|expanded|anniversary|bonus|mono|stereo|us |uk )[^)]*\)/g, ' ').replace(/[\[\]]/g, ' ')
  .replace(/[‘’'`´]/g, '').replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const JUNK = /\b(remaster(ed)?|deluxe|anniversary|collection|greatest hits|best of|anthology|box set|rarities|b-?sides|bootleg|karaoke|tribute|lost sessions|expanded|reissue|re-?recorded|the very best|essential|demos?|sessions?|rehearsals?|tapes|broadcasts?|outtakes|alternate|tour|mixes|radio|complete|bbc|recordings|archives?)\b/i;
const LIVE = /\(live\b|\blive\b(?!\s*(wire|forever|and let|to tell))|\bin concert\b|\bunplugged\b|\bboth sides of\b/i;
const YEARTAIL = /\s(19|20)\d\d(-(19|20)?\d\d)?$/;
const clean = s => s.replace(/[’‘`´]/g, "'").replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim();

function candidates(a, m) {
  const seen = new Map();
  for (let s of m.studio || []) {
    const c = checks[s.rg];
    if (c && c.final != null && c.final !== s.y) s = { ...s, y: c.final, d: null };       // two sources agree on a different year than MusicBrainz
    const t = clean(s.t);
    if (JUNK.test(t) || LIVE.test(t) || YEARTAIL.test(t)) continue;
    if (s.y < a.formed - 1 || s.y > (a.ended ?? NOW) + 1) continue;
    const k = norm(t), prev = seen.get(k);
    if (!prev || s.y < prev.y) seen.set(k, { ...s, t });          // the earliest of duplicate titles is the original
  }
  return [...seen.values()].sort((x, y) => x.y - y.y || x.t.localeCompare(y.t));
}

// ---------- global mean rating for the Bayesian weighting ----------
let sum = 0, cnt = 0;
for (const a of acts) { const m = mb[a.id]; if (!m) continue; for (const s of candidates(a, m)) if (s.v > 0 && s.r != null) { sum += s.r; cnt++; } }
const MEAN = cnt ? sum / cnt : 3.8;

const core = { rel: {}, all: {}, songs: {} };
const stat = { acclaimed: 0, fallback: 0, popular: 0, none: 0, manual: 0 };
for (const a of acts) {
  const m = mb[a.id];
  if (!m) {
    if (manual[a.id]) { core.rel[a.id] = manual[a.id].map(x => [x.t, x.y, x.d || null, 1, 0, null, 0, 0]); stat.manual++; } else stat.none++;
    continue;
  }
  const cands = candidates(a, m);
  const lst = pop && pop[a.id] ? pop[a.id].albums : {};
  const byKey = new Map(cands.map(c => [c.rg, { t: c.t, y: c.y, d: c.d, ar: 0, pr: 0, r: c.r, v: c.v || 0, l: lst[c.rg] || 0 }]));
  // acclaimed
  const rated = cands.filter(c => c.r != null && c.v > 0)
    .map(c => ({ c, score: (c.v * c.r + PRIOR_VOTES * MEAN) / (c.v + PRIOR_VOTES) }))
    .sort((x, y) => y.score - x.score || y.c.v - x.c.v || x.c.y - y.c.y).slice(0, TOP_N);
  rated.forEach((x, i) => { byKey.get(x.c.rg).ar = i + 1; });
  if (rated.length < 2 && cands.length) {                          // too few ratings: fall back to the debut and keep it visibly unrated
    const debut = byKey.get(cands[0].rg);
    if (!debut.ar) { debut.ar = rated.length + 1; stat.fallback++; }
  }
  if (rated.length) stat.acclaimed++;
  // popular
  const hot = cands.filter(c => (lst[c.rg] || 0) > 0).sort((x, y) => lst[y.rg] - lst[x.rg]).slice(0, TOP_N);
  hot.forEach((c, i) => { byKey.get(c.rg).pr = i + 1; });
  if (hot.length) stat.popular++;
  core.rel[a.id] = [...byKey.values()].filter(x => x.ar || x.pr).sort((x, y) => x.y - y.y).map(x => [x.t, x.y, x.d, x.ar, x.pr, x.r, x.v, x.l]);
  // every cleaned album, for the "All albums" mode and "On this day": [title, year, day (MM-DD), flag]  flag: 0 studio, 1 live
  core.all[a.id] = [
    ...cands.map(c => [c.t, c.y, c.d ? c.d.slice(5) : null, 0]),
    ...(m.live || []).filter(l => !JUNK.test(l.t) && !/\b(19|20)\d\d[-\/.]\d{1,2}[-\/.]\d{1,2}\b/.test(l.t) && l.y >= a.formed - 1).map(l => [clean(l.t), l.y, l.d ? l.d.slice(5) : null, 1]),
  ].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]));
}

// shared members: curated + any musicians MusicBrainz lists in two acts' lineups
const pair = new Map();
const addPair = (x, y, who) => {
  if (x === y) return;
  const k = x < y ? x + '|' + y : y + '|' + x;
  const e = pair.get(k) || { a: x, b: y, who: [] };
  if (!e.who.includes(who) && e.who.length < 3) e.who.push(who);
  pair.set(k, e);
};
shared.forEach(s => addPair(s.a, s.b, s.who));
const byPerson = new Map();
for (const [id, list] of Object.entries(members)) for (const [name] of list) { if (!byPerson.has(name)) byPerson.set(name, []); byPerson.get(name).push(id); }
for (const [name, ids] of byPerson) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) addPair(ids[i], ids[j], name);

// songs (only when popularity data exists)
if (pop) for (const [id, p] of Object.entries(pop)) if (p.songs && p.songs.length) core.songs[id] = p.songs;

// graph view: positions settled at build time so the page opens with the graph already laid out
const { layout } = require('./lib/graph-layout');
const pos = layout(acts, genres.map(g => g.id), acts.flatMap(a => (a.from || []).map(p => [p, a.id])), [...pair.values()].map(e => [e.a, e.b]));

// world map for the scene view: Natural Earth 110m countries (public domain) decoded from TopoJSON into plain rings,
// coordinates in tenths of a degree, Antarctica dropped. { "<country name>": [ [x0,y0,x1,y1,...] (outer rings) ] }
function geo() {
  if (!has('geo/world-110m.json')) return null;
  const t = JSON.parse(fs.readFileSync(path.join(data, 'geo', 'world-110m.json'), 'utf8'));
  const [sx, sy] = t.transform.scale, [tx, ty] = t.transform.translate;
  const arcs = t.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
  const ring = idx => { const pts = []; idx.forEach(i => { const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; pts.push(...(pts.length ? a.slice(1) : a)); }); return pts.flatMap(p => [Math.round(p[0] * 10), Math.round(p[1] * 10)]); };
  const out = {};
  for (const g of t.objects.countries.geometries) {
    const name = g.properties.name;
    if (name === 'Antarctica') continue;
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    out[name] = polys.map(p => { const r = ring(p[0]); let jump = false; for (let i = 2; i < r.length; i += 2) if (Math.abs(r[i] - r[i - 2]) > 1800) jump = true; if (jump) for (let i = 0; i < r.length; i += 2) if (r[i] < 0) r[i] += 3600; return r; });   // rings that cross the 180th meridian continue past it instead of wrapping
  }
  return out;
}
const similar = has('similar.json') ? read(path.join(data, 'similar.json')) : {};

// ---------- write ----------
const stamp = new Date().toISOString().slice(0, 10);
const w = (file, varName, obj) => {
  fs.writeFileSync(path.join(data, file), `// Generated by tools/build-data.js on ${stamp} from the JSON files in this folder. Do not edit.\nwindow.${varName} = ${JSON.stringify(obj)};\n`);
  return fs.statSync(path.join(data, file)).size;
};
const sizes = {};
sizes['bundle.core.js'] = w('bundle.core.js', 'ATLAS', {
  generated: stamp, sources, topN: TOP_N, meanRating: +MEAN.toFixed(2), criteria: { acclaimed: true, popular: !!pop },
  genres, subOrder,
  acts: acts.map(a => { const o = { ...a }; delete o.vsrc; delete o.review; return o; }),
  members, shared: [...pair.values()], rel: core.rel, pos,
});
sizes['bundle.viz.js'] = w('bundle.viz.js', 'ATLAS_VIZ', { geo: geo(), similar });
sizes['bundle.releases.js'] = w('bundle.releases.js', 'ATLAS_RELEASES', core.all);
sizes['bundle.summaries.js'] = w('bundle.summaries.js', 'ATLAS_SUMMARIES', summaries);
sizes['bundle.links.js'] = w('bundle.links.js', 'ATLAS_LINKS', links);
if (pop) sizes['bundle.songs.js'] = w('bundle.songs.js', 'ATLAS_SONGS', core.songs);
else if (fs.existsSync(path.join(data, 'bundle.songs.js'))) fs.rmSync(path.join(data, 'bundle.songs.js'));

console.log(`acts ${acts.length} | acclaimed picks for ${stat.acclaimed} acts (+${stat.fallback} debut fallbacks) | popular picks for ${stat.popular} acts | manual ${stat.manual} | no release data ${stat.none}`);
console.log(`mean community rating ${MEAN.toFixed(2)} | shared-member pairs ${pair.size}`);
for (const [f, s] of Object.entries(sizes)) console.log('  ' + f.padEnd(22) + (s / 1024).toFixed(0).padStart(5) + ' KB');
