#!/usr/bin/env node
// Propose MusicBrainz ids for acts that have none or only a weak match, so a person can confirm them.
//
//   node tools/match-mbids.js                 acts without an id, or with "mbMatch": "low"
//   node tools/match-mbids.js name1 name2     (act ids) only those
//   node tools/match-mbids.js --apply         also write the best candidate for the unmatched ones when it is unambiguous
//
// For each act it searches MusicBrainz and prints the top candidates with country, start year and the text MusicBrainz uses to
// tell namesakes apart ("US thrash metal band"). The score combines the search score, the start year being close to the one
// in data/acts.json, the country matching and the type (group / person) matching. A proposal is "clear" when the best candidate
// has an exact name, a matching start year (within 2) and beats the runner-up by 15 points.
// Confirmed ids go in data/mbid-overrides.json ({ "<act id>": "<mbid>" }) which this tool reads, so decisions survive reruns.

const fs = require('fs');
const path = require('path');
const { cachedGet } = require('./lib/http');
const { writeRecords, read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const acts = read(path.join(data, 'acts.json'));
const APPLY = process.argv.includes('--apply');
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const overrides = fs.existsSync(path.join(data, 'mbid-overrides.json')) ? JSON.parse(fs.readFileSync(path.join(data, 'mbid-overrides.json'), 'utf8')) : {};

const ISO = { US: 'United States', UK: 'United Kingdom', GB: 'United Kingdom', DE: 'Germany', SE: 'Sweden', NO: 'Norway', FI: 'Finland', JP: 'Japan', CA: 'Canada', AU: 'Australia', BR: 'Brazil', FR: 'France', IT: 'Italy', NL: 'Netherlands', DK: 'Denmark', RU: 'Russia' };
const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const countryOf = c => (c || '').split('/').map(x => x.trim());

(async () => {
  const todo = acts.filter(a => (only.length ? only.includes(a.id) : (!a.mbid || a.mbMatch === 'low')) && !overrides[a.id]);
  console.log(`${todo.length} acts to look at\n`);
  const applied = [];
  for (const a of todo) {
    const r = await cachedGet(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent('artist:"' + a.name.replace(/"/g, '') + '"')}&limit=6&fmt=json`, { gap: 1300 });
    const list = ((r && r.artists) || []).map(c => {
      const by = c['life-span'] && c['life-span'].begin ? +c['life-span'].begin.slice(0, 4) : null;
      const sameName = norm(c.name) === norm(a.name);
      const closeYear = by != null && Math.abs(by - a.formed) <= (a.kind === 'artist' ? 12 : 2);
      const country = countryOf(a.country).some(x => (c.area && c.area.name || '').includes(ISO[x] || x) || c.country === x);
      const typeOk = a.kind === 'band' ? c.type === 'Group' : c.type === 'Person';
      const score = (c.score || 0) * .5 + (sameName ? 25 : 0) + (closeYear ? 20 : 0) + (country ? 10 : 0) + (typeOk ? 5 : 0);
      return { c, by, sameName, closeYear, score };
    }).sort((x, y) => y.score - x.score);
    console.log(`${a.name} (${a.id}, ${a.kind}, ${a.formed}, ${a.country})  current: ${a.mbid || 'none'}${a.mbMatch ? ' [' + a.mbMatch + ']' : ''}`);
    list.slice(0, 3).forEach(x => console.log(`   ${x.score.toFixed(0).padStart(3)}  ${x.c.id}  ${x.c.name} | ${x.c.type || '?'} | ${(x.c.area && x.c.area.name) || '-'} | ${x.by ?? '-'} | ${x.c.disambiguation || ''}${x.c.id === a.mbid ? '   <= current' : ''}`));
    const best = list[0], next = list[1];
    const clear = best && best.sameName && best.closeYear && (!next || best.score - next.score >= 15);
    console.log(`   -> ${clear ? 'clear: ' + (best.c.id === a.mbid ? 'keeps current' : best.c.id) : 'needs a person'}\n`);
    if (APPLY && clear && !a.mbid) { a.mbid = best.c.id; a.mbMatch = 'auto'; applied.push(a.name); }
  }
  if (APPLY && applied.length) { writeRecords(path.join(data, 'acts.json'), acts); console.log('Applied: ' + applied.join(', ')); }
})();
