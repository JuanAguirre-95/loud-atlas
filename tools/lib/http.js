// Shared helper for the data tools: polite, cached JSON downloads.
//
//   const { cachedGet } = require('./lib/http');
//   const json = await cachedGet(url, { gap: 1100 });
//
// - one request per `gap` ms per host (MusicBrainz asks for at most 1/s; Wikimedia and ListenBrainz are happy with less)
// - every successful response is stored in tools/.cache, so reruns cost nothing and interrupted runs resume
// - 404 is cached as null; 429/503 are retried with a growing pause; anything else throws
// - `headers` can carry an Authorization header (ListenBrainz); it is never written to the cache key

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cacheDir = path.join(__dirname, '..', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });

const UA = 'LoudAtlas/0.1 (hobby timeline project; https://github.com/JuanAguirre-95/loud-atlas)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastCall = {};

function cacheFile(url, prefix) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 24);
  return path.join(cacheDir, `${prefix}_${hash}.json`);
}

// The first generation of tools (mb.js, wiki.js) named their cache files differently; honour those too so nothing is downloaded twice.
function legacyFiles(url) {
  const b = Buffer.from(url).toString('base64url').slice(-120);
  return [path.join(cacheDir, b + '.json'), path.join(cacheDir, 'w_' + b + '.json')];
}

async function cachedGet(url, { gap = 1100, headers = {}, prefix = 'c', retries = 5, cacheNull = true } = {}) {
  const file = cacheFile(url, prefix);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const old of legacyFiles(url)) if (fs.existsSync(old)) return JSON.parse(fs.readFileSync(old, 'utf8'));
  const host = new URL(url).host;
  for (let attempt = 0; attempt < retries; attempt++) {
    const wait = gap - (Date.now() - (lastCall[host] || 0));
    if (wait > 0) await sleep(wait);
    lastCall[host] = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    if (res.status === 404) { if (cacheNull) fs.writeFileSync(file, 'null'); return null; }
    if (res.status === 429 || res.status === 503) {
      const reset = +res.headers.get('x-ratelimit-reset-in') || 0;
      await sleep(Math.max(3000 * (attempt + 1), reset * 1000 + 500));
      continue;
    }
    if (res.status === 401) throw new Error('401 unauthorised: ' + url.split('?')[0]);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const json = await res.json();
    fs.writeFileSync(file, JSON.stringify(json));
    return json;
  }
  throw new Error('gave up after retries: ' + url);
}

module.exports = { cachedGet, sleep, UA, cacheDir };
