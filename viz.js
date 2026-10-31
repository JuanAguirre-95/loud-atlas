// Loud Atlas "Insights": extra ways to look at the same data. Loaded the first time the Insights button is used.
// Nine views, each a function that draws into the stage. They read the data through window.AtlasApp (set up by app.js).
(() => {
'use strict';
const App = window.AtlasApp, A = App.A, { BANDS, GENRES, genreById, bandById, esc, col, NOW, T0 } = App;
const root = document.getElementById('vizview'), bar = document.getElementById('vizbar'), stage = document.getElementById('vizbody'), tip = document.getElementById('tip');
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const decades = Array.from({ length: 10 }, (_, i) => 1930 + i * 10);
let current = null, cleanup = null;

// ---------- small helpers ----------
const showTip = (e, html) => { tip.hidden = false; tip.innerHTML = html; tip.style.left = Math.min(e.clientX + 14, innerWidth - 260) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - 90) + 'px'; };
const hideTip = () => { tip.hidden = true; };
const head = (title, text) => `<div class="vz-head"><h3>${title}</h3><p>${text}</p></div>`;
const actLink = b => `<button class="vz-act" data-act="${b.id}" style="--c:${col(genreById[b.genre])}">${esc(b.name)}</button>`;
const years = b => `${b.formed}–${b.ended ?? 'present'}`;
const sizeOf = () => ({ w: Math.max(stage.clientWidth, 300), h: Math.max(stage.clientHeight, 300) });
function openAct(id) { const b = bandById[id]; if (b) App.select(b); }
stage.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (a && !a.dataset.nav) openAct(a.dataset.act); });
// the act list shown beside a chart
function listBox(title, acts) {
  return `<div class="vz-listhead">${title}</div><div class="vz-chips">${acts.slice(0, 80).map(actLink).join('')}${acts.length > 80 ? `<span class="muted">+ ${acts.length - 80} more</span>` : ''}</div>`;
}
function actInput(id, value, ph) {
  return `<input id="${id}" list="bandlist" placeholder="${ph || 'Pick an act'}" value="${esc(value || '')}" autocomplete="off" aria-label="${ph || 'Act'}">`;
}
const byName = v => App.bandFromInput(v);
const activeIn = (b, y0, y1) => b.formed <= y1 && (b.ended ?? NOW) >= y0;

// ============ 1. Scene map (world map, years slider) ============
const GEO_NAME = { USA: 'United States of America', UK: 'United Kingdom', Czechoslovakia: 'Czechia', USSR: 'Russia' };
const countriesOf = b => String(b.country).split('/').map(x => x.trim()).filter(Boolean).map(x => GEO_NAME[x] || x);
function renderMap() {
  const geo = window.ATLAS_VIZ.geo;
  if (!geo) { stage.innerHTML = head('Scene map', 'Map data is missing.'); return; }
  const { w, h } = sizeOf();
  const mapW = Math.max(Math.min(stage.clientWidth - 360, 1000), 420), mapH = mapW / 2.535;
  const lon0 = -170, lon1 = 190, lat0 = -58, lat1 = 84;
  const sx = mapW / (lon1 - lon0), sy = mapH / (lat1 - lat0);
  const X = x => ((x / 10) - lon0) * sx, Y = y => (lat1 - (y / 10)) * sy;
  const paths = Object.entries(geo).map(([name, rings]) => `<path data-c="${esc(name)}" d="${rings.map(r => { let d = ''; for (let i = 0; i < r.length; i += 2) d += (i ? 'L' : 'M') + X(r[i]).toFixed(1) + ' ' + Y(r[i + 1]).toFixed(1); return d + 'Z'; }).join('')}"/>`).join('');
  stage.innerHTML = head('Scene map', 'Where the acts on the map come from, and how that changes over time. Drag the year, or press play. Countries shade by how many acts formed there.') + `
    <div class="vz-controls"><button id="mapPlay" aria-label="Play">▶</button><input id="mapYear" type="range" min="1930" max="${NOW}" value="${NOW}" aria-label="Year"><b id="mapYearLabel">${NOW}</b>
      <label class="inl"><input type="radio" name="mapMode" value="cum" checked> formed so far</label><label class="inl"><input type="radio" name="mapMode" value="act"> active that year</label><span id="mapTotal" class="muted"></span></div>
    <div class="vz-cols"><svg id="worldmap" viewBox="0 0 ${mapW} ${mapH}" width="${mapW}" height="${mapH}" role="img" aria-label="World map shaded by number of acts">${paths}</svg><div id="mapSide" class="vz-side"></div></div>`;
  const svg = $('worldmap'), side = $('mapSide');
  const nodes = new Map([...svg.querySelectorAll('path')].map(p => [p.dataset.c, p]));
  let mode = 'cum', year = NOW, picked = null;
  const counts = () => {
    const m = new Map();
    for (const b of BANDS) {
      const ok = mode === 'cum' ? b.formed <= year : activeIn(b, year, year);
      if (ok) countriesOf(b).forEach(c => m.set(c, (m.get(c) || 0) + 1));
    }
    return m;
  };
  const max = Math.max(...[...(function () { const m = new Map(); BANDS.forEach(b => countriesOf(b).forEach(c => m.set(c, (m.get(c) || 0) + 1))); return m; })().values()]);
  function paint() {
    const m = counts(); let total = 0;
    nodes.forEach((p, name) => {
      const n = m.get(name) || 0; total += n;
      p.style.fillOpacity = n ? (0.18 + 0.82 * Math.sqrt(n / max)).toFixed(2) : '';
      p.classList.toggle('has', n > 0); p.classList.toggle('sel', name === picked);
      p.dataset.n = n;
    });
    $('mapYearLabel').textContent = year;
    $('mapTotal').textContent = total + (mode === 'cum' ? ' acts formed by ' : ' acts active in ') + year;
    const rank = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    side.innerHTML = '<div class="vz-listhead">Top countries</div><ol class="vz-rank">' + rank.map(([c, n]) => `<li><button data-country="${esc(c)}">${esc(c.replace('United States of America', 'USA'))}</button><b>${n}</b></li>`).join('') + '</ol>' +
      (picked ? pickedList() : '<p class="muted">Click a country to list its acts.</p>');
  }
  function pickedList() {
    const acts = BANDS.filter(b => countriesOf(b).includes(picked) && (mode === 'cum' ? b.formed <= year : activeIn(b, year, year))).sort((a, b) => a.formed - b.formed);
    return listBox(esc(picked) + ' · ' + acts.length + ' acts', acts);
  }
  svg.addEventListener('mousemove', e => { const p = e.target.closest('path'); if (!p) return hideTip(); showTip(e, `<b>${esc(p.dataset.c)}</b><small>${p.dataset.n} acts</small>`); });
  svg.addEventListener('mouseleave', hideTip);
  svg.addEventListener('click', e => { const p = e.target.closest('path'); if (p) { picked = p.dataset.c; paint(); } });
  side.addEventListener('click', e => { const c = e.target.closest('[data-country]'); if (c) { picked = c.dataset.country; paint(); } });
  $('mapYear').addEventListener('input', e => { year = +e.target.value; paint(); });
  stage.querySelectorAll('[name=mapMode]').forEach(r => r.addEventListener('change', () => { mode = r.value; paint(); }));
  let timer = 0;
  $('mapPlay').onclick = () => {
    if (timer) { clearInterval(timer); timer = 0; $('mapPlay').textContent = '▶'; return; }
    if (year >= NOW) year = 1930;
    $('mapPlay').textContent = '❚❚';
    timer = setInterval(() => { year++; $('mapYear').value = year; paint(); if (year >= NOW) { clearInterval(timer); timer = 0; $('mapPlay').textContent = '▶'; } }, 120);
  };
  cleanup = () => clearInterval(timer);
  paint();
}

