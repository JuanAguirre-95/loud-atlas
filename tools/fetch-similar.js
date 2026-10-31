#!/usr/bin/env node
// Download "listeners also like" similarity from ListenBrainz Labs for every act, and keep the neighbours that are also on the map.
//
//   node tools/fetch-similar.js
//
// No token is needed. Writes data/similar.json: { "<act id>": [["<other act id>", score], ...] } (best first, at most 15).
// The score comes from how often the two artists are played in the same listening sessions, so it reflects what people
// listen to together, not how the music sounds. Responses are cached in tools/.cache.

const path = require('path');
const { cachedGet } = require('./lib/http');
const { stamp } = require('./lib/meta');
const { writeKeyed, read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const acts = read(path.join(data, 'acts.json')).filter(a => a.mbid);
const byMbid = new Map(acts.map(a => [a.mbid, a.id]));
const ALGO = 'session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30';

(async () => {
  const out = {};
  let n = 0, empty = 0;
  for (const a of acts) {
    n++;
    process.stdout.write(`[${n}/${acts.length}] ${a.name} `);
    try {
      const r = await cachedGet(`https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${a.mbid}&algorithm=${ALGO}`, { gap: 400, prefix: 'sim' });
      const list = (Array.isArray(r) ? r : []).filter(x => byMbid.has(x.artist_mbid) && byMbid.get(x.artist_mbid) !== a.id)
        .map(x => [byMbid.get(x.artist_mbid), x.score]).slice(0, 15);
      if (list.length) out[a.id] = list; else empty++;
      console.log('- ' + list.length + ' on the map');
    } catch (e) { console.log('- error', e.message); }
    if (n % 100 === 0) writeKeyed(path.join(data, 'similar.json'), out);
  }
  writeKeyed(path.join(data, 'similar.json'), out);
  stamp('similar');
  console.log(`\nWrote data/similar.json (${Object.keys(out).length} acts, ${empty} without neighbours on the map)`);
})();
