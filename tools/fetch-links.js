#!/usr/bin/env node
// Collect each act's official website, social profiles, listening pages and reference pages from MusicBrainz.
//
//   node tools/fetch-links.js                only acts that have no links yet
//   node tools/fetch-links.js --all          redo everything
//
// Writes data/links.json: { "<act id>": { official: [{site,url}], social: [...], listen: [...], info: [...] } }
// Only services the site knows how to label are kept, dead hosts are dropped, and each service keeps one URL
// (MusicBrainz lists a storefront per country; the US one is preferred).

const path = require('path');
const fs = require('fs');
const { cachedGet } = require('./lib/http');
const { stamp } = require('./lib/meta');
const { writeKeyed, read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const acts = read(path.join(data, 'acts.json'));
const file = path.join(data, 'links.json');
const out = !process.argv.includes('--all') && fs.existsSync(file) ? read(file) : {};

const DEAD = /(^|\.)(myspace\.com|plus\.google\.com|google\.com|friendfeed\.com|last\.fm)$/;
const LISTEN = [['open.spotify.com', 'spotify'], ['music.apple.com', 'apple'], ['deezer.com', 'deezer'], ['tidal.com', 'tidal'], ['music.youtube.com', 'youtubemusic'],
  ['music.amazon.com', 'amazon'], ['qobuz.com', 'qobuz'], ['soundcloud.com', 'soundcloud']];
const SOCIAL = [['facebook.com', 'facebook'], ['instagram.com', 'instagram'], ['twitter.com', 'x'], ['x.com', 'x'], ['tiktok.com', 'tiktok'], ['threads.com', 'threads'], ['threads.net', 'threads'],
  ['vk.com', 'vk'], ['bsky.app', 'bluesky'], ['patreon.com', 'patreon'], ['weibo.com', 'weibo'], ['twitch.tv', 'twitch']];
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

function parse(j) {
  const rec = { official: [], social: [], listen: [], info: [] }, seen = new Set();
  const add = (list, site, url) => { const k = site + url; if (!seen.has(k)) { seen.add(k); list.push({ site, url }); } };
  for (const r of j.relations || []) {
    if (!r.url) continue;
    const url = r.url.resource, host = hostOf(url);
    if (!host || DEAD.test(host) || !/^https?:/.test(url)) continue;
    if (r.type === 'official homepage') add(rec.official, 'website', url);
    else if (r.type === 'social network') { const s = SOCIAL.find(([h]) => host === h || host.endsWith('.' + h)); if (s) add(rec.social, s[1], url); }
    else if (r.type === 'bandcamp') add(rec.listen, 'bandcamp', url);
    else if (r.type === 'youtube') add(rec.listen, 'youtube', url);
    else if (['streaming', 'free streaming', 'youtube music'].includes(r.type)) { const s = LISTEN.find(([h]) => host === h || host.endsWith('.' + h)); if (s) add(rec.listen, s[1], url); }
    else if (r.type === 'wikidata') add(rec.info, 'wikidata', url);
    else if (r.type === 'discogs') add(rec.info, 'discogs', url);
    else if (r.type === 'allmusic') add(rec.info, 'allmusic', url);
  }
  add(rec.info, 'musicbrainz', 'https://musicbrainz.org/artist/' + j.id);
  const best = (list, max = 1) => {
    const bySite = new Map();
    for (const l of list) { const cur = bySite.get(l.site) || []; cur.push(l); bySite.set(l.site, cur); }
    return [...bySite.values()].flatMap(g => [...g].sort((x, y) => (/\/us\//.test(y.url) ? 1 : 0) - (/\/us\//.test(x.url) ? 1 : 0)).slice(0, max));
  };
  rec.official = best(rec.official, 2); rec.social = best(rec.social); rec.listen = best(rec.listen); rec.info = best(rec.info);
  Object.keys(rec).forEach(k => { if (!rec[k].length) delete rec[k]; });
  return rec;
}

(async () => {
  const todo = acts.filter(a => a.mbid && !out[a.id]);
  console.log(`${todo.length} acts need links`);
  let i = 0;
  for (const a of todo) {
    process.stdout.write(`[${++i}/${todo.length}] ${a.name} `);
    try {
      const j = await cachedGet(`https://musicbrainz.org/ws/2/artist/${a.mbid}?inc=url-rels&fmt=json`, { gap: 1100 });
      if (!j) { console.log('- not found'); continue; }
      out[a.id] = parse(j);
      console.log('- ' + Object.values(out[a.id]).reduce((n, l) => n + l.length, 0) + ' links');
    } catch (e) { console.log('- error', e.message); }
  }
  for (const id of Object.keys(out)) if (!acts.some(a => a.id === id && a.mbid)) delete out[id];
  writeKeyed(file, out);
  stamp('links');
  console.log(`\nWrote data/links.json (${Object.keys(out).length} acts)`);
})();
