#!/usr/bin/env node
// Download listening counts from ListenBrainz: how often each album and song has been listened to.
//
//   PowerShell:   $env:LISTENBRAINZ_TOKEN = "your-token"; node tools/fetch-popularity.js
//   bash:         LISTENBRAINZ_TOKEN=your-token node tools/fetch-popularity.js
//
// Get a free token at https://listenbrainz.org/settings/ (sign in with a MusicBrainz account, then "User token").
// The token is only read from the environment and sent to api.listenbrainz.org. It is never printed, cached or saved.
//
// Writes data/popularity.json:  { "<act id>": { "songs": [[title, listens, album], ... top 10], "albums": { "<release-group id>": listens } } }
// Responses are cached in tools/.cache, so a rerun (or an interrupted run) only fetches what is missing.

const fs = require('fs');
const path = require('path');
const { cachedGet } = require('./lib/http');
const { writeKeyed, read } = require('./lib/json');

const token = process.env.LISTENBRAINZ_TOKEN;
if (!token) {
  console.error('Set LISTENBRAINZ_TOKEN first (free token from https://listenbrainz.org/settings/). See the header of this file.');
  process.exit(1);
}
const data = path.join(__dirname, '..', 'data');
const acts = read(path.join(data, 'acts.json')).filter(a => a.mbid);
const mb = fs.existsSync(path.join(data, 'musicbrainz.json')) ? read(path.join(data, 'musicbrainz.json')) : {};
const out = fs.existsSync(path.join(data, 'popularity.json')) ? read(path.join(data, 'popularity.json')) : {};

const API = 'https://api.listenbrainz.org/1/popularity/';
const get = url => cachedGet(url, { gap: 450, headers: { Authorization: 'Token ' + token }, prefix: 'lb', cacheNull: true });

// "Song (Remastered 2009)", "Song - Live at ...", "Song (Demo)" are versions, not different songs.
const norm = t => t.toLowerCase().replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').replace(/\s+-\s+(live|remaster|remastered|demo|mono|stereo|single|edit|version|\d{4}).*$/i, '')
  .replace(/[’'`]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const VERSION = /\b(live|demo|remix|karaoke|instrumental|acoustic version|session|rehearsal|skit|interview|intro|outro)\b/i;

function topSongs(rows) {
  const by = new Map();
  for (const r of rows) {
    const name = r.recording_name;
    if (!name) continue;
    if (VERSION.test(name) && !/^(intro|outro)$/i.test(name)) continue;
    const key = norm(name);
    if (!key) continue;
    const cur = by.get(key) || { title: name.replace(/\s*[\(\[][^)\]]*(remaster|version|mono|stereo)[^)\]]*[\)\]]/i, '').trim(), listens: 0, album: r.release_name };
    cur.listens += r.total_listen_count || 0;
    if ((r.total_listen_count || 0) > (cur._best || 0)) { cur._best = r.total_listen_count; cur.album = r.release_name; cur.title = cur.title.length <= name.length ? cur.title : name; }
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => b.listens - a.listens).slice(0, 10).map(s => [s.title, s.listens, s.album]);
}

(async () => {
  let n = 0, failed = 0;
  for (const a of acts) {
    n++;
    if (out[a.id]) continue;                                           // keep what an earlier run already collected
    process.stdout.write(`[${n}/${acts.length}] ${a.name} `);
    try {
      const recs = await get(`${API}top-recordings-for-artist/${a.mbid}`);
      const grps = await get(`${API}top-release-groups-for-artist/${a.mbid}`);
      const known = new Set(((mb[a.id] && mb[a.id].studio) || []).map(x => x.rg));
      const albums = {};
      (Array.isArray(grps) ? grps : []).forEach(g => { if (known.has(g.release_group_mbid)) albums[g.release_group_mbid] = g.total_listen_count; });
      const songs = topSongs(Array.isArray(recs) ? recs : []);
      out[a.id] = { songs, albums };
      console.log(`- ${songs.length} songs, ${Object.keys(albums).length} albums${songs[0] ? ', top: ' + songs[0][0] + ' (' + songs[0][1] + ')' : ''}`);
    } catch (e) {
      failed++; console.log('- error', e.message);
      if (/401/.test(e.message)) { console.error('\nThe token was rejected. Check LISTENBRAINZ_TOKEN.'); break; }
    }
    if (n % 40 === 0) writeKeyed(path.join(data, 'popularity.json'), out);
  }
  writeKeyed(path.join(data, 'popularity.json'), out);
  console.log(`\nWrote data/popularity.json (${Object.keys(out).length} acts, ${failed} errors).`);
})();