// ============ 2. Lineup flow (where a band's musicians came from and went) ============
let people = null;
function peopleIndex() {
  if (people) return people;
  people = new Map();
  for (const [id, list] of Object.entries(A.members)) for (const [name, from, to] of list) {
    if (!people.has(name)) people.set(name, []);
    people.get(name).push({ id, from, to });
  }
  return people;
}
let flowId = 'sabbath';
function renderFlow() {
  const idx = peopleIndex();
  if (!bandById[flowId]) flowId = 'sabbath';
  const b = bandById[flowId];
  const { w, h } = sizeOf();
  const own = (A.members[b.id] || []).filter(([name]) => (idx.get(name) || []).length > 1);
  const rows = own.map(([name, from, to]) => {
    const mine = (idx.get(name) || []).find(x => x.id === b.id) || { from, to };
    const others = (idx.get(name) || []).filter(x => x.id !== b.id && bandById[x.id]);
    const start = mine.from ?? bandById[b.id].formed;
    const before = others.filter(x => (x.to != null && x.to <= start + 1) || (x.from != null && x.from < start - 1 && x.to != null)).sort((p, q) => (p.from ?? 0) - (q.from ?? 0));
    const rest = others.filter(x => !before.includes(x)).sort((p, q) => (p.from ?? 9999) - (q.from ?? 9999));
    return { name, from: mine.from, to: mine.to, before, after: rest };
  }).filter(r => r.before.length || r.after.length).slice(0, 14);
  const top = [...idx.entries()].filter(([, l]) => l.length >= 4).sort((x, y) => y[1].length - x[1].length).slice(0, 14);
  stage.innerHTML = head('Lineup flow', 'Pick a band: each musician who also played elsewhere is a row. Bands on the left are where they were before, bands on the right are where they went or played alongside.') +
    `<div class="vz-controls">${actInput('flowIn', b.name, 'Band')}<span class="muted">Most travelled musicians:</span><span class="vz-chips">${top.map(([n, l]) => `<button class="vz-act" data-person="${esc(n)}" title="${l.length} acts">${esc(n)}</button>`).join('')}</span></div><div class="vz-stage" id="flowStage"></div>`;
  const fs = $('flowStage'), W = Math.max(fs.clientWidth, 600), rowH = 38, H = Math.max(rows.length * rowH + 40, 160);
  const cx = W / 2, colL = 150, colR = W - 150;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Where the members of ${esc(b.name)} played before and after">`;
  const nodeX = (side) => (side === 'l' ? colL : colR);
  const seen = { l: new Map(), r: new Map() };
  const slot = (side, id) => { const m = seen[side]; if (!m.has(id)) m.set(id, 30 + m.size * 26); return m.get(id); };
  rows.forEach((r, i) => {
    const y = 28 + i * rowH, hue = (i * 47) % 360;
    const color = `hsl(${hue},62%,58%)`;
    r.before.slice(0, 5).forEach(o => { const ny = slot('l', o.id) ; svg += `<path class="vz-flow" d="M${colL} ${ny} C${cx - 120} ${ny} ${cx - 140} ${y} ${cx - 70} ${y}" stroke="${color}"><title>${esc(r.name)}: ${esc(bandById[o.id].name)}</title></path>`; });
    r.after.slice(0, 5).forEach(o => { const ny = slot('r', o.id); svg += `<path class="vz-flow" d="M${cx + 70} ${y} C${cx + 140} ${y} ${cx + 120} ${ny} ${colR} ${ny}" stroke="${color}"><title>${esc(r.name)}: ${esc(bandById[o.id].name)}</title></path>`; });
    svg += `<g class="vz-member"><rect x="${cx - 70}" y="${y - 13}" width="140" height="26" rx="13" fill="${color}" opacity=".18" stroke="${color}"/><text x="${cx}" y="${y + 4}" text-anchor="middle">${esc(r.name.length > 20 ? r.name.slice(0, 19) + '…' : r.name)}</text><title>${esc(r.name)} in ${esc(b.name)}: ${r.from ?? '?'}–${r.to ?? 'present'}</title></g>`;
  });
  for (const side of ['l', 'r']) for (const [id, y] of seen[side]) {
    const o = bandById[id], anchor = side === 'l' ? 'end' : 'start', x = nodeX(side) + (side === 'l' ? -10 : 10);
    svg += `<g class="vz-node" data-nav="1" data-flow="${id}"><circle cx="${nodeX(side)}" cy="${y}" r="6" fill="${col(genreById[o.genre])}"/><text x="${x}" y="${y + 4}" text-anchor="${anchor}">${esc(o.name)}</text></g>`;
  }
  svg += `<text class="vz-colhead" x="${colL}" y="14" text-anchor="middle">Before</text><text class="vz-colhead" x="${cx}" y="14" text-anchor="middle">${esc(b.name)}</text><text class="vz-colhead" x="${colR}" y="14" text-anchor="middle">After / alongside</text></svg>`;
  fs.innerHTML = rows.length ? svg : `<p class="muted pad">No member of ${esc(b.name)} is listed in another act on this map.</p>`;
  const go = id => { flowId = id; renderFlow(); };
  fs.addEventListener('click', e => { const n = e.target.closest('[data-flow]'); if (n) go(n.dataset.flow); });
  $('flowIn').addEventListener('change', e => { const x = byName(e.target.value); if (x) go(x.id); });
  stage.querySelectorAll('[data-person]').forEach(btn => btn.addEventListener('click', () => {
    const list = idx.get(btn.dataset.person) || [];
    const first = list.filter(x => bandById[x.id]).sort((p, q) => (A.members[q.id] || []).length - (A.members[p.id] || []).length)[0];
    if (first) go(first.id);
  }));
}

