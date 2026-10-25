#!/usr/bin/env node
// Check every act's start and end year against three independent sources, instead of trusting hand-entered values.
//
//   node tools/verify.js              download what is missing, print the findings, change nothing
//   node tools/verify.js --write      also update data/acts.json and write tools/verify-report.md
//
// Sources for each act:
//   wikipedia   the "years active" field of the article's infobox (the human-edited career span)
//   wikidata    inception / dissolved (P571 / P576) or, for people, the work period (P2031 / P2032)
//   musicbrainz the artist's life span (used for groups only: for a person it is birth and death)
//
// Rule for a start year: two sources agreeing wins; a single source is accepted but marked "single source";
// if all sources disagree the act is flagged for review and nothing is changed.
// An act is "active" (ended = null) when the Wikipedia infobox span is open ("1981-present"), or, without Wikipedia,
// when Wikidata has no dissolution date and MusicBrainz does not mark it ended.

const fs = require('fs');
const path = require('path');
const { cachedGet } = require('./lib/http');
const { writeRecords, read } = require('./lib/json');

const data = path.join(__dirname, '..', 'data');
const WRITE = process.argv.includes('--write');
const acts = read(path.join(data, 'acts.json'));
const links = read(path.join(data, 'links.json'));
const mbx = fs.existsSync(path.join(data, 'musicbrainz.json')) ? read(path.join(data, 'musicbrainz.json')) : {};
const summaries = read(path.join(data, 'summaries.json'));
// a person's ruling where the sources conflict: { "<act id>": { formed?, ended?, note } } in data/date-decisions.json
const decisions = fs.existsSync(path.join(data, 'date-decisions.json')) ? JSON.parse(fs.readFileSync(path.join(data, 'date-decisions.json'), 'utf8')) : {};
const TODAY = new Date().toISOString().slice(0, 10);

const qidOf = id => { const w = (links[id] && links[id].info || []).find(i => i.site === 'wikidata'); return w && (w.url.match(/Q\d+/) || [])[0]; };

