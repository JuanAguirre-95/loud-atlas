#!/usr/bin/env node
// Fetch a short Wikipedia summary for every act and write data/summaries.json.
//
//   node tools/fetch-summaries.js                 only acts that have no summary yet
//   node tools/fetch-summaries.js --refresh a,b   also redo these act ids (e.g. after fixing their MusicBrainz id)
//   node tools/fetch-summaries.js --all           redo everything
//
// Each act is resolved by its exact MusicBrainz id: MusicBrainz url-rels -> Wikipedia page (or Wikidata id -> enwiki sitelink)
// -> REST summary. That avoids picking the wrong article for names like "Death", "Venom" or "Sleep".
// Wikipedia text is CC BY-SA 4.0; the app shows the attribution and a link next to every summary.

const path = require('path');
const fs = require('fs');
const { cachedGet } = require('./lib/http');
const { writeKeyed, read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const acts = read(path.join(data, 'acts.json'));
const file = path.join(data, 'summaries.json');
const out = fs.existsSync(file) ? read(file) : {};
const args = process.argv.slice(2);
const refresh = new Set(args.includes('--refresh') ? (args[args.indexOf('--refresh') + 1] || '').split(',') : []);
if (args.includes('--all')) Object.keys(out).forEach(k => delete out[k]);
refresh.forEach(id => delete out[id]);

// exact enwiki titles for acts MusicBrainz can't resolve (or resolves to the wrong act)
const OVERRIDE = { kino: 'Kino (band)' };

function trimExtract(text) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  let o = '';
  for (const s of sentences) {
    if ((o + s).length > 520 && o) break;
    o += s;
    if (o.length > 380) break;
  }
  return o.trim();
}

(async () => {
  const todo = acts.filter(a => a.mbid && !out[a.id]);
  const miss = [];
  console.log(`${todo.length} acts need a summary`);
  let i = 0;
  for (const a of todo) {
    process.stdout.write(`[${++i}/${todo.length}] ${a.name} `);
    try {
      let title = OVERRIDE[a.id] || null;
      if (!title) {
        const rels = await cachedGet(`https://musicbrainz.org/ws/2/artist/${a.mbid}?inc=url-rels&fmt=json`, { gap: 1100 });
        const urls = ((rels && rels.relations) || []).filter(r => r.url).map(r => ({ type: r.type, url: r.url.resource }));
        const wp = urls.find(u => /^https?:\/\/en\.wikipedia\.org\/wiki\//.test(u.url));
        if (wp) title = decodeURIComponent(wp.url.split('/wiki/')[1]).replace(/_/g, ' ');
        else {
          const wd = urls.find(u => u.type === 'wikidata'), qid = wd && (wd.url.match(/Q\d+/) || [])[0];
          if (qid) {
            const e = await cachedGet(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&sitefilter=enwiki&format=json`, { gap: 700, prefix: 'wd' });
            title = e && e.entities && e.entities[qid] && e.entities[qid].sitelinks && e.entities[qid].sitelinks.enwiki && e.entities[qid].sitelinks.enwiki.title || null;
          }
        }
      }
      if (!title) { console.log('- no enwiki page'); miss.push(a.id); continue; }
      const s = await cachedGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { gap: 700, prefix: 'w' });
      if (!s || s.type === 'disambiguation' || !s.extract) { console.log('- no summary'); miss.push(a.id); continue; }
      out[a.id] = { title: s.title, desc: s.description || '', text: trimExtract(s.extract), url: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
      console.log('- ok');
    } catch (e) { console.log('- error', e.message); miss.push(a.id); }
    if (i % 25 === 0) writeKeyed(file, out);
  }
  writeKeyed(file, out);
  console.log(`\nWrote data/summaries.json: ${Object.keys(out).length} summaries${miss.length ? ', none for ' + miss.join(', ') : ''}`);
})();
