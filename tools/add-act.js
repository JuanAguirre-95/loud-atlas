#!/usr/bin/env node
// Add acts to data/acts.json from MusicBrainz.
//
//   node tools/add-act.js "Band Name" "Another Band" ...
//
// Looks each name up (exact-name hits only), guesses a genre from MusicBrainz tags, and appends a record. Then edit
// data/acts.json to fix the genre, subgenre and "from" (the ids of the acts that influenced it), and run, in this order:
//   node tools/fetch-musicbrainz.js   albums, ratings, lineup
//   node tools/fetch-links.js         official site, social, listening pages
//   node tools/fetch-summaries.js     Wikipedia summary
//   node tools/verify.js --write      check the dates against Wikipedia, Wikidata and MusicBrainz
//   node tools/build-data.js          regenerate the bundles

const path = require('path');
const { cachedGet } = require('./lib/http');
const { writeRecords, read } = require('./lib/json');

const file = path.join(__dirname, '..', 'data', 'acts.json');
const acts = read(file);
const TAGS = [
  [/post-punk|new wave|gothic rock|darkwave|synth-pop|synthpop/, 'postpunk'], [/delta blues|chicago blues|electric blues|rock and roll|rock & roll|rockabilly|rhythm and blues/, 'roots'],
  [/thrash/, 'thrash'], [/grindcore|death metal/, 'death'], [/black metal/, 'black'],
  [/doom|stoner|sludge/, 'doom'], [/power metal|speed metal/, 'power'], [/progressive metal|progressive rock|djent/, 'prog'],
  [/gothic|symphonic/, 'gothic'], [/grunge|alternative rock/, 'grunge'],
  [/industrial|nu metal|nu-metal/, 'industrial'], [/metalcore|deathcore|post-hardcore/, 'modern'],
  [/hardcore|punk/, 'punk'], [/glam|hair metal/, 'glam'], [/heavy metal|nwobhm/, 'heavy'],
  [/hard rock/, 'hard'], [/rock|psychedelic|blues/, 'classic'],
];
const guessGenre = tags => {
  for (const n of (tags || []).sort((a, b) => b.count - a.count).map(t => t.name.toLowerCase())) for (const [re, g] of TAGS) if (re.test(n)) return g;
  return 'classic';
};
const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const year = d => (d ? +d.slice(0, 4) : null);

(async () => {
  const names = process.argv.slice(2);
  if (!names.length) { console.log('usage: node tools/add-act.js "Band Name" ...'); return; }
  for (const name of names) {
    const s = await cachedGet(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent('artist:"' + name.replace(/"/g, '') + '"')}&limit=6&fmt=json`, { gap: 1300 });
    const hits = (s.artists || []).filter(x => norm(x.name) === norm(name));
    if (!hits.length) { console.log(`x ${name}: no artist with exactly that name (check the spelling at musicbrainz.org)`); continue; }
    if (hits.length > 1 && hits[0].score - hits[1].score < 15) console.log(`! ${name}: ${hits.length} artists share this name; taking the highest-scoring one (${hits[0].id}). Check it.`);
    const a = hits[0];
    const id = norm(a.name);
    if (acts.some(x => x.id === id || x.mbid === a.id)) { console.log(`- ${name}: already present`); continue; }
    const t = await cachedGet(`https://musicbrainz.org/ws/2/artist/${a.id}?inc=tags&fmt=json`, { gap: 1300 });
    const genre = guessGenre(t && t.tags);
    acts.push({ id, name: a.name, kind: a.type === 'Person' ? 'artist' : 'band', genre, sub: 'Other', country: (a.area && a.area.name) || a.country || '', formed: year(a['life-span'] && a['life-span'].begin) || 0,
      ended: a['life-span'] && a['life-span'].ended ? year(a['life-span'].end) : null, from: [], mbid: a.id, mbMatch: 'auto', verified: null });
    console.log(`+ ${a.name} -> genre "${genre}" (a guess). Fix genre, sub, country and "from" in data/acts.json.`);
  }
  writeRecords(file, acts);
})();
