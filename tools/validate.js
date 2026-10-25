#!/usr/bin/env node
// Check the JSON files in ./data for mistakes before they reach the site.
//
//   node tools/validate.js        prints every problem; exit code 1 if there is any error
//
// Errors break the site or lie about the data (unknown ids, impossible years). Warnings are worth a look but allowed.

const fs = require('fs');
const path = require('path');
const { read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const has = f => fs.existsSync(path.join(data, f));
const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);
const NOW = new Date().getFullYear();

const { genres, subOrder } = read(path.join(data, 'genres.json'));
const acts = read(path.join(data, 'acts.json'));
const genreIds = new Set(genres.map(g => g.id));
const ids = new Set();

for (const a of acts) {
  const w = `${a.id || '(no id)'}`;
  if (!a.id || !/^[a-z0-9_-]+$/.test(a.id)) err(`${w}: id must be lowercase letters, digits, - or _`);
  if (ids.has(a.id)) err(`${w}: duplicate id`);
  ids.add(a.id);
  if (!a.name) err(`${w}: missing name`);
  if (!['band', 'artist'].includes(a.kind)) err(`${w}: kind must be band or artist`);
  if (!genreIds.has(a.genre)) err(`${w}: unknown genre "${a.genre}"`);
  else if (a.sub && a.sub !== 'Other' && !(subOrder[a.genre] || []).includes(a.sub)) warn(`${w}: subgenre "${a.sub}" is not in the ordered list for ${a.genre}`);
  if (!Number.isInteger(a.formed) || a.formed < 1900 || a.formed > NOW) err(`${w}: formed ${a.formed} is not a plausible year`);
  if (a.ended != null && (!Number.isInteger(a.ended) || a.ended < a.formed || a.ended > NOW + 1)) err(`${w}: ended ${a.ended} is before it formed (${a.formed}) or in the future`);
  if (a.mbid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a.mbid)) err(`${w}: malformed mbid`);
  if (!a.country) warn(`${w}: no country`);
  if (!a.verified) warn(`${w}: dates never verified against sources`);
  if (a.review && a.review.length) warn(`${w}: dates flagged for review (${a.review.join(', ')})`);
}
for (const a of acts) for (const p of a.from || []) if (!ids.has(p)) err(`${a.id}: influenced by unknown id "${p}"`);
for (const g of genres) if (!acts.some(a => a.genre === g.id)) warn(`genre ${g.id} has no acts`);

if (has('shared.json')) for (const s of read(path.join(data, 'shared.json'))) {
  if (!ids.has(s.a) || !ids.has(s.b)) err(`shared.json: unknown id in pair ${s.a} / ${s.b}`);
  if (!s.who) err(`shared.json: pair ${s.a} / ${s.b} has no member name`);
}
if (has('members.json')) for (const id of Object.keys(read(path.join(data, 'members.json')))) if (!ids.has(id)) err(`members.json: unknown id "${id}"`);
if (has('summaries.json')) for (const [id, s] of Object.entries(read(path.join(data, 'summaries.json')))) {
  if (!ids.has(id)) err(`summaries.json: unknown id "${id}"`);
  else if (!s.text || !/^https:\/\/en\.wikipedia\.org\//.test(s.url || '')) warn(`summaries.json: ${id} has no text or a non-Wikipedia url`);
}
if (has('links.json')) for (const [id, l] of Object.entries(read(path.join(data, 'links.json')))) {
  if (!ids.has(id)) { err(`links.json: unknown id "${id}"`); continue; }
  for (const k of ['official', 'social', 'listen', 'info']) for (const x of l[k] || []) if (!/^https?:\/\//.test(x.url)) err(`links.json: ${id} has a non-http url: ${x.url}`);
}
if (has('musicbrainz.json')) for (const [id, m] of Object.entries(read(path.join(data, 'musicbrainz.json')))) {
  if (!ids.has(id)) { err(`musicbrainz.json: unknown id "${id}"`); continue; }
  for (const s of m.studio || []) if (!s.rg || !s.t || !Number.isInteger(s.y)) err(`musicbrainz.json: ${id} has a malformed album ${JSON.stringify(s)}`);
}
if (has('popularity.json')) for (const [id, p] of Object.entries(read(path.join(data, 'popularity.json')))) {
  if (!ids.has(id)) { err(`popularity.json: unknown id "${id}"`); continue; }
  if (!Array.isArray(p.songs) || p.songs.length > 10) err(`popularity.json: ${id} songs must be a list of at most 10`);
}

const missing = acts.filter(a => !a.mbid).length;
if (missing) warn(`${missing} acts have no MusicBrainz id (no ratings, lineup, links or release dates for them)`);
console.log(`${acts.length} acts, ${genres.length} genres checked.`);
warnings.slice(0, 25).forEach(w => console.log('warning:', w));
if (warnings.length > 25) console.log(`... and ${warnings.length - 25} more warnings`);
errors.forEach(e => console.log('ERROR:', e));
console.log(errors.length ? `${errors.length} error(s)` : 'No errors.');
process.exit(errors.length ? 1 : 0);
