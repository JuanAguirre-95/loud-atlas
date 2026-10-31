#!/usr/bin/env node
// Fetch the Wikipedia summary of the article each genre and subgenre is mapped to in data/genre-articles.json.
//
//   node tools/fetch-genres.js
//
// data/genre-articles.json: "<genre id>": [titles]  (the first is the main definition, the rest are shown as related)
//                           "<genre id>|<subgenre>": "title"  (the closest article; many of our subgenres have none and get no definition)
// Writes data/genre-summaries.json: { "<article title>": { title, desc, text, url } }. Wikipedia text is CC BY-SA 4.0, shown with a link.

const path = require('path');
const fs = require('fs');
const { cachedGet } = require('./lib/http');
const { stamp } = require('./lib/meta');
const { writeKeyed } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const map = JSON.parse(fs.readFileSync(path.join(data, 'genre-articles.json'), 'utf8'));
const titles = [...new Set(Object.values(map).flat())];

function trim(text) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  let out = '';
  for (const s of sentences) { if ((out + s).length > 640 && out) break; out += s; if (out.length > 460) break; }
  return out.trim();
}

(async () => {
  const out = {}, missing = [];
  for (const t of titles) {
    const s = await cachedGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`, { gap: 600, prefix: 'w' });
    if (!s || s.type === 'disambiguation' || !s.extract) { missing.push(t); console.log('x ' + t); continue; }
    out[t] = { title: s.title, desc: s.description || '', text: trim(s.extract), url: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || '' };
    console.log('+ ' + t.padEnd(36) + (s.title !== t ? '-> ' + s.title + ' ' : '') + '| ' + (s.description || '').slice(0, 70));
  }
  writeKeyed(path.join(data, 'genre-summaries.json'), out);
  stamp('genre_summaries');
  console.log(`\n${Object.keys(out).length} summaries, ${missing.length} missing${missing.length ? ': ' + missing.join(', ') : ''}`);
})();