// ============ 3. Era fingerprint (genre mix per decade) ============
function renderFingerprint() {
  const { w, h } = sizeOf();
  const cols = w > 1100 ? 5 : w > 700 ? 4 : 2;
  const cell = Math.min(Math.floor((stage.clientWidth - 30) / cols), 230);
  const counts = decades.map(d => { const m = {}; BANDS.forEach(b => { if (activeIn(b, d, d + 9)) m[b.genre] = (m[b.genre] || 0) + 1; }); return m; });
  const max = Math.max(...counts.flatMap(m => Object.values(m)));
  const R = cell / 2 - 22, n = GENRES.length;
  const arc = (r, a0, a1) => { const p = (r_, a) => [Math.cos(a) * r_, Math.sin(a) * r_]; const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1); return `M0 0L${x0.toFixed(1)} ${y0.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`; };
  const fig = decades.map((d, i) => {
    const m = counts[i], total = Object.values(m).reduce((a, b) => a + b, 0);
    const wedges = GENRES.map((g, j) => {
      const c = m[g.id] || 0; if (!c) return '';
      const a0 = (j / n) * 6.283 - 1.5708, a1 = ((j + 1) / n) * 6.283 - 1.5708, r = R * Math.sqrt(c / max);
      return `<path class="vz-wedge" d="${arc(Math.max(r, 3), a0, a1)}" fill="${col(g)}" data-d="${d}" data-g="${g.id}" data-n="${c}"/>`;
    }).join('');
    return `<figure><svg viewBox="${-cell / 2} ${-cell / 2} ${cell} ${cell}" width="${cell}" height="${cell}" role="img" aria-label="${d}s: ${total} acts active"><circle r="${R}" class="vz-ring"/><circle r="${R / 2}" class="vz-ring"/>${wedges}</svg><figcaption><b>${d}s</b> <span class="muted">${total} acts</span></figcaption></figure>`;
  }).join('');
  stage.innerHTML = head('Era fingerprint', 'Each flower is one decade. A petal is a genre (same position in every flower) and its length is how many acts of that genre were active. The shape of the petals is the sound of the era. Click a petal for its acts.') +
    `<div class="vz-legend">${GENRES.map(g => `<span><i style="background:${col(g)}"></i>${esc(g.name)}</span>`).join('')}</div><div class="vz-flowers" id="flowers">${fig}</div><div id="fpList" class="vz-below"></div>`;
  const list = $('fpList');
  $('flowers').addEventListener('mousemove', e => { const p = e.target.closest('.vz-wedge'); if (!p) return hideTip(); showTip(e, `<b>${esc(genreById[p.dataset.g].name)}</b><small>${p.dataset.d}s · ${p.dataset.n} acts</small>`); });
  $('flowers').addEventListener('mouseleave', hideTip);
  $('flowers').addEventListener('click', e => {
    const p = e.target.closest('.vz-wedge'); if (!p) return;
    const d = +p.dataset.d, acts = BANDS.filter(b => b.genre === p.dataset.g && activeIn(b, d, d + 9)).sort((a, b) => a.formed - b.formed);
    list.innerHTML = listBox(`${esc(genreById[p.dataset.g].name)} in the ${d}s · ${acts.length} acts`, acts);
    list.scrollIntoView({ block: 'nearest' });
  });
}

