#!/usr/bin/env node
// Download release data from MusicBrainz for every act in data/acts.json that has an `mbid`.
//
//   node tools/fetch-musicbrainz.js
//
// Writes data/musicbrainz.json: for each act its MusicBrainz type and life span, its studio albums (release-group id, title,
// first release date, community rating and vote count) and its official live albums. Also refreshes data/members.json.
// Throttled to 1 request/second and cached in tools/.cache, so a rerun (or an interrupted run) is cheap.

const path = require('path');
const { cachedGet } = require('./lib/http');
const { writeKeyed, read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const acts = read(path.join(data, 'acts.json'));
const MB = 'https://musicbrainz.org/ws/2/';

const get = url => cachedGet(url, { gap: 1100 });
const year = d => (d ? +d.slice(0, 4) : null);
const day = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);          // a bare year or month means the day is unknown

async function studio(mbid) {
  const groups = [];
  for (let offset = 0; ; offset += 100) {
    const r = await get(`${MB}release-group?artist=${mbid}&type=album&inc=ratings&limit=100&offset=${offset}&fmt=json`);
    if (!r) break;
    groups.push(...r['release-groups']);
    if (offset + 100 >= r['release-group-count']) break;
  }
  return groups
    .filter(g => !(g['secondary-types'] || []).length && year(g['first-release-date']))
    .map(g => ({ rg: g.id, t: g.title, y: year(g['first-release-date']), d: day(g['first-release-date']), r: g.rating && g.rating.value != null ? g.rating.value : null, v: g.rating ? g.rating['votes-count'] : 0 }))
    .sort((a, b) => a.y - b.y || a.t.localeCompare(b.t));
}

// Live albums: only release groups with an OFFICIAL release (MusicBrainz tags bootleg recordings as "live" too).
async function live(mbid) {
  const found = new Map();
  for (let offset = 0, pages = 0, total = Infinity; offset < total && pages < 3; offset += 100, pages++) {
    const r = await get(`${MB}release?artist=${mbid}&status=official&type=live&inc=release-groups&limit=100&offset=${offset}&fmt=json`);
    if (!r) break;
    total = r['release-count'] || 0;
    for (const rel of r.releases || []) {
      const g = rel['release-group'], t = (g && g['secondary-types']) || [];
      if (g && g['primary-type'] === 'Album' && t.length === 1 && t[0] === 'Live' && year(g['first-release-date']) && !found.has(g.id))
        found.set(g.id, { rg: g.id, t: g.title, y: year(g['first-release-date']), d: day(g['first-release-date']) });
    }
  }
  return [...found.values()].sort((a, b) => a.y - b.y || a.t.localeCompare(b.t));
}

async function artist(mbid) {
  const r = await get(`${MB}artist/${mbid}?inc=artist-rels&fmt=json`);
  if (!r) return null;
  const people = {};
  for (const rel of r.relations || []) {
    if (rel.type !== 'member of band' || rel.direction !== 'backward' || !rel.artist) continue;
    const p = people[rel.artist.id] ||= { name: rel.artist.name, spans: [] };
    p.spans.push([year(rel.begin), year(rel.end)]);
  }
  const members = Object.values(people).map(p => {
    const starts = p.spans.map(s => s[0]).filter(x => x != null);
    return [p.name, starts.length ? Math.min(...starts) : null, p.spans.some(s => s[1] == null) ? null : Math.max(...p.spans.map(s => s[1]))];
  }).sort((a, b) => (a[1] ?? 9999) - (b[1] ?? 9999));
  const ls = r['life-span'] || {};
  return { info: { mbid, name: r.name, type: r.type || null, begin: ls.begin || null, end: ls.end || null, ended: !!ls.ended, area: (r.area && r.area.name) || null }, members };
}

(async () => {
  const out = {}, members = {};
  const todo = acts.filter(a => a.mbid);
  console.log(`${todo.length} acts with a MusicBrainz id, ${acts.length - todo.length} without`);
  let i = 0;
  for (const a of todo) {
    process.stdout.write(`[${++i}/${todo.length}] ${a.name} `);
    try {
      const meta = await artist(a.mbid);
      if (!meta) { console.log('- not found'); continue; }
      const s = await studio(a.mbid), l = await live(a.mbid);
      out[a.id] = { ...meta.info, studio: s, live: l };
      if (meta.members.length) members[a.id] = meta.members;
      console.log(`- ${s.length} studio (${s.filter(x => x.r != null).length} rated), ${l.length} live`);
    } catch (e) { console.log('- error', e.message); }
    if (i % 50 === 0) { writeKeyed(path.join(data, 'musicbrainz.json'), out); }
  }
  writeKeyed(path.join(data, 'musicbrainz.json'), out);
  writeKeyed(path.join(data, 'members.json'), members);
  console.log(`\nWrote data/musicbrainz.json (${Object.keys(out).length} acts) and data/members.json (${Object.keys(members).length}).`);
})();
