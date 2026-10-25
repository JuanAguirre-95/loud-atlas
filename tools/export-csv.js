#!/usr/bin/env node
// Export the dataset as spreadsheet-friendly CSV files into data/export/.
//
//   node tools/export-csv.js
//
// acts.csv      one row per act (dates, sources, links)
// releases.csv  one row per album the site knows about, with its rank under each criterion and its rating / listens
// songs.csv     top songs per act (only when data/popularity.json exists)

const fs = require('fs');
const path = require('path');
const { read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const out = path.join(data, 'export');
fs.mkdirSync(out, { recursive: true });
const has = f => fs.existsSync(path.join(data, f));
const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';   // BOM so Excel reads UTF-8

const { genres } = read(path.join(data, 'genres.json'));
const gname = Object.fromEntries(genres.map(g => [g.id, g.name]));
const acts = read(path.join(data, 'acts.json'));
const links = has('links.json') ? read(path.join(data, 'links.json')) : {};
const mb = has('musicbrainz.json') ? read(path.join(data, 'musicbrainz.json')) : {};
const pop = has('popularity.json') ? read(path.join(data, 'popularity.json')) : {};
const first = (id, k, site) => ((links[id] || {})[k] || []).find(x => !site || x.site === site);

fs.writeFileSync(path.join(out, 'acts.csv'), csv(
  ['id', 'name', 'type', 'genre', 'subgenre', 'country', 'formed', 'ended', 'dates_verified', 'formed_source', 'ended_source', 'musicbrainz_id', 'website', 'wikipedia_or_wikidata'],
  acts.map(a => [a.id, a.name, a.kind, gname[a.genre], a.sub, a.country, a.formed, a.ended ?? 'present', a.verified, a.vsrc && a.vsrc.formed, a.vsrc && a.vsrc.ended, a.mbid,
    (first(a.id, 'official', 'website') || {}).url, ((first(a.id, 'info', 'wikidata')) || {}).url])));

const rel = [];
for (const a of acts) {
  const m = mb[a.id];
  if (!m) continue;
  const rg = new Map(((pop[a.id] || {}).albums) ? Object.entries(pop[a.id].albums) : []);
  for (const s of m.studio) rel.push([a.id, a.name, 'studio', s.t, s.y, s.d, s.r, s.v, rg.get(s.rg) ?? '', s.rg]);
  for (const l of m.live) rel.push([a.id, a.name, 'live', l.t, l.y, l.d, '', '', '', l.rg]);
}
fs.writeFileSync(path.join(out, 'releases.csv'), csv(['act_id', 'act', 'kind', 'title', 'year', 'first_release_date', 'community_rating', 'rating_votes', 'listens', 'musicbrainz_release_group'], rel));

let n = 0;
if (has('popularity.json')) {
  const rows = [];
  for (const a of acts) ((pop[a.id] || {}).songs || []).forEach(([t, l, alb], i) => rows.push([a.id, a.name, i + 1, t, alb, l]));
  fs.writeFileSync(path.join(out, 'songs.csv'), csv(['act_id', 'act', 'rank', 'song', 'album', 'listens'], rows));
  n = rows.length;
}
console.log(`data/export: ${acts.length} acts, ${rel.length} releases${n ? ', ' + n + ' songs' : ''}`);