// ============ 4. Album constellation (every rated key album: year, rating, votes) ============
function renderStars() {
  const pts = [];
  for (const b of BANDS) for (const r of b.rel) if (r.rating != null && r.votes > 0) pts.push({ b, r, x: r.year, y: r.rating, v: r.votes });
  stage.innerHTML = head('Album constellation', 'Every key album with a community rating: left to right is release year, height is rating, size is how many people voted. Hover for the record, click to open the act.') +
    `<div class="vz-controls"><label>Highlight <select id="starGenre"><option value="">All genres</option>${GENRES.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label><label class="inl"><input type="checkbox" id="starMin" checked> only albums with 5+ votes</label><span id="starCount" class="muted"></span></div><div class="vz-stage"><canvas id="starCv"></canvas></div>`;
  const cv = $('starCv'), box = cv.parentElement, c = cv.getContext('2d');
  let hover = null, genre = '', minVotes = 5, drawn = [];
  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = box.clientWidth, H = Math.max(box.clientHeight, 360);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(root), text = css.getPropertyValue('--muted').trim() || '#888', line = css.getPropertyValue('--line').trim() || '#333';
    const L = 46, R = 16, T = 12, B = 30, x = y => L + (y - 1950) / (NOW - 1950) * (W - L - R), yy = v => T + (5 - v) / (5 - 2.5) * (H - T - B);
    c.clearRect(0, 0, W, H); c.font = '12px Barlow Condensed, sans-serif'; c.fillStyle = text; c.strokeStyle = line; c.lineWidth = 1;
    for (let v = 2.5; v <= 5.001; v += .5) { c.beginPath(); c.moveTo(L, yy(v)); c.lineTo(W - R, yy(v)); c.stroke(); c.fillText(v.toFixed(1), 8, yy(v) + 4); }
    for (let yr = 1950; yr <= 2020; yr += 10) { c.fillText(String(yr), x(yr) - 14, H - 10); c.beginPath(); c.moveTo(x(yr), T); c.lineTo(x(yr), H - B); c.globalAlpha = .4; c.stroke(); c.globalAlpha = 1; }
    drawn = [];
    const list = pts.filter(p => p.v >= minVotes && p.x >= 1950).sort((a, b) => (genre && a.b.genre === genre) - (genre && b.b.genre === genre) || a.v - b.v);
    $('starCount').textContent = list.length + ' albums';
    for (const p of list) {
      const px = x(p.x) + ((p.b.name.length * 7 + p.r.title.length * 3) % 11 - 5) * .6, py = yy(p.y), rad = clamp(1.8 + Math.sqrt(p.v) * .22, 2, 11);
      const dim = genre && p.b.genre !== genre;
      c.globalAlpha = dim ? .08 : hover && hover !== p ? .55 : .85;
      c.fillStyle = col(genreById[p.b.genre], 62); c.beginPath(); c.arc(px, py, rad, 0, 6.283); c.fill();
      drawn.push({ p, px, py, rad, dim });
    }
    c.globalAlpha = 1;
    if (hover) { const d = drawn.find(q => q.p === hover); if (d) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(d.px, d.py, d.rad + 2, 0, 6.283); c.stroke(); } }
  }
  const at = e => { const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = 1e9; for (const d of drawn) { if (d.dim) continue; const dist = Math.hypot(d.px - mx, d.py - my); if (dist < Math.max(d.rad, 4) + 2 && dist < bd) { best = d; bd = dist; } } return best; };
  cv.addEventListener('mousemove', e => { const d = at(e); const h = d ? d.p : null; if (h !== hover) { hover = h; draw(); } if (h) showTip(e, `<b>${esc(h.r.title)}</b><small>${esc(h.b.name)} · ${h.r.year} · ★ ${h.r.rating.toFixed(2)} · ${h.r.votes} votes</small>`); else hideTip(); cv.style.cursor = h ? 'pointer' : 'default'; });
  cv.addEventListener('mouseleave', () => { hover = null; hideTip(); draw(); });
  cv.addEventListener('click', e => { const d = at(e); if (d) App.select(d.p.b, d.p.r.year); });
  $('starGenre').addEventListener('change', e => { genre = e.target.value; draw(); });
  $('starMin').addEventListener('change', e => { minVotes = e.target.checked ? 5 : 1; draw(); });
  draw();
  cleanup = () => {};
  stage._redraw = draw;
}

// ============ 5. Influence tree (radial: roots on the left, offspring on the right) ============
let treeId = 'metallica';
function renderTree() {
  if (!bandById[treeId]) treeId = 'metallica';
  const b = bandById[treeId];
  stage.innerHTML = head('Influence tree', 'The selected act sits in the middle. Its roots fan out to the left, up to three generations back; the acts it influenced fan out to the right. Click any act to re-centre on it.') +
    `<div class="vz-controls">${actInput('treeIn', b.name, 'Act')}<span id="treeNote" class="muted"></span></div><div class="vz-stage" id="treeStage"></div>`;
  const ts = $('treeStage'), W = Math.max(ts.clientWidth, 500), H = Math.max(ts.clientHeight, 420);
  const cx = W / 2, cy = H / 2, step = Math.min((W / 2 - 90) / 3.1, 150), yk = Math.min(1, (H / 2 - 28) / (3 * step));   // squash vertically when the window is short
  const gens = (next, max) => { const levels = [], seen = new Set([b.id]); let front = [b.id]; for (let g = 0; g < max; g++) { const nxt = []; for (const id of front) for (const o of next(id)) if (!seen.has(o) && bandById[o]) { seen.add(o); nxt.push({ id: o, parent: id }); } levels.push(nxt); front = nxt.map(n => n.id); } return levels; };
  const roots = gens(id => bandById[id].from, 3), kids = gens(id => App.children[id] || [], 3);
  const CAP = [14, 22, 26];
  let hidden = 0;
  const place = (levels, side) => {
    const out = [];
    levels.forEach((lv, gi) => {
      const list = lv.slice(0, CAP[gi]); hidden += lv.length - list.length;
      list.sort((p, q) => bandById[p.id].formed - bandById[q.id].formed);
      const r = (gi + 1) * step, span = Math.min(2.5, .5 + list.length * .17);
      list.forEach((n, i) => { const a = list.length === 1 ? 0 : -span / 2 + span * i / (list.length - 1); out.push({ ...n, gen: gi + 1, x: cx + side * Math.cos(a) * r, y: cy + Math.sin(a) * r * yk }); });
    });
    return out;
  };
  const L = place(roots, -1), R = place(kids, 1), all = new Map([...L, ...R].map(n => [n.id, n]));
  $('treeNote').textContent = `${L.length} ancestors, ${R.length} descendants shown` + (hidden ? ` (${hidden} more not drawn)` : '');
  const pos = id => id === b.id ? { x: cx, y: cy } : all.get(id);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Influence tree around ${esc(b.name)}">`;
  for (let g = 1; g <= 3; g++) svg += `<ellipse class="vz-ring" cx="${cx}" cy="${cy}" rx="${g * step}" ry="${g * step * yk}"/>`;
  for (const n of [...L, ...R]) { const p = pos(n.parent) || { x: cx, y: cy }; const mx = (p.x + n.x) / 2; svg += `<path class="vz-link" d="M${p.x} ${p.y} C${mx} ${p.y} ${mx} ${n.y} ${n.x} ${n.y}" stroke="${col(genreById[bandById[n.id].genre], 58)}"/>`; }
  const node = (o, x, y, side, big) => `<g class="vz-node" data-nav="1" data-tree="${o.id}" tabindex="0"><circle cx="${x}" cy="${y}" r="${big ? 11 : 6}" fill="${col(genreById[o.genre])}"${big ? ' stroke="var(--text)" stroke-width="2"' : ''}/><text x="${x + (big ? 0 : side * 10)}" y="${big ? y - 18 : y + 4}" text-anchor="${big ? 'middle' : side > 0 ? 'start' : 'end'}"${big ? ' class="big"' : ''}>${esc(o.name)}</text><title>${esc(o.name)} · ${years(o)}</title></g>`;
  for (const n of L) svg += node(bandById[n.id], n.x, n.y, -1);
  for (const n of R) svg += node(bandById[n.id], n.x, n.y, 1);
  svg += node(b, cx, cy, 0, true);
  svg += `<text class="vz-colhead" x="${cx - 1.6 * step}" y="16" text-anchor="middle">Roots</text><text class="vz-colhead" x="${cx + 1.6 * step}" y="16" text-anchor="middle">Offspring</text></svg>`;
  ts.innerHTML = L.length + R.length ? svg : `<p class="muted pad">${esc(b.name)} has no recorded influences or offspring on this map.</p>`;
  const go = id => { treeId = id; renderTree(); };
  ts.addEventListener('click', e => { const n = e.target.closest('[data-tree]'); if (n) { go(n.dataset.tree); App.select(bandById[n.dataset.tree]); } });
  ts.addEventListener('keydown', e => { if (e.key === 'Enter') { const n = e.target.closest('[data-tree]'); if (n) go(n.dataset.tree); } });
  $('treeIn').addEventListener('change', e => { const x = byName(e.target.value); if (x) go(x.id); });
}