// ---------- Wikidata (batches of 50) ----------
async function wikidata() {
  const ids = acts.map(a => qidOf(a.id)).filter(Boolean);
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}&props=claims|sitelinks&sitefilter=enwiki&format=json`;
    const r = await cachedGet(url, { gap: 700, prefix: 'wd' });
    Object.assign(out, (r && r.entities) || {});
  }
  const yearsOf = (e, prop) => ((e.claims && e.claims[prop]) || [])
    .map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.time)
    .filter(Boolean).map(t => +t.slice(1, 5));
  const res = {};
  for (const a of acts) {
    const q = qidOf(a.id), e = q && out[q];
    if (!e || e.missing !== undefined) continue;
    const start = [...yearsOf(e, 'P571'), ...yearsOf(e, 'P2031')], end = [...yearsOf(e, 'P576'), ...yearsOf(e, 'P2032')];
    res[a.id] = { formed: start.length ? Math.min(...start) : null, ended: end.length ? Math.max(...end) : null, title: e.sitelinks && e.sitelinks.enwiki ? e.sitelinks.enwiki.title : null };
  }
  return res;
}

// ---------- Wikipedia infobox ----------
// "years active" is a list of spans: "1965-1973, 1978, 2000-present". Returns the first year, the end of the first span
// (the main run) and every span's end: a band's recorded end counts as confirmed when it matches any of them.
function yearsActive(wikitext) {
  const m = wikitext.match(/\|\s*years[_ ]active\s*=\s*([\s\S]*?)(?=\n\s*\|\s*[a-z_ ]+\s*=|\n\}\})/i);
  if (!m) return null;
  let s = m[1];
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  for (let i = 0; i < 6; i++) s = s.replace(/\{\{[^{}]*\}\}/g, t => {
    const name = (t.match(/^\{\{\s*([^|}]*)/) || [])[1].trim().toLowerCase();
    const inner = t.replace(/^\{\{[^|}]*\|?/, '').replace(/\}\}$/, '');
    if (/^(start|end)[ -]date/.test(name)) return ' ' + ((inner.match(/\d{4}/) || [''])[0]) + ' ';
    if (/^(nowrap|plainlist|ubl|hlist|flatlist|small|nobr|unbulleted list|plain list|flat list)$/.test(name)) return inner.replace(/\|/g, ', ');
    return ' ';
  });
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/&ndash;|&mdash;/g, '-').replace(/&nbsp;/g, ' ').replace(/[–—−]/g, '-')
    .replace(/\([^)]*\)/g, ' ').replace(/\b(present|current|currently|now|ongoing)\b/gi, 'PRES');
  const spans = [];
  for (const chunk of s.split(/[,;\n*]|\band\b/)) {
    const r = chunk.match(/\b(1[89]\d\d|20[0-3]\d)\b\s*-\s*(PRES|\b(?:1[89]\d\d|20[0-3]\d)\b|\d{2}\b)?/);
    if (r) {
      let to = r[2];
      if (to === 'PRES' || to === undefined) to = null;
      else if (to.length === 2) to = +(r[1].slice(0, 2) + to); else to = +to;
      spans.push([+r[1], to]);
      continue;
    }
    const one = chunk.match(/\b(1[89]\d\d|20[0-3]\d)\b/);
    if (one) spans.push([+one[1], +one[1]]);
  }
  if (!spans.length) return null;
  return { text: s.replace(/\s+/g, ' ').trim(), formed: Math.min(...spans.map(x => x[0])), ends: [...new Set(spans.map(x => x[1]))], endLast: spans[spans.length - 1][1] };
}

async function wikipedia(titles) {
  const res = {};
  let n = 0;
  for (const [id, title] of Object.entries(titles)) {
    n++;
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&rvsection=0&redirects=1&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
    try {
      const r = await cachedGet(url, { gap: 600, prefix: 'wp' });
      const page = r && r.query && r.query.pages && r.query.pages[0];
      const text = page && page.revisions && page.revisions[0] && page.revisions[0].slots.main.content;
      if (text) { const y = yearsActive(text); if (y) res[id] = y; }
    } catch (e) { console.log('  wikipedia error for', title, e.message); }
    if (n % 100 === 0) process.stdout.write(`  wikipedia ${n}/${Object.keys(titles).length}\n`);
  }
  return res;
}

(async () => {
  console.log('Wikidata...');
  const wd = await wikidata();
  const titles = {};
  for (const a of acts) { const t = (summaries[a.id] && summaries[a.id].title) || (wd[a.id] && wd[a.id].title); if (t) titles[a.id] = t; }
  console.log(`Wikipedia infoboxes (${Object.keys(titles).length} articles)...`);
  const wp = await wikipedia(titles);

  const findings = [];
  const stats = { confirmed: 0, corrected: 0, review: 0, single: 0, none: 0, solo: 0 };
  const by = (votes, y) => votes.filter(v => v[1] === y).map(v => v[0]);
  for (const a of acts) {
    const w = wp[a.id], d = wd[a.id], m = mbx[a.id];
    const mbg = m && m.type !== 'Person' ? { formed: m.begin ? +m.begin.slice(0, 4) : null, ended: m.ended ? (m.end ? +m.end.slice(0, 4) : undefined) : null } : null;
    const vsrc = { formed: null, ended: null }, review = [];
    let formed = a.formed, ended = a.ended;
    // ----- start year: a group's start is what the sources agree on; a solo artist's "start" means different things in different sources -----
    const fv = [];
    if (w) fv.push(['wikipedia', w.formed]);
    if (d && d.formed) fv.push(['wikidata', d.formed]);
    if (mbg && mbg.formed) fv.push(['musicbrainz', mbg.formed]);
    if (fv.length) {
      const have = by(fv, a.formed);
      if (have.length) vsrc.formed = have.join('+') + (have.length < fv.length ? ' (others: ' + fv.filter(v => v[1] !== a.formed).map(v => v.join('=')).join(', ') + ')' : '');
      else if (a.kind === 'artist') { vsrc.formed = 'not changed, solo career start varies by source: ' + fv.map(v => v.join('=')).join(', '); stats.solo++; }
      else {
        const tally = {}; fv.forEach(([src, y]) => (tally[y] ||= []).push(src));
        const top = Object.entries(tally).sort((x, y) => y[1].length - x[1].length)[0];
        if (top[1].length >= 2 || fv.length === 1) { formed = +top[0]; vsrc.formed = top[1].join('+') + (top[1].length < 2 ? ' (single source)' : ''); if (top[1].length < 2) stats.single++; }
        else { review.push('formed'); vsrc.formed = 'disputed: ' + fv.map(v => v.join('=')).join(', '); }
      }
    }
    // ----- end year (end of the main run, or null while active) -----
    const ev = [];
    if (w) w.ends.forEach(y => ev.push(['wikipedia', y != null && y >= 2025 ? null : y]));   // a span ending this year or last is still running
    if (d && d.ended) ev.push(['wikidata', d.ended]);
    if (mbg && mbg.ended !== undefined) ev.push(['musicbrainz', mbg.ended]);
    if (ev.length) {
      const have = [...new Set(by(ev, a.ended))];
      if (have.length) vsrc.ended = have.join('+');
      else {
        const tally = {};
        ev.forEach(([src, y]) => { const k = String(y); (tally[k] ||= new Set()).add(src); });
        const top = Object.entries(tally).sort((x, y) => y[1].size - x[1].size)[0];
        if (top[1].size >= 2) { ended = top[0] === 'null' ? null : +top[0]; vsrc.ended = [...top[1]].join('+'); }
        else { review.push('ended'); vsrc.ended = 'disputed: ' + ev.map(v => v[0] + '=' + (v[1] ?? 'present')).join(', '); }
      }
    }
    const dec = decisions[a.id];
    if (dec) {
      if ('formed' in dec) { formed = dec.formed; vsrc.formed = 'manual: ' + dec.note; }
      if ('ended' in dec) { ended = dec.ended; vsrc.ended = 'manual: ' + dec.note; }
      review.length = 0;
    }
    if (formed > (ended ?? 9999)) { review.push('formed', 'ended'); formed = a.formed; ended = a.ended; vsrc.formed = 'inconsistent: ' + vsrc.formed; }
    const finding = { id: a.id, name: a.name, was: [a.formed, a.ended], now: [formed, ended], vsrc, review };
    if (!fv.length && !ev.length) { stats.none++; finding.kind = 'unchecked'; }
    else if (review.length) { stats.review++; finding.kind = 'review'; }
    else if (formed !== a.formed || ended !== a.ended) { stats.corrected++; finding.kind = 'corrected'; }
    else { stats.confirmed++; finding.kind = 'confirmed'; }
    findings.push(finding);
    if (WRITE && finding.kind !== 'unchecked') {
      a.formed = formed; a.ended = ended;
      a.verified = TODAY; a.vsrc = vsrc; if (review.length) a.review = review; else delete a.review;
    }
  }


  console.log(`\nconfirmed ${stats.confirmed} | corrected ${stats.corrected} | needs review ${stats.review} | no source found ${stats.none} (single-source start years: ${stats.single}, solo start years left alone: ${stats.solo})`);
  const show = (k, n) => findings.filter(f => f.kind === k).slice(0, n).forEach(f => console.log(`  ${f.name.padEnd(30)} ${f.was[0]}-${f.was[1] ?? 'present'}  ->  ${f.now[0]}-${f.now[1] ?? 'present'}   [${f.vsrc.formed || '-'} | ${f.vsrc.ended || '-'}]`));
  console.log('\ncorrections:'); show('corrected', 200);
  console.log('\nneeds review:'); show('review', 200);

  if (WRITE) {
    writeRecords(path.join(data, 'acts.json'), acts);
    const line = f => `- **${f.name}** (${f.was[0]}–${f.was[1] ?? 'present'}${f.kind === 'corrected' ? ' → ' + f.now[0] + '–' + (f.now[1] ?? 'present') : ''}): ${f.vsrc.formed || '-'} | ${f.vsrc.ended || '-'}`;
    const md = ['# Date verification report', '', `Generated ${TODAY} by tools/verify.js. Sources: Wikipedia infobox, Wikidata, MusicBrainz.`, '',
      `confirmed ${stats.confirmed}, corrected ${stats.corrected}, needs review ${stats.review}, unchecked ${stats.none}`, '',
      '## Corrected', '', ...findings.filter(f => f.kind === 'corrected').map(line),
      '', '## Needs review (nothing changed for the disputed field)', '', ...findings.filter(f => f.kind === 'review').map(line),
      '', '## Unchecked (no source found)', '', ...findings.filter(f => f.kind === 'unchecked').map(f => `- ${f.name}`), ''];
    fs.writeFileSync(path.join(__dirname, 'verify-report.md'), md.join('\n'));
    console.log('\nWrote data/acts.json and tools/verify-report.md');
  } else console.log('\n(dry run: nothing written. Use --write to apply.)');
})();