// ============ 6. Six degrees game ============
const nbrs = new Map();
function neighbours(id) {
  if (!nbrs.size) {
    const add = (a, b, why) => { if (!nbrs.has(a)) nbrs.set(a, new Map()); if (!nbrs.get(a).has(b)) nbrs.get(a).set(b, why); };
    for (const b of BANDS) for (const p of b.from) if (bandById[p]) { add(b.id, p, 'influenced by'); add(p, b.id, 'influenced'); }
    for (const e of A.shared) { add(e.a, e.b, 'shares ' + e.who.join(', ')); add(e.b, e.a, 'shares ' + e.who.join(', ')); }
  }
  return nbrs.get(id) || new Map();
}
function shortest(a, b) {
  const prev = new Map([[a, null]]); let q = [a];
  while (q.length && !prev.has(b)) { const nx = []; for (const id of q) for (const o of neighbours(id).keys()) if (!prev.has(o)) { prev.set(o, id); nx.push(o); } q = nx; }
  if (!prev.has(b)) return null;
  const path = []; for (let x = b; x != null; x = prev.get(x)) path.unshift(x); return path;
}
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let game = null;
function newPuzzle(seed) {
  const r = rng(seed ?? Math.floor(Math.random() * 1e9));
  const pool = BANDS.filter(b => neighbours(b.id).size >= 3);
  for (let i = 0; i < 400; i++) {
    const a = pool[Math.floor(r() * pool.length)], b = pool[Math.floor(r() * pool.length)];
    if (a === b) continue;
    const p = shortest(a.id, b.id);
    if (p && p.length >= 4 && p.length <= 6) return { from: a.id, to: b.id, best: p.length - 1, path: [a.id], won: false, gaveUp: false, seed };
  }
  return { from: 'metallica', to: 'beatles', best: shortest('metallica', 'beatles').length - 1, path: ['metallica'], won: false, seed };
}
const todaySeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
function renderGame() {
  if (!game) game = newPuzzle(todaySeed());
  const g = game, cur = g.path[g.path.length - 1], from = bandById[g.from], to = bandById[g.to];
  const ns = [...neighbours(cur).entries()].filter(([id]) => bandById[id] && !g.path.includes(id)).sort((x, y) => bandById[x[0]].name.localeCompare(bandById[y[0]].name));
  const chain = g.path.map((id, i) => `<span class="vz-step">${i ? `<em>${esc(neighbours(g.path[i - 1]).get(id) || '')}</em>` : ''}<button class="vz-act" data-act="${id}" style="--c:${col(genreById[bandById[id].genre])}">${esc(bandById[id].name)}</button></span>`).join('<span class="vz-arrow">→</span>');
  const steps = g.path.length - 1;
  let status = `Steps so far: <b>${steps}</b> · shortest possible: <b>${g.best}</b>`;
  if (g.won) status = steps === g.best ? `🎉 Solved in <b>${steps}</b> steps, the shortest possible.` : `Solved in <b>${steps}</b> steps. The shortest route is <b>${g.best}</b>.`;
  if (g.gaveUp) status = `The shortest route takes <b>${g.best}</b> steps:`;
  stage.innerHTML = head('Six degrees of metal', 'Connect two acts by hopping along influences and shared members. Pick a neighbour at each step and try to reach the target in as few hops as possible. The daily puzzle is the same for everyone.') +
    `<div class="vz-game"><div class="vz-goal"><span>${actLink(from)}</span><b>→ … →</b><span>${actLink(to)}</span></div>
      <div class="vz-controls"><button id="gmDaily">Daily puzzle</button><button id="gmNew">Random puzzle</button><button id="gmUndo" ${g.path.length < 2 || g.won ? 'disabled' : ''}>Undo</button><button id="gmShow" ${g.won ? 'disabled' : ''}>Show the shortest route</button><span class="vz-status">${status}</span></div>
      <div class="vz-chain">${chain}</div>
      ${g.won || g.gaveUp ? '' : `<div class="vz-listhead">From <b>${esc(bandById[cur].name)}</b>, hop to… <input id="gmFilter" placeholder="filter" aria-label="Filter neighbours"></div><div class="vz-chips" id="gmList">${ns.map(([id, why]) => `<button class="vz-act" data-hop="${id}" title="${esc(why)}" style="--c:${col(genreById[bandById[id].genre])}">${esc(bandById[id].name)}</button>`).join('')}</div>`}</div>`;
  stage.querySelectorAll('[data-hop]').forEach(btn => btn.addEventListener('click', () => {
    g.path.push(btn.dataset.hop);
    if (btn.dataset.hop === g.to) g.won = true;
    renderGame();
  }));
  const f = $('gmFilter'); if (f) f.addEventListener('input', () => { const q = f.value.toLowerCase(); $('gmList').querySelectorAll('button').forEach(b => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); }); });
  $('gmNew').onclick = () => { game = newPuzzle(); renderGame(); };
  $('gmDaily').onclick = () => { game = newPuzzle(todaySeed()); renderGame(); };
  $('gmUndo').onclick = () => { g.path.pop(); renderGame(); };
  $('gmShow').onclick = () => { g.path = shortest(g.from, g.to); g.gaveUp = true; renderGame(); };
}

// ============ 7. Calendar heat map (release days across the year) ============
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function renderCalendar() {
  stage.innerHTML = head('Release calendar', 'Every album with a known release day, by day of the year. Darker is more albums. Click a day to see them in "On this day".') + '<p class="muted pad">Loading release dates…</p>';
  App.loadAlbums(ok => {
    if (!ok || current !== 'calendar') { if (!ok) stage.innerHTML = head('Release calendar', 'Could not load the release dates.'); return; }
    const grid = Array.from({ length: 12 }, () => Array.from({ length: 31 }, () => []));
    for (const b of BANDS) for (const a of b.all || b.albums) {
      if (a.live || !a.date) continue;
      const [m, d] = a.date.split('-').map(Number);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) grid[m - 1][d - 1].push({ b, a });
    }
    const max = Math.max(...grid.flat().map(x => x.length)), total = grid.flat().reduce((s, x) => s + x.length, 0);
    const { w } = sizeOf(), cw = clamp(Math.floor((w - 150) / 31), 14, 34), ch = Math.round(cw * 1.1), L = 48;
    let svg = `<svg viewBox="0 0 ${L + 31 * cw + 4} ${24 + 12 * ch}" width="${L + 31 * cw + 4}" height="${24 + 12 * ch}" role="img" aria-label="Release calendar">`;
    for (let d = 1; d <= 31; d++) if (d === 1 || d % 5 === 0) svg += `<text class="vz-axis" x="${L + (d - 1) * cw + cw / 2}" y="12" text-anchor="middle">${d}</text>`;
    grid.forEach((row, m) => {
      svg += `<text class="vz-axis" x="${L - 8}" y="${24 + m * ch + ch / 2 + 4}" text-anchor="end">${MONTHS[m]}</text>`;
      row.forEach((cell, d) => {
        const n = cell.length; if (m === 1 && d > 28 && !n) return;
        const o = n ? (0.15 + 0.85 * n / max).toFixed(2) : 0.04;
        svg += `<rect class="vz-day" x="${L + d * cw + 1}" y="${24 + m * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" data-m="${m + 1}" data-d="${d + 1}" data-n="${n}" fill="${n ? 'var(--accent)' : 'var(--text)'}" fill-opacity="${o}"/>`;
      });
    });
    svg += '</svg>';
    stage.innerHTML = head('Release calendar', `${total.toLocaleString('en')} albums with a known release day, by day of the year. Darker means more albums. Click a day to open it in "On this day".`) + `<div class="vz-scroll">${svg}</div><p class="muted">January 1 and the first of other months are often placeholder dates, so read the very top of the list with care. Busiest days: ${grid.flatMap((r, m) => r.map((c, d) => [m, d, c.length])).sort((a, b) => b[2] - a[2]).slice(0, 5).map(([m, d, n]) => `${MONTHS[m]} ${d + 1} (${n})`).join(', ')}</p>`;
    const sv = stage.querySelector('svg');
    sv.addEventListener('mousemove', e => {
      const r = e.target.closest('.vz-day'); if (!r) return hideTip();
      const cell = grid[r.dataset.m - 1][r.dataset.d - 1];
      showTip(e, `<b>${MONTHS[r.dataset.m - 1]} ${r.dataset.d}</b><small>${cell.length} album${cell.length === 1 ? '' : 's'}${cell.length ? ': ' + cell.slice(0, 4).map(x => esc(x.a.title) + ' (' + esc(x.b.name) + ', ' + x.a.year + ')').join('; ') + (cell.length > 4 ? '…' : '') : ''}</small>`);
    });
    sv.addEventListener('mouseleave', hideTip);
    sv.addEventListener('click', e => { const r = e.target.closest('.vz-day'); if (r) { hideTip(); App.openDay(+r.dataset.m, +r.dataset.d); } });
  });
}

// ============ 8. Genre matrix (who influences whom, across genres) ============
function renderMatrix() {
  const n = GENRES.length, idx = Object.fromEntries(GENRES.map((g, i) => [g.id, i]));
  const m = Array.from({ length: n }, () => Array.from({ length: n }, () => []));
  for (const b of BANDS) for (const p of b.from) { const pb = bandById[p]; if (pb) m[idx[pb.genre]][idx[b.genre]].push([pb, b]); }
  stage.innerHTML = head('Genre matrix', 'Rows are the genre that influenced, columns the genre that was influenced. Each square counts the influence lines between two genres. The diagonal is genres feeding themselves, so you can hide it to see how genres borrow from each other.') +
    `<div class="vz-controls"><label class="inl"><input type="checkbox" id="mxDiag"> show the diagonal (same genre)</label><span id="mxNote" class="muted"></span></div><div class="vz-cols"><div class="vz-scroll" id="mxWrap"></div><div class="vz-side" id="mxSide"><p class="muted">Click a square to list the influence lines.</p></div></div>`;
  let diag = false, picked = null;
  function draw() {
    const { w } = sizeOf(), cs = clamp(Math.floor((w - 520) / n), 22, 30), L = 150, T = 150;
    const max = Math.max(...m.flatMap((row, i) => row.map((c, j) => (!diag && i === j ? 0 : c.length))));
    let svg = `<svg viewBox="0 0 ${L + n * cs + 70} ${T + n * cs + 6}" width="${L + n * cs + 70}" height="${T + n * cs + 6}" role="img" aria-label="Influence lines between genres">`;
    GENRES.forEach((g, i) => {
      svg += `<text class="vz-axis" x="${L - 8}" y="${T + i * cs + cs / 2 + 4}" text-anchor="end" fill="${col(g)}">${esc(g.name.length > 22 ? g.name.slice(0, 21) + '…' : g.name)}</text>`;
      svg += `<text class="vz-axis" transform="translate(${L + i * cs + cs / 2 + 4} ${T - 8}) rotate(-60)" fill="${col(g)}">${esc(g.name.length > 22 ? g.name.slice(0, 21) + '…' : g.name)}</text>`;
    });
    m.forEach((row, i) => row.forEach((c, j) => {
      const skip = !diag && i === j, k = c.length;
      svg += `<rect class="vz-cell${picked && picked[0] === i && picked[1] === j ? ' sel' : ''}" data-i="${i}" data-j="${j}" x="${L + j * cs + 1}" y="${T + i * cs + 1}" width="${cs - 2}" height="${cs - 2}" rx="3" fill="${k && !skip ? 'var(--accent)' : 'var(--text)'}" fill-opacity="${k && !skip ? (0.12 + 0.88 * Math.sqrt(k / max)).toFixed(2) : 0.05}"/>`;
    }));
    $('mxWrap').innerHTML = svg + '</svg>';
    const top = m.flatMap((row, i) => row.map((c, j) => [i, j, c.length])).filter(([i, j]) => i !== j).sort((a, b) => b[2] - a[2]).slice(0, 3);
    $('mxNote').textContent = 'Strongest cross-genre flows: ' + top.map(([i, j, k]) => `${GENRES[i].name} → ${GENRES[j].name} (${k})`).join(' · ');
  }
  draw();
  $('mxDiag').addEventListener('change', e => { diag = e.target.checked; draw(); });
  const wrap = $('mxWrap');
  wrap.addEventListener('mousemove', e => { const r = e.target.closest('.vz-cell'); if (!r) return hideTip(); const i = +r.dataset.i, j = +r.dataset.j; showTip(e, `<b>${esc(GENRES[i].name)} → ${esc(GENRES[j].name)}</b><small>${m[i][j].length} influence lines</small>`); });
  wrap.addEventListener('mouseleave', hideTip);
  wrap.addEventListener('click', e => {
    const r = e.target.closest('.vz-cell'); if (!r) return;
    const i = +r.dataset.i, j = +r.dataset.j; picked = [i, j]; draw();
    const pairs = m[i][j];
    $('mxSide').innerHTML = `<div class="vz-listhead">${esc(GENRES[i].name)} → ${esc(GENRES[j].name)} · ${pairs.length}</div>` + (pairs.length ? '<ul class="vz-pairs">' + pairs.slice(0, 60).map(([p, b]) => `<li>${actLink(p)} <span class="vz-arrow">→</span> ${actLink(b)}</li>`).join('') + '</ul>' : '<p class="muted">None.</p>');
  });
}

// ============ 9. Listening neighbourhoods ("listeners also like") ============
function renderSimilar() {
  const sim = window.ATLAS_VIZ.similar, ids = Object.keys(sim);
  if (!ids.length) { stage.innerHTML = head('Listening neighbourhoods', 'No similarity data has been built in yet. Run <code>node tools/fetch-similar.js</code> and then <code>node tools/build-data.js</code>.'); return; }
  stage.innerHTML = head('Listening neighbourhoods', 'Acts that the same people listen to in the same sessions sit close together (data from ListenBrainz). This is about listening habits, not how the music sounds, and it ignores the genre lanes: look for genres that mix and for acts that sit far from their own genre. Click an act to see its closest neighbours.') +
    `<div class="vz-cols"><div class="vz-stage" id="simStage"><canvas id="simCv"></canvas></div><div class="vz-side" id="simSide"><p class="muted">Click an act. Closest neighbours are listed here.</p></div></div>`;
  const cv = $('simCv'), box = cv.parentElement, c = cv.getContext('2d');
  const edges = new Map();
  for (const [a, list] of Object.entries(sim)) list.slice(0, 6).forEach(([b, s]) => { const k = a < b ? a + '|' + b : b + '|' + a, rel = s / list[0][1]; edges.set(k, Math.max(edges.get(k) || 0, rel)); });
  const maxS = 1;
  const used = new Set(); edges.forEach((_, k) => k.split('|').forEach(x => used.add(x)));
  const nodes = [...used].filter(id => bandById[id]).map(id => { const p = A.pos[id] || [0, 0]; return { id, b: bandById[id], x: p[0] * .9 + (Math.random() - .5) * 20, y: p[1] * .9 + (Math.random() - .5) * 20, vx: 0, vy: 0, deg: 0 }; });
  const by = new Map(nodes.map(n => [n.id, n]));
  const es = [...edges].map(([k, s]) => { const [a, b] = k.split('|'); return { a: by.get(a), b: by.get(b), w: s / maxS }; }).filter(e => e.a && e.b);
  es.forEach(e => { e.a.deg++; e.b.deg++; });
  // relax: similar acts attract in proportion to their score, everything repels a little. Starts from the genre map.
  let alpha = 1, ticks = 0, raf = 0, view = { x: 0, y: 0, k: 1 }, hover = null, selId = null, nbSet = null;
  function step() {
    const cells = new Map();
    for (const n of nodes) { const key = Math.floor(n.x / 170) + ',' + Math.floor(n.y / 170); (cells.get(key) || cells.set(key, []).get(key)).push(n); }
    for (const n of nodes) {
      const cx = Math.floor(n.x / 170), cy = Math.floor(n.y / 170);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const m of cells.get((cx + ox) + ',' + (cy + oy)) || []) {
        if (m === n || m.id < n.id) continue;
        let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy; if (d2 > 28900) continue; if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
        const f = (1600 / d2) * alpha * 10, d = Math.sqrt(d2); n.vx += dx / d * f; n.vy += dy / d * f; m.vx -= dx / d * f; m.vy -= dy / d * f;
      }
    }
    for (const e of es) { const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 30) * .05 * (.3 + .7 * e.w) * alpha; e.a.vx += dx / d * f; e.a.vy += dy / d * f; e.b.vx -= dx / d * f; e.b.vy -= dy / d * f; }
    for (const n of nodes) { n.vx -= n.x * .0003 * alpha; n.vy -= n.y * .0003 * alpha; n.vx *= .8; n.vy *= .8; n.x += n.vx; n.y += n.vy; }
    alpha *= .985; ticks++;
  }
  function fit() {
    const xs = nodes.map(n => n.x).sort((p, q) => p - q), ys = nodes.map(n => n.y).sort((p, q) => p - q), lo = Math.floor(xs.length * .02), hi = Math.ceil(xs.length * .98) - 1;
    const W = box.clientWidth, H = Math.max(box.clientHeight, 380), k = Math.min((W - 40) / (xs[hi] - xs[lo] || 1), (H - 40) / (ys[hi] - ys[lo] || 1));
    view = { k, x: W / 2 - (xs[lo] + xs[hi]) / 2 * k, y: H / 2 - (ys[lo] + ys[hi]) / 2 * k };
  }
  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = box.clientWidth, H = Math.max(box.clientHeight, 380);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const X = n => n.x * view.k + view.x, Y = n => n.y * view.k + view.y, focus = selId || (hover && hover.id), near = focus && nbSet;
    c.lineWidth = 1;
    for (const e of es) {
      const hit = focus && (e.a.id === focus || e.b.id === focus);
      c.globalAlpha = focus ? (hit ? .9 : .02) : .07; c.strokeStyle = hit ? '#fff' : col(genreById[e.a.b.genre], 60); c.lineWidth = hit ? 1.5 : 1;
      c.beginPath(); c.moveTo(X(e.a), Y(e.a)); c.lineTo(X(e.b), Y(e.b)); c.stroke();
    }
    for (const n of nodes) {
      const lit = !focus || n.id === focus || (near && near.has(n.id));
      c.globalAlpha = lit ? 1 : .15; c.fillStyle = col(genreById[n.b.genre], 58); c.beginPath(); c.arc(X(n), Y(n), 2.5 + Math.sqrt(n.deg) * .7, 0, 6.283); c.fill();
      n.sx = X(n); n.sy = Y(n);
    }
    c.globalAlpha = 1; c.font = '600 12px Barlow Condensed, sans-serif'; c.textBaseline = 'middle';
    const cs = getComputedStyle(root), tx = cs.getPropertyValue('--text').trim() || '#eee', bg = cs.getPropertyValue('--bg').trim() || '#000';
    const labelled = focus ? nodes.filter(n => n.id === focus || (near && near.has(n.id))) : [...nodes].sort((p, q) => q.deg - p.deg).slice(0, view.k > 1.4 ? 70 : 30);
    const placed = [];
    for (const n of labelled) { const wd = c.measureText(n.b.name).width, x0 = n.sx + 8; if (placed.some(p => x0 < p[2] && x0 + wd > p[0] && n.sy - 6 < p[3] && n.sy + 6 > p[1])) continue; placed.push([x0, n.sy - 6, x0 + wd, n.sy + 6]); c.lineWidth = 3; c.strokeStyle = bg; c.strokeText(n.b.name, x0, n.sy); c.fillStyle = tx; c.fillText(n.b.name, x0, n.sy); }
  }
  function loop() { raf = 0; for (let i = 0; i < 6 && alpha > .01; i++) step(); if (ticks % 20 === 0 || alpha <= .01) fit(); draw(); if (alpha > .01) raf = requestAnimationFrame(loop); }
  raf = requestAnimationFrame(loop);
  const at = e => { const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.sx - mx, n.sy - my); if (d < 9 && d < bd) { best = n; bd = d; } } return best; };
  cv.addEventListener('mousemove', e => { const n = at(e), h = n ? n.b : null; if (h !== hover) { hover = h; if (hover && !selId) nbSet = new Set((sim[hover.id] || []).map(x => x[0])); draw(); } cv.style.cursor = h ? 'pointer' : 'default'; if (h) showTip(e, `<b>${esc(h.name)}</b><small>${esc(genreById[h.genre].name)} · ${years(h)}</small>`); else hideTip(); });
  cv.addEventListener('mouseleave', () => { hover = null; hideTip(); draw(); });
  cv.addEventListener('click', e => {
    const n = at(e); selId = n ? n.id : null; nbSet = n ? new Set((sim[n.id] || []).map(x => x[0])) : null; draw();
    const side = $('simSide');
    if (!n) { side.innerHTML = '<p class="muted">Click an act. Closest neighbours are listed here.</p>'; return; }
    const list = (sim[n.id] || []).filter(x => bandById[x[0]]);
    side.innerHTML = `<div class="vz-listhead">Listeners of <b>${esc(n.b.name)}</b> also play</div><ol class="vz-rank">${list.map(([id, s]) => `<li>${actLink(bandById[id])}<b title="relative closeness">${Math.round(s / (list[0][1] || 1) * 100)}</b></li>`).join('')}</ol><button class="vz-act" data-act="${n.id}" style="--c:${col(genreById[n.b.genre])}">Open ${esc(n.b.name)}</button>`;
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, nk = clamp(view.k * Math.exp(-e.deltaY * .0015), .2, 12), s = nk / view.k; view.x = px - (px - view.x) * s; view.y = py - (py - view.y) * s; view.k = nk; draw(); }, { passive: false });
  let pan = null;
  cv.addEventListener('pointerdown', e => { if (!at(e)) { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; cv.setPointerCapture(e.pointerId); } });
  cv.addEventListener('pointermove', e => { if (pan) { view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y; draw(); } });
  cv.addEventListener('pointerup', () => { pan = null; });
  cleanup = () => cancelAnimationFrame(raf);
  stage._redraw = () => { fit(); draw(); };
}

// ---------- the view switcher ----------
const VIEWS = [
  ['map', 'Scene map', renderMap], ['flow', 'Lineup flow', renderFlow], ['era', 'Era fingerprint', renderFingerprint], ['stars', 'Album constellation', renderStars],
  ['tree', 'Influence tree', renderTree], ['game', 'Six degrees', renderGame], ['calendar', 'Calendar', renderCalendar], ['matrix', 'Genre matrix', renderMatrix], ['listen', 'Neighbourhoods', renderSimilar],
];
bar.innerHTML = VIEWS.map(([id, label]) => `<button data-view="${id}" role="tab">${label}</button>`).join('') + '<button id="vizClose" class="vz-close" aria-label="Back to the timeline" title="Back to the timeline (Esc)">✕ Timeline</button>';
bar.addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); if (e.target.closest('#vizClose')) App.closeViz(); });
function show(id) {
  if (!VIEWS.some(v => v[0] === id)) id = 'map';
  if (cleanup) { cleanup(); cleanup = null; }
  stage._redraw = null; hideTip();
  current = id;
  bar.querySelectorAll('[data-view]').forEach(b => { const on = b.dataset.view === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  stage.scrollTop = 0;
  VIEWS.find(v => v[0] === id)[2]();
  try { history.replaceState(null, '', '#viz=' + id); } catch (e) {}
}
window.addEventListener('resize', () => { if (!root.hidden && current && !['game', 'stars', 'listen'].includes(current)) show(current); else if (!root.hidden && stage._redraw) stage._redraw(); });
window.AtlasViz = { show, get current() { return current; }, views: VIEWS.map(v => v[0]) };
})();
