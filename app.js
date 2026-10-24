(() => {
'use strict';

const NOW = 2026, T0 = 1930;
const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
const PX_YEAR = 48, ROW_H = 40, BAR_H = 18, LANE_PAD = 14, ERA_H = COARSE ? 30 : 20, AXIS_H = ERA_H + 30;
const K_MIN = 0.03, K_MAX = 12;

const GROUP_GAP = 14;
const FB = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const FH = "'Cinzel', Georgia, serif";
const BONE = '#e8e2d4', ASH = '#8a817a', BLOOD = '#c1121f', LIVE_COL = '#f2b134';

// decades along the top of the ruler (click one to filter to it)
const ERAS = [
  [1930, 'Delta Blues'], [1940, 'Electric Blues'], [1950, "Rock 'n' Roll"], [1960, 'Invasion & Psychedelia'],
  [1970, 'Hard Rock, Prog & Punk'], [1980, 'Metal & New Wave'], [1990, 'Grunge, Extreme & Nu'],
  [2000, 'Metalcore & Revival'], [2010, 'Post-Everything'], [2020, 'Now'],
].map(([from, tag]) => ({ from, to: from + 9, label: from + 's', tag }));
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const $ = id => document.getElementById(id);
const canvas = $('c'), ctx = canvas.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');
const brush = $('brush'), bctx = brush.getContext('2d');
const genreById = Object.fromEntries(GENRES.map(g => [g.id, g]));

// ---------- merge data sources: curated (data.js) + added (data.extra.js) + MusicBrainz (data.mb.js) ----------
(window.EXTRA || []).forEach(b => { b.sub ||= 'Other'; b.from ||= []; BANDS.push(b); });
const bandById = Object.fromEntries(BANDS.map(b => [b.id, b]));
BANDS.forEach(b => {
  const mb = (window.MB || {})[b.id];
  b.members = [];
  if (mb && mb.confidence === 'high') {
    b.members = mb.members;        // MusicBrainz albums are deliberately ignored: only curated original releases are shown
    b.mbid = mb.mbid;
  }
});
const children = {};
BANDS.forEach(b => b.from = b.from.filter(id => bandById[id]));
BANDS.forEach(b => b.from.forEach(p => (children[p] ||= []).push(b.id)));

// shared members: pair -> set of names (curated first, then MusicBrainz), capped to keep labels readable
const sharedPairs = new Map();
for (const [a, b, who] of [...(window.LINKS || []), ...(window.MB_LINKS || [])]) {
  if (!bandById[a] || !bandById[b] || a === b) continue;
  const key = a < b ? a + '|' + b : b + '|' + a;
  const e = sharedPairs.get(key) || { a, b, who: [] };
  if (!e.who.includes(who) && e.who.length < 3) e.who.push(who);
  sharedPairs.set(key, e);
}
const sharedList = [...sharedPairs.values()];
const sharedOf = {};
sharedList.forEach(e => {
  (sharedOf[e.a] ||= []).push({ id: e.b, who: e.who.join(', ') });
  (sharedOf[e.b] ||= []).push({ id: e.a, who: e.who.join(', ') });
});

// people -> bands, from MusicBrainz lineups, curated shared-member notes and solo artists
const peopleMap = new Map();
const addPerson = (name, id) => {
  name = name.trim();
  if (name.length < 3) return;
  const k = name.toLowerCase();
  if (!peopleMap.has(k)) peopleMap.set(k, { name, bands: new Set() });
  peopleMap.get(k).bands.add(id);
};
const cleanNames = who => who.replace(/\([^)]*\)/g, '').split(/,/).map(t => t.trim()).filter(Boolean);
BANDS.forEach(b => {
  b.members.forEach(m => addPerson(m.name, b.id));
  if (b.kind === 'artist') addPerson(b.name, b.id);
});
for (const [a, b, who] of [...(window.LINKS || []), ...(window.MB_LINKS || [])])
  if (bandById[a] && bandById[b]) cleanNames(who).forEach(n => { addPerson(n, a); addPerson(n, b); });
BANDS.forEach(b => b.peopleLC = []);
peopleMap.forEach((p, k) => p.bands.forEach(id => bandById[id].peopleLC.push(k)));

// Releases. "Key" releases are the curated originals in data.js. "All" adds MusicBrainz studio albums, and optionally live
// albums, from data.albums.js, which is only downloaded when the user switches the mode.
BANDS.forEach(b => b.albums.forEach(a => { a.key = true; }));
const keyNorm = t => t.toLowerCase().replace(/[\u2018\u2019'`\u00b4]/g, '').replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
let allLoaded = false;
function buildAll() {
  for (const b of BANDS) {
    const raw = (window.ALBUMS || {})[b.id];
    if (!raw) { b.all = b.albums; continue; }
    const keys = new Set(b.albums.map(a => keyNorm(a.title)));
    b.all = raw.split(';').map(x => {
      const p = x.split('|');
      return { year: +p[0], title: p[1], live: p[2] === 'L', key: keys.has(keyNorm(p[1])) };
    });
    b.albums.forEach(a => { if (!b.all.some(x => keyNorm(x.title) === keyNorm(a.title))) b.all.push(a); });
    b.all.sort((x, y) => x.year - y.year);
  }
}
function loadAlbums(cb) {
  if (allLoaded) return cb(true);
  const done = ok => { if (ok) { buildAll(); allLoaded = true; } cb(ok); };
  if (window.ALBUMS) return done(true);
  const el = document.createElement('script');
  el.src = 'data.albums.js';
  el.onload = () => done(true);
  el.onerror = () => done(false);
  document.head.appendChild(el);
}
function rels(b) {
  if (filters.releases !== 'all' || !b.all) return b.albums;
  return filters.live ? b.all : b.all.filter(a => a.key || !a.live);
}

const col = (g, l = 60, a = 1) => `hsla(${g.hue},${g.sat}%,${l}%,${a})`;

// ---------- state ----------
const filters = { q: '', genres: new Set(GENRES.map(g => g.id)), from: T0, to: NOW, country: '',
                  albums: true, fade: true, rel: 'selected', shared: 'selected', split: true,
                  kinds: new Set(['band', 'artist']), scope: 'all', eras: new Set(), yearOnly: false,
                  releases: 'key', live: false,
                  focus: null,      // { label, ids:Set } show only a lineage / shared-member group
                  subOff: new Set() };   // 'genre|subgenre' keys switched off in the genre list
const view = { x: 0, y: 0, kx: 1, ky: 1 };
let world = { x0: 0, y0: 0, x1: 100, y1: 100 };
let selYear = null;
let histo = [], relHisto = [], histoMax = 1, relMax = 1;
let lanes = [], visible = [], selected = null, hovered = null, hoverAlbum = null, dirty = true;
let W = 0, H = 0, dpr = 1;

// ---------- layout ----------
function matches(b) {
  if (!filters.genres.has(b.genre) || !filters.kinds.has(b.kind)) return false;
  if (filters.focus && !filters.focus.ids.has(b.id)) return false;
  if (filters.subOff.size && filters.subOff.has(b.genre + '|' + b.sub)) return false;
  if (filters.country && !b.country.split('/').includes(filters.country)) return false;
  const end = b.ended ?? NOW;
  if (end < filters.from || b.formed > filters.to) return false;
  if (filters.eras.size && ![...filters.eras].some(i => end >= ERAS[i].from && b.formed <= ERAS[i].to)) return false;
  if (filters.yearOnly && selYear != null && !rels(b).some(a => a.year === selYear)) return false;
  const q = filters.q.trim().toLowerCase();
  if (q) {
    const inName = b.name.toLowerCase().includes(q);
    const inAlbum = rels(b).some(a => a.title.toLowerCase().includes(q));
    const inMember = b.peopleLC.some(n => n.includes(q));
    const ok = filters.scope === 'name' ? inName : filters.scope === 'album' ? inAlbum
             : filters.scope === 'member' ? inMember : (inName || inAlbum || inMember);
    if (!ok) return false;
  }
  return true;
}

function layout() {
  ctx.font = `600 14px ${FB}`;
  visible = BANDS.filter(matches);
  lanes = [];
  let y = 0;
  for (const g of GENRES) {
    const bands = visible.filter(b => b.genre === g.id).sort((a, b) => a.formed - b.formed);
    if (!bands.length) continue;
    const order = [...(SUB_ORDER[g.id] || [])];
    bands.forEach(b => { if (!order.includes(b.sub)) order.push(b.sub); });
    const groups = filters.split
      ? order.map(name => ({ name, bands: bands.filter(b => b.sub === name) })).filter(s => s.bands.length)
      : [{ name: null, bands }];
    let gy = y + LANE_PAD;
    for (const grp of groups) {
      const rowEnd = [];
      for (const b of grp.bands) {
        b.x0 = (b.formed - T0) * PX_YEAR;
        b.x1 = ((b.ended ?? NOW) - T0 + (b.ended ? 0.4 : 0.6)) * PX_YEAR;
        b.tw = ctx.measureText(b.name).width;
        const reserve = Math.max(b.x1, b.x0 + b.tw + 14) + 10;
        let r = rowEnd.findIndex(e => e <= b.x0);
        if (r < 0) r = rowEnd.length;
        rowEnd[r] = reserve;
        b.y = gy + r * ROW_H;
      }
      grp.y = gy; grp.h = rowEnd.length * ROW_H;
      gy += grp.h + (filters.split ? GROUP_GAP : 0);
    }
    const lane = { g, y, h: gy - y + LANE_PAD - (filters.split ? GROUP_GAP : 0), bands, groups };
    lanes.push(lane);
    y += lane.h;
  }
  world = bounds();
  histo = new Array(NOW - T0 + 1).fill(0); relHisto = new Array(NOW - T0 + 1).fill(0);
  for (const b of visible) {
    for (let y = Math.max(b.formed, T0); y <= Math.min(b.ended ?? NOW, NOW); y++) histo[y - T0]++;
    for (const a of rels(b)) if (a.year >= T0 && a.year <= NOW) relHisto[a.year - T0]++;
  }
  histoMax = Math.max(1, ...histo); relMax = Math.max(1, ...relHisto);
  if (selected && !visible.includes(selected)) selected = null;
  renderDetail();
  renderYear();
  renderFilterBar();
  $('count').textContent = `${visible.length} of ${BANDS.length} bands & artists`;
  dirty = true;
}

function bounds() {
  if (!visible.length) return { x0: 0, y0: 0, x1: 100, y1: 100 };
  return {
    x0: Math.min(...visible.map(b => b.x0)) - 60,
    x1: Math.max(...visible.map(b => Math.max(b.x1, b.x0 + b.tw + 20))) + 60,
    y0: 0, y1: lanes[lanes.length - 1].y + lanes[lanes.length - 1].h,
  };
}

// ---------- view ----------
const sx = wx => wx * view.kx + view.x;
const sy = wy => wy * view.ky + view.y;
const wxOf = px => (px - view.x) / view.kx;
const wyOf = py => (py - view.y) / view.ky;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function fit(animate = true) {
  const b = world, pad = 30;
  const left = W > 700 && !$('panel').classList.contains('closed') ? 300 : 0;
  const kx = clamp((W - left - pad * 2) / (b.x1 - b.x0), K_MIN, K_MAX);
  let ky = clamp((H - AXIS_H - pad * 2) / (b.y1 - b.y0), K_MIN, Math.min(Math.max(kx, 1), 2.5));
  goTo({ kx, ky,
         x: left + pad - b.x0 * kx,
         y: AXIS_H + pad + (H - AXIS_H - pad * 2 - (b.y1 - b.y0) * ky) / 2 - b.y0 * ky }, animate);
}

let anim = null;
function goTo(t, animate = true) {
  if (!animate) { Object.assign(view, t); dirty = true; return; }
  const from = { ...view }, start = performance.now(), dur = 450;
  anim = () => {
    const p = clamp((performance.now() - start) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
    for (const k of ['x', 'y', 'kx', 'ky']) view[k] = from[k] + (t[k] - from[k]) * e;
    dirty = true;
    if (p >= 1) anim = null;
  };
}

function focusBand(b, year) {
  const k = Math.max(view.kx, 1.4);
  const cx = year != null ? (year + .5 - T0) * PX_YEAR : b.x0 + (b.x1 - b.x0) / 2, cy = b.y + BAR_H / 2;
  const left = W > 700 ? 280 : 0, right = W > 700 && selected ? 320 : 0;
  goTo({ kx: k, ky: k, x: left + (W - left - right) / 2 - cx * k, y: AXIS_H + (H - AXIS_H) / 2 - cy * k });
}

function zoomAt(px, py, f, onlyX = false) {
  let fx = f, fy = onlyX ? 1 : f;
  // zooming in from the stretched overview: grow height faster than width until the aspect is square again
  if (!onlyX && f > 1 && view.kx > view.ky * 1.1) {
    fx = Math.pow(f, 0.5);
    fy = Math.min(Math.pow(f, 1.5), (view.kx * fx) / view.ky);
  }
  const nkx = clamp(view.kx * fx, K_MIN, K_MAX);
  const nky = onlyX ? view.ky : clamp(view.ky * fy, K_MIN, K_MAX);
  view.x = px - (px - view.x) * (nkx / view.kx);
  view.y = py - (py - view.y) * (nky / view.ky);
  view.kx = nkx; view.ky = nky;
  anim = null; dirty = true;
}

// ---------- drawing ----------
function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  mini.width = MW * dpr; mini.height = MH * dpr;
  dirty = true;
}

function related(b) {
  const s = new Set([b.id]);
  b.from.forEach(id => s.add(id));
  (children[b.id] || []).forEach(id => s.add(id));
  if (filters.shared !== 'off') (sharedOf[b.id] || []).forEach(o => s.add(o.id));
  return s;
}

function axisStep() {
  const ppy = PX_YEAR * view.kx;
  return [1, 2, 5, 10, 20, 50].find(s => s * ppy >= 64) || 50;
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#070607';
  ctx.fillRect(0, 0, W, H);

  const focus = hovered || selected;
  const rel = focus ? related(focus) : null;
  const visibleSet = new Set(visible), sharedLabels = [];
  const ppy = PX_YEAR * view.kx, step = axisStep();

  // lanes
  lanes.forEach((l, i) => {
    const y0 = sy(l.y), y1 = sy(l.y + l.h);
    if (y1 < AXIS_H || y0 > H) return;
    ctx.fillStyle = i % 2 ? '#0d0a0a' : '#080707';
    ctx.fillRect(0, y0, W, y1 - y0);
    const lg = ctx.createLinearGradient(0, 0, 220, 0);
    lg.addColorStop(0, col(l.g, 40, .16)); lg.addColorStop(1, col(l.g, 40, 0));
    ctx.fillStyle = lg; ctx.fillRect(0, y0, 220, y1 - y0);
    ctx.fillStyle = col(l.g, 50, .9);
    ctx.fillRect(0, y0, 4, y1 - y0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, y1 - 1, W, 1);
    if (filters.split && l.groups.length > 1) {
      ctx.strokeStyle = '#3a2224'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      l.groups.slice(1).forEach(grp => {
        const y = Math.round(sy(grp.y - GROUP_GAP / 2)) + .5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      });
      ctx.setLineDash([]);
    }
  });

  // decade shading and the selected-year column
  ERAS.forEach((e, i) => {
    const x0 = sx((e.from - T0) * PX_YEAR), x1 = sx((e.to + 1 - T0) * PX_YEAR);
    if (x1 < 0 || x0 > W) return;
    ctx.fillStyle = filters.eras.has(i) ? 'rgba(193,18,31,.10)' : i % 2 ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,0)';
    ctx.fillRect(x0, AXIS_H, x1 - x0, H - AXIS_H);
  });
  if (selYear != null) {
    const x0 = sx((selYear - T0) * PX_YEAR), x1 = sx((selYear + 1 - T0) * PX_YEAR);
    ctx.fillStyle = 'rgba(193,18,31,.16)'; ctx.fillRect(x0, AXIS_H, x1 - x0, H - AXIS_H);
    ctx.fillStyle = 'rgba(193,18,31,.85)';
    ctx.fillRect(x0, AXIS_H, 1, H - AXIS_H); ctx.fillRect(x1 - 1, AXIS_H, 1, H - AXIS_H);
  }

  // grid
  const yFrom = Math.floor(wxOf(0) / PX_YEAR + T0) - 1, yTo = Math.ceil(wxOf(W) / PX_YEAR + T0) + 1;
  ctx.lineWidth = 1;
  for (let yr = Math.ceil(yFrom / step) * step; yr <= yTo; yr += step) {
    const x = Math.round(sx((yr - T0) * PX_YEAR)) + .5;
    ctx.strokeStyle = yr % 10 === 0 ? '#2a1a1c' : '#161011';
    ctx.beginPath(); ctx.moveTo(x, AXIS_H); ctx.lineTo(x, H); ctx.stroke();
  }

  // connections
  if (filters.rel !== 'off') {
    const all = filters.rel === 'all';
    ctx.lineWidth = 1.4;
    for (const b of visible) {
      for (const pid of b.from) {
        const p = bandById[pid];
        if (!visibleSet.has(p)) continue;
        const touches = focus && (b === focus || p === focus);
        if (!all && !touches) continue;
        const px = clamp(b.x0, p.x0, p.x1 - 6);
        const ax = sx(px), ay = sy(p.y + BAR_H / 2), bx = sx(b.x0), by = sy(b.y + BAR_H / 2);
        if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > W) continue;
        const dim = focus && !touches;
        const gr = ctx.createLinearGradient(ax, ay, bx, by);
        gr.addColorStop(0, col(genreById[p.genre], 65, dim ? .08 : touches ? .95 : .35));
        gr.addColorStop(1, col(genreById[b.genre], 65, dim ? .08 : touches ? .95 : .35));
        ctx.strokeStyle = gr;
        ctx.lineWidth = touches ? 2.2 : 1.1;
        const dx = Math.max(30, Math.abs(bx - ax) * 0.5);
        ctx.beginPath(); ctx.moveTo(ax, ay);
        ctx.bezierCurveTo(ax + dx, ay, bx - dx, by, bx, by);
        ctx.stroke();
        if (touches) { ctx.fillStyle = col(genreById[b.genre], 70); ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, 7); ctx.fill(); }
      }
    }
  }

  // shared members / collaborators (dashed gold)
  if (filters.shared !== 'off') {
    const all = filters.shared === 'all';
    ctx.setLineDash([5, 4]);
    for (const e of sharedList) {
      const a = bandById[e.a], b = bandById[e.b];
      if (!visibleSet.has(a) || !visibleSet.has(b)) continue;
      const touches = focus && (a === focus || b === focus);
      if (!all && !touches) continue;
      const mx = Math.max(a.x0, b.x0);
      const ax = sx(clamp(mx, a.x0, a.x1 - 4)), bx = sx(clamp(mx, b.x0, b.x1 - 4));
      const ay = sy(a.y + BAR_H / 2), by = sy(b.y + BAR_H / 2), my = (ay + by) / 2;
      if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > W) continue;
      const dim = focus && !touches;
      ctx.strokeStyle = `rgba(255,214,102,${dim ? .08 : touches ? .95 : .4})`;
      ctx.lineWidth = touches ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.bezierCurveTo(ax, my, bx, my, bx, by); ctx.stroke();
      if (touches) sharedLabels.push({ x: (ax + bx) / 2, y: my, t: e.who.join(', ') });
    }
    ctx.setLineDash([]);
  }

  // bands
  const fs = clamp(14 * view.ky, 0, 22);
  const bh = BAR_H * view.ky;
  ctx.textBaseline = 'middle';
  const albumLabels = [];
  for (const b of visible) {
    const x0 = sx(b.x0), x1 = sx(b.x1), y0 = sy(b.y);
    if (x1 < -200 || x0 > W || y0 + bh < AXIS_H || y0 > H) continue;
    const g = genreById[b.genre];
    const dim = rel && !rel.has(b.id);
    const isSel = b === selected, isHov = b === hovered;
    ctx.globalAlpha = dim ? .22 : 1;

    const w = Math.max(x1 - x0, 3);
    const solo = b.kind === 'artist';
    const rad = solo ? bh / 2 : Math.min(2.5 * view.ky, bh / 2);
    const small = bh < 6;                                  // overview: bars are a few pixels tall, draw them flat and cheap
    if (small) {
      ctx.fillStyle = isSel || isHov ? BONE : flatColor(g);
      ctx.fillRect(x0, y0, w, Math.max(1.4, bh * .75));        // leave a hairline gap between rows
    }
    else {
    if (isSel || isHov) { ctx.shadowColor = col(g, 60); ctx.shadowBlur = 16; }
    ctx.save(); ctx.translate(0, y0);                      // cached gradient is defined at y = 0
    ctx.fillStyle = steelGradient(g, bh);
    roundRect(x0, 0, w, bh, rad); ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
    if (filters.fade && b.ended == null) {
      const gr = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      gr.addColorStop(0, 'rgba(7,6,7,0)'); gr.addColorStop(.35, 'rgba(7,6,7,0)'); gr.addColorStop(1, 'rgba(7,6,7,.75)');
      ctx.fillStyle = gr; roundRect(x0, y0, w, bh, rad); ctx.fill();
    }
    ctx.strokeStyle = isSel ? BONE : isHov ? '#fff' : col(g, 62, .85);
    ctx.lineWidth = isSel ? 2 : 1;
    roundRect(x0 + .5, y0 + .5, w - 1, bh - 1, rad); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x0 + (solo ? bh / 2 : 2), y0 + 1, Math.max(0, w - (solo ? bh : 4)), 1);
    if (solo) { ctx.fillStyle = BONE; ctx.beginPath(); ctx.arc(x0 + bh / 2, y0 + bh / 2, Math.max(1.5, bh * .16), 0, 7); ctx.fill(); }
    }

    if (fs >= 6) {
      ctx.font = `600 ${fs}px ${FB}`;
      const tw = b.tw * fs / 14;
      const inside = w > tw + 12 + (solo ? bh * .8 : 0);
      ctx.shadowColor = '#000'; ctx.shadowBlur = inside ? 3 : 0;
      ctx.fillStyle = inside ? '#f4efe4' : BONE;
      ctx.fillText(b.name, inside ? x0 + (solo ? bh * .85 : 7) : x0 + w + 6, y0 + bh / 2 + .5);
      ctx.shadowBlur = 0;
    }

    const shown = filters.albums ? rels(b) : [];
    if (shown.length) {
      const r = Math.max(2.5, 4.5 * Math.min(view.kx, view.ky) ** .5);
      for (const a of shown) {
        if (a.year < b.formed) continue;
        const ax = sx((a.year + .5 - T0) * PX_YEAR), ay = y0 + bh;      // markers sit on the bar's bottom edge, clear of the name
        if (ax < -10 || ax > W + 10) continue;
        const isHA = hoverAlbum && hoverAlbum.a === a;
        const isYr = selYear != null && a.year === selYear;
        if (small && !isYr && !isHA) {                       // overview: a 2px dot per release, no paths or strokes
          ctx.fillStyle = a.live ? LIVE_COL : a.key ? BONE : 'rgba(232,226,212,.45)';
          ctx.fillRect(ax - 1, ay - 1, 2, 2);
          continue;
        }
        if (isYr) { ctx.shadowColor = BLOOD; ctx.shadowBlur = 14; }
        const rr = (a.key ? r : r * .72) * (isHA ? 1.4 : isYr ? 1.5 : 1);     // key releases are bigger than the rest
        // colour = type: key release solid bone, other studio album hollow, live album amber
        ctx.fillStyle = isHA || isYr ? BLOOD : a.live ? LIVE_COL : a.key ? BONE : '#0a0707';
        ctx.strokeStyle = isHA || isYr ? '#fff' : a.live ? 'rgba(20,10,0,.75)' : a.key ? '#0a0707' : 'rgba(232,226,212,.6)';
        ctx.lineWidth = a.key || a.live ? 1.2 : 1;
        if (a.live) { ctx.beginPath(); ctx.arc(ax, ay, rr, 0, 7); } else diamond(ax, ay, rr);   // live albums are round
        ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        if ((a.key ? ppy > 90 && view.ky > .9 : ppy > 150 && view.ky > 1.1) || isYr)
          albumLabels.push({ x: ax, y: y0 + bh + r + 3, t: a.title, key: a.key, c: isYr ? '#fff' : a.key ? col(g, 75) : 'rgba(184,174,164,.8)' });
      }
    }
    ctx.globalAlpha = 1;
  }

  // album titles: key releases are placed first, the rest only where there is room
  if (albumLabels.length) {
    const f2 = clamp(9.5 * view.ky, 8, 13);
    ctx.font = `${f2}px ${FB}`;
    ctx.textBaseline = 'top';
    const rows = {};
    const place = l => {
      const w = ctx.measureText(l.t).width, k = Math.round(l.y), x0 = l.x - 3, x1 = x0 + w + 5;
      const row = rows[k] || (rows[k] = []);
      if (row.some(r => x0 < r[1] && x1 > r[0])) return;
      row.push([x0, x1]);
      ctx.fillStyle = l.c;
      ctx.fillText(l.t, x0, l.y);
    };
    albumLabels.filter(l => l.key).forEach(place);
    albumLabels.filter(l => !l.key).forEach(place);
  }

  // shared-member captions
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = `11px ${FB}`;
  for (const l of sharedLabels) {
    const w = ctx.measureText(l.t).width;
    ctx.fillStyle = 'rgba(13,14,18,.9)'; roundRect(l.x - w / 2 - 6, l.y - 9, w + 12, 18, 9); ctx.fill();
    ctx.fillStyle = '#ffd666'; ctx.fillText(l.t, l.x, l.y + .5);
  }
  ctx.textAlign = 'left';

  // subgenre captions, right-aligned at the top of each group
  if (filters.split) {
    ctx.textAlign = 'right'; ctx.font = `italic 11px ${FB}`; ctx.fillStyle = '#6e5a58';
    lanes.forEach(l => l.groups.forEach(grp => {
      const y = sy(grp.y);
      if (y < AXIS_H + 6 || y > H || sy(grp.y + grp.h) - y < 20) return;
      ctx.fillText(grp.name, W - 14, y + 7);
    }));
    ctx.textAlign = 'left';
  }

  // sticky lane labels (with the subgenre currently under the label)
  ctx.textBaseline = 'middle';
  lanes.forEach(l => {
    const y0 = sy(l.y), y1 = sy(l.y + l.h);
    if (y1 < AXIS_H + 20 || y0 > H || y1 - y0 < 16) return;
    ctx.font = `700 11px ${FH}`;
    const cy = clamp(y0 + 18, AXIS_H + 16, y1 - 14);
    const lx = W > 700 ? 292 : 12;
    let label = l.g.name.toUpperCase(), subLabel = '';
    if (filters.split && l.groups.length > 1) {
      const wy = wyOf(cy);
      const grp = l.groups.find(s => wy < s.y + s.h + GROUP_GAP / 2) || l.groups[l.groups.length - 1];
      subLabel = '  ›  ' + grp.name;
    }
    const tw = ctx.measureText(label).width;
    ctx.font = `500 11px ${FB}`;
    const sw = subLabel ? ctx.measureText(subLabel).width : 0;
    ctx.fillStyle = 'rgba(7,6,7,.88)';
    roundRect(lx - 6, cy - 10, tw + sw + 12, 20, 10); ctx.fill();
    ctx.font = `700 11px ${FH}`;
    ctx.fillStyle = col(l.g, 65);
    ctx.fillText(label, lx, cy + .5);
    if (subLabel) { ctx.font = `500 11px ${FB}`; ctx.fillStyle = '#b8aea4'; ctx.fillText(subLabel, lx + tw, cy + .5); }
  });

  // ruler: decade row on top, years below
  ctx.fillStyle = '#070607f2';
  ctx.fillRect(0, 0, W, AXIS_H);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ERAS.forEach((e, i) => {
    const x0 = sx((e.from - T0) * PX_YEAR), x1 = sx((e.to + 1 - T0) * PX_YEAR);
    if (x1 < 0 || x0 > W) return;
    const on = filters.eras.has(i);
    ctx.fillStyle = on ? 'rgba(193,18,31,.55)' : i % 2 ? '#14100f' : '#0d0a0a';
    ctx.fillRect(x0, 0, x1 - x0, ERA_H);
    ctx.fillStyle = '#3a1f22'; ctx.fillRect(Math.round(x0), 0, 1, ERA_H);
    const lx = Math.max(x0, 0) + 6;
    ctx.font = `700 11px ${FH}`;
    const lw = ctx.measureText(e.label).width;
    if (x1 - lx > lw + 4) {
      ctx.fillStyle = on ? '#fff' : '#b4343c';
      ctx.fillText(e.label, lx, ERA_H / 2 + .5);
      if (x1 - lx > lw + 110) {
        ctx.font = `italic 12px ${FB}`; ctx.fillStyle = on ? '#f4d6d6' : ASH;
        ctx.fillText(e.tag, lx + lw + 10, ERA_H / 2 + .5);
      }
    }
  });
  ctx.fillStyle = '#2a1517'; ctx.fillRect(0, ERA_H, W, 1);
  ctx.strokeStyle = BLOOD; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, AXIS_H - .5); ctx.lineTo(W, AXIS_H - .5); ctx.stroke();
  const yy = ERA_H + (AXIS_H - ERA_H) / 2 - 1;
  if (selYear != null) {
    const x0 = sx((selYear - T0) * PX_YEAR), x1 = sx((selYear + 1 - T0) * PX_YEAR);
    ctx.fillStyle = 'rgba(193,18,31,.55)'; ctx.fillRect(x0, ERA_H + 1, Math.max(x1 - x0, 3), AXIS_H - ERA_H - 2);
  }
  ctx.font = `600 12px ${FH}`;
  for (let yr = Math.ceil(yFrom / step) * step; yr <= yTo; yr += step) {
    const x = Math.round(sx((yr - T0) * PX_YEAR)) + .5;
    ctx.strokeStyle = '#5a3a3c';
    ctx.beginPath(); ctx.moveTo(x, AXIS_H - 8); ctx.lineTo(x, AXIS_H); ctx.stroke();
    ctx.fillStyle = yr % 10 === 0 ? BONE : ASH;
    ctx.fillText(yr, x + 4, yy);
  }
  if (selYear != null) {
    const x0 = sx((selYear - T0) * PX_YEAR);
    ctx.font = `700 12px ${FH}`; ctx.fillStyle = '#fff';
    ctx.fillText(selYear, Math.max(x0 + 4, 4), yy);
  }
  if (ppy > 14) {
    ctx.strokeStyle = '#3a2628';
    for (let yr = yFrom; yr <= yTo; yr++) {
      if (yr % step === 0) continue;
      const x = Math.round(sx((yr - T0) * PX_YEAR)) + .5;
      ctx.beginPath(); ctx.moveTo(x, AXIS_H - 4); ctx.lineTo(x, AXIS_H); ctx.stroke();
    }
  }
  // "today" line
  const nx = sx((NOW - T0) * PX_YEAR);
  if (nx > 0 && nx < W) { ctx.strokeStyle = '#c1121f99'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(nx, AXIS_H); ctx.lineTo(nx, H); ctx.stroke(); ctx.setLineDash([]); }

  if (!visible.length) {
    ctx.fillStyle = ASH; ctx.textAlign = 'center'; ctx.font = `20px ${FH}`;
    ctx.fillText('No bands match these filters', W / 2, H / 2); ctx.textAlign = 'left';
  }
  drawVignette();
  drawMini();
  drawBrush();
}

// ---------- time brush ----------
// A strip under the map: histogram of acts active per year, with a window showing the years on screen.
// Drag the window to pan, its edges to zoom time, empty space to pick a range, double-click for everything.
const viewLeft = () => (W > 700 && !$('panel').classList.contains('closed')) ? 292 : 0;
const SPAN = NOW + 1 - T0, BP = 10;
let BW = 0, BH = 0;
const bx = yr => BP + (yr - T0) / SPAN * (BW - BP * 2);
const yearAtB = x => T0 + (x - BP) / (BW - BP * 2) * SPAN;
const brushRange = () => ({ yl: wxOf(viewLeft()) / PX_YEAR + T0, yr: wxOf(W) / PX_YEAR + T0 });

// Show the years yl..yr across the visible map area.
//   anchor: which year stays put on screen when the zoom limit stops the range from getting any narrower:
//           'l' left edge, 'r' right edge, 'c' centre.
//   keepY:  leave the vertical scale alone (panning). Otherwise the vertical scale follows the zoom like the mouse wheel
//           does: zooming in from the stretched overview lets bar heights catch up, so names become readable.
function setRange(yl, yr, opt = {}) {
  const left = viewLeft(), width = W - left;
  const kx = clamp(width / (Math.max(yr - yl, 1.5) * PX_YEAR), K_MIN, K_MAX);
  const anchor = opt.anchor || 'l';
  const x = anchor === 'r' ? W - (yr - T0) * PX_YEAR * kx
          : anchor === 'c' ? left + width / 2 - ((yl + yr) / 2 - T0) * PX_YEAR * kx
          : left - (yl - T0) * PX_YEAR * kx;
  let ky = view.ky;
  if (!opt.keepY && Math.abs(kx - view.kx) > 1e-9) {
    const f = kx / view.kx;
    if (f > 1 && kx > ky * 1.1) ky = Math.min(ky * Math.pow(f, 1.5), kx);   // zooming in from a stretched view: heights catch up
    else ky = ky * f;                                                        // otherwise scale uniformly
    ky = clamp(ky, K_MIN, K_MAX);
  }
  if (ky !== view.ky) {                                                      // keep the row at the middle of the screen in place
    const cy = (AXIS_H + H) / 2, wyc = wyOf(cy);
    view.y = cy - wyc * ky;
  }
  view.kx = kx; view.ky = ky; view.x = x;
  anim = null; dirty = true;
}

function drawBrush() {
  const r = brush.getBoundingClientRect();
  if (!r.width) return;
  if (brush.width !== Math.round(r.width * dpr) || brush.height !== Math.round(r.height * dpr)) {
    brush.width = Math.round(r.width * dpr); brush.height = Math.round(r.height * dpr);
  }
  BW = r.width; BH = r.height;
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.clearRect(0, 0, BW, BH);
  const base = BH - 16, top = 16, ch = base - top;
  // activity histogram
  const grad = bctx.createLinearGradient(0, top, 0, base);
  grad.addColorStop(0, 'rgba(193,18,31,.9)'); grad.addColorStop(1, 'rgba(90,10,16,.55)');
  bctx.fillStyle = grad;
  histo.forEach((n, i) => {
    if (!n) return;
    const x0 = bx(T0 + i), x1 = bx(T0 + i + 1), h = n / histoMax * ch;
    bctx.fillRect(x0, base - h, Math.max(1, x1 - x0 - .5), h);
  });
  // releases per year (bone line)
  bctx.strokeStyle = 'rgba(232,226,212,.75)'; bctx.lineWidth = 1; bctx.beginPath();
  relHisto.forEach((n, i) => {
    const x = (bx(T0 + i) + bx(T0 + i + 1)) / 2, y = base - n / relMax * ch * .9;
    i ? bctx.lineTo(x, y) : bctx.moveTo(x, y);
  });
  bctx.stroke();
  // decade ticks
  bctx.font = '600 10px ' + FH; bctx.textBaseline = 'middle'; bctx.textAlign = 'left';
  for (let y = Math.ceil(T0 / 10) * 10; y <= NOW; y += 10) {
    const x = Math.round(bx(y)) + .5;
    bctx.fillStyle = '#3a1f22'; bctx.fillRect(x, top, 1, ch + 3);
    bctx.fillStyle = ASH; bctx.fillText(y, x + 3, BH - 7);
  }
  bctx.fillStyle = '#5a3a3c'; bctx.fillRect(BP, base, BW - BP * 2, 1);
  // year filter currently applied (if any)
  if (filters.from > T0 || filters.to < NOW) {
    bctx.fillStyle = 'rgba(193,18,31,.18)';
    bctx.fillRect(bx(filters.from), top - 4, bx(filters.to + 1) - bx(filters.from), ch + 4);
  }
  // viewport window
  const { yl, yr } = brushRange();
  const xl = clamp(bx(yl), 0, BW), xr = clamp(bx(yr), 0, BW);
  bctx.fillStyle = 'rgba(232,226,212,.12)'; bctx.fillRect(xl, top - 4, Math.max(xr - xl, 2), ch + 8);
  bctx.strokeStyle = BONE; bctx.lineWidth = 1.2; bctx.strokeRect(xl + .5, top - 3.5, Math.max(xr - xl, 2) - 1, ch + 7);
  bctx.fillStyle = BONE;
  [xl, xr].forEach(x => { roundRectOn(bctx, x - 2.5, top + ch / 2 - 9, 5, 18, 2); bctx.fill(); });
  bctx.font = '600 11px ' + FH; bctx.textBaseline = 'middle'; bctx.textAlign = 'left'; bctx.fillStyle = BONE;
  bctx.fillText(Math.max(Math.round(yl), T0) + ' – ' + Math.min(Math.round(yr), NOW), BP, 8);
}
function roundRectOn(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
let bdrag = null;
function brushMode(x) {
  const { yl, yr } = brushRange(), xl = bx(yl), xr = bx(yr), tol = 8;
  const dl = Math.abs(x - xl), dr = Math.abs(x - xr);
  if (Math.min(dl, dr) < tol) return dl <= dr ? 'l' : 'r';                   // nearest handle, also for very narrow windows
  const inside = x > xl && x < xr;
  const covers = (Math.min(xr, BW - BP) - Math.max(xl, BP)) / (BW - BP * 2);
  if (inside && covers > 0.85) return 'new';                                 // whole timeline in view: dragging selects a range
  return inside ? 'move' : 'new';
}
brush.addEventListener('pointerdown', e => {
  brush.setPointerCapture(e.pointerId);
  const x = e.clientX - brush.getBoundingClientRect().left, rg = brushRange();
  bdrag = { mode: brushMode(x), y0: yearAtB(x), yl: rg.yl, yr: rg.yr, moved: false };
  if (bdrag.mode === 'move') brush.style.cursor = 'grabbing';
});
brush.addEventListener('pointermove', e => {
  const x = e.clientX - brush.getBoundingClientRect().left;
  if (!bdrag) {
    const m = brushMode(x);
    brush.style.cursor = m === 'l' || m === 'r' ? 'ew-resize' : m === 'move' ? 'grab' : 'crosshair';
    return;
  }
  const y = yearAtB(x), d = y - bdrag.y0;
  if (Math.abs(d) > 0.05) bdrag.moved = true;
  if (bdrag.mode === 'move') {                                               // pan; keep the window inside the data
    const dd = clamp(d, T0 - 2 - bdrag.yl, NOW + 3 - bdrag.yr);
    setRange(bdrag.yl + dd, bdrag.yr + dd, { keepY: true });
  }
  else if (bdrag.mode === 'l') setRange(Math.min(y, bdrag.yr - 1.5), bdrag.yr, { anchor: 'r' });
  else if (bdrag.mode === 'r') setRange(bdrag.yl, Math.max(y, bdrag.yl + 1.5), { anchor: 'l' });
  else if (bdrag.moved) setRange(Math.min(bdrag.y0, y), Math.max(bdrag.y0, y));
});
const endBrush = () => {
  if (bdrag && !bdrag.moved && bdrag.mode === 'new') {      // plain click outside the window: recentre on that year
    const span = bdrag.yr - bdrag.yl, c = bdrag.y0;
    setRange(c - span / 2, c + span / 2, { keepY: true, anchor: 'c' });
  }
  bdrag = null;
};
brush.addEventListener('pointerup', endBrush);
brush.addEventListener('pointercancel', endBrush);
brush.addEventListener('dblclick', () => fit());
brush.addEventListener('wheel', e => {          // wheel over the strip zooms time only, around the window centre
  e.preventDefault();
  const { yl, yr } = brushRange(), c = (yl + yr) / 2, span = (yr - yl) * Math.exp(e.deltaY * 0.0015);
  setRange(c - span / 2, c + span / 2, { anchor: 'c' });
}, { passive: false });
$('bFilter').onclick = () => {
  const { yl, yr } = brushRange();
  filters.from = clamp(Math.round(yl), T0, NOW); filters.to = clamp(Math.round(yr) - 1, filters.from, NOW);
  $('from').value = filters.from; $('to').value = filters.to;
  refilter();
};
$('bAll').onclick = () => {
  filters.from = T0; filters.to = NOW; $('from').value = T0; $('to').value = NOW;
  refilter(); fit();
};

// ---------- minimap ----------
const MW = 220, MH = 120, MPAD = 6;
function miniScale() {
  const bw = world.x1 - world.x0, bh = world.y1 - world.y0;
  const s = Math.min((MW - MPAD * 2) / bw, (MH - MPAD * 2) / bh);
  return { s, ox: (MW - bw * s) / 2 - world.x0 * s, oy: (MH - bh * s) / 2 - world.y0 * s };
}
function drawMini() {
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, MW, MH);
  if (!visible.length) return;
  const { s, ox, oy } = miniScale();
  lanes.forEach(l => {
    mctx.fillStyle = col(l.g, 50, .07);
    mctx.fillRect(MPAD, l.y * s + oy, MW - MPAD * 2, l.h * s);
  });
  for (const b of visible) {
    mctx.fillStyle = col(genreById[b.genre], 60, .9);
    mctx.fillRect(b.x0 * s + ox, b.y * s + oy, Math.max(1.5, (b.x1 - b.x0) * s), Math.max(1.2, BAR_H * s));
  }
  // viewport
  const vx0 = wxOf(0) * s + ox, vx1 = wxOf(W) * s + ox, vy0 = wyOf(AXIS_H) * s + oy, vy1 = wyOf(H) * s + oy;
  mctx.fillStyle = 'rgba(255,255,255,.08)';
  mctx.strokeStyle = 'rgba(255,255,255,.85)'; mctx.lineWidth = 1;
  mctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  mctx.strokeRect(vx0 + .5, vy0 + .5, vx1 - vx0 - 1, vy1 - vy0 - 1);
}
function miniPan(e) {
  const r = mini.getBoundingClientRect();
  const { s, ox, oy } = miniScale();
  const wx = (e.clientX - r.left - ox) / s, wy = (e.clientY - r.top - oy) / s;
  view.x = W / 2 - wx * view.kx;
  view.y = (AXIS_H + H) / 2 - wy * view.ky;
  anim = null; dirty = true;
}
let miniDown = false;
mini.addEventListener('pointerdown', e => { mini.setPointerCapture(e.pointerId); miniDown = true; miniPan(e); });
mini.addEventListener('pointermove', e => { if (miniDown) miniPan(e); });
mini.addEventListener('pointerup', () => { miniDown = false; });
mini.addEventListener('pointercancel', () => { miniDown = false; });
mini.addEventListener('wheel', e => { e.preventDefault(); zoomAt(W / 2, H / 2, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

// cached drawing resources (gradients and the vignette are expensive to rebuild every frame)
const steelCache = new Map(), flatCache = {};
function steelGradient(g, bh) {
  const key = g.id + '|' + bh.toFixed(1);
  let gr = steelCache.get(key);
  if (!gr) {
    if (steelCache.size > 300) steelCache.clear();
    gr = ctx.createLinearGradient(0, 0, 0, bh);
    gr.addColorStop(0, col(g, 46)); gr.addColorStop(.5, col(g, 32)); gr.addColorStop(1, col(g, 20));
    steelCache.set(key, gr);
  }
  return gr;
}
const flatColor = g => flatCache[g.id] || (flatCache[g.id] = col(g, 38, .95));
let vigCanvas = null, vigKey = '';
function drawVignette() {
  const key = W + 'x' + H + '@' + dpr, gh = H - AXIS_H;
  if (vigKey !== key) {
    vigKey = key;
    vigCanvas = document.createElement('canvas');
    vigCanvas.width = Math.max(1, Math.round(W * dpr)); vigCanvas.height = Math.max(1, Math.round(gh * dpr));
    const c = vigCanvas.getContext('2d');
    c.scale(dpr, dpr);
    const vg = c.createRadialGradient(W / 2, H / 2 - AXIS_H, Math.min(W, H) * .35, W / 2, H / 2 - AXIS_H, Math.max(W, H) * .8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = vg; c.fillRect(0, 0, W, gh);
  }
  ctx.drawImage(vigCanvas, 0, AXIS_H, W, gh);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function diamond(x, y, r) {
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
}

function frame() {
  if (anim) anim();
  if (dirty) { dirty = false; draw(); }
  requestAnimationFrame(frame);
}

// ---------- hit testing ----------
function hitTest(px, py) {
  if (py < AXIS_H) return {};
  const wx = wxOf(px), wy = wyOf(py);
  const slop = (COARSE ? 14 : 3) / view.ky;                 // screen px converted to world units
  const aslop = COARSE ? 18 : 8;
  const gate = Math.max(slop, aslop / view.ky);             // markers hang below the bar, so look a little further
  let album = null, band = null, best = Infinity, bestAlbum = Infinity;
  for (const b of visible) {
    const cy = b.y + BAR_H / 2, dy = Math.abs(wy - cy), my = b.y + BAR_H;   // my = marker line (bar's bottom edge)
    if (dy > BAR_H / 2 + gate) continue;
    if (filters.albums) {
      for (const a of rels(b)) {
        if (a.year < b.formed) continue;
        const dx = Math.abs(sx((a.year + .5 - T0) * PX_YEAR) - px), d = Math.hypot(dx, (my - wy) * view.ky);
        if (dx < aslop && d < bestAlbum && Math.abs(sy(my) - py) < aslop) { bestAlbum = d; album = { a, b }; }
      }
    }
    const right = Math.max(b.x1, b.x0 + b.tw + 14);
    if (dy <= BAR_H / 2 + slop && wx >= b.x0 - slop && wx <= right && dy < best) { best = dy; band = b; }
  }
  return { band: album ? album.b : band, album };
}

// ---------- detail panel ----------
function linkList(ids) {
  return ids.map(id => {
    const b = bandById[id], g = genreById[b.genre];
    return `<a data-id="${id}" class="${visible.includes(b) ? '' : 'dim'}" style="--c:${col(g)}">${esc(b.name)}</a>`;
  }).join('');
}
const nameList = ids => ids.map(id => bandById[id].name).join(', ').replace(/, ([^,]*)$/, ' and $1');

function autoSummary(b) {
  const g = genreById[b.genre], kids = children[b.id] || [];
  const span = b.ended ? `${b.formed}–${b.ended}` : `since ${b.formed}`;
  let t = `${b.name} ${b.kind === 'artist' ? 'is a solo artist' : 'is a band'} from ${b.country} (active ${span}), filed under ${g.name}${b.sub && b.sub !== 'Other' ? ' › ' + b.sub : ''}.`;
  if (b.from.length) t += ` On this map it is linked to ${nameList(b.from.slice(0, 3))}${b.from.length > 3 ? ' and others' : ''} as influences.`;
  if (kids.length) t += ` It in turn influenced ${kids.length} act${kids.length > 1 ? 's' : ''}, including ${nameList(kids.slice(0, 3))}.`;
  return t;
}

function facts(b) {
  const g = genreById[b.genre], kids = children[b.id] || [];
  const years = (b.ended ?? NOW) - b.formed, rel = rels(b).map(a => a.year);
  const peers = BANDS.filter(o => o !== b && o.formed === b.formed).length;
  return [
    ['Active', `${b.formed} – ${b.ended ?? 'present'}`, `${years} years`],
    ['Origin', b.country, ''],
    ['Genre', g.name, b.sub && b.sub !== 'Other' ? b.sub : ''],
    [filters.releases === 'all' ? 'Releases' : 'Key releases', String(rel.length), rel.length ? `${Math.min(...rel)}–${Math.max(...rel)}` : ''],
    ['Influence', `${b.from.length} in · ${kids.length} out`, ''],
    ['Era', `${Math.floor(b.formed / 10) * 10}s`, peers ? `${peers} other act${peers > 1 ? 's' : ''} formed in ${b.formed}` : ''],
  ];
}

function releaseList(b) {
  const list = rels(b), all = filters.releases === 'all';
  const more = all || !b.all ? 0 : b.all.filter(a => !a.live).length - list.length;
  return `<h4>${all ? 'Releases' : 'Key releases'} <span class="muted">(click a year)</span></h4>
    <ul class="rel">${list.map(a => `<li data-year="${a.year}" class="${a.year === selYear ? 'cur' : ''}${a.key ? '' : ' minor'}"><b>${a.year}</b><span>${esc(a.title)}${a.live ? ' <em>live</em>' : ''}</span></li>`).join('')}</ul>
    ${more > 0 ? `<div class="muted">+ ${more} more studio album${more > 1 ? 's' : ''}: set <b>Releases</b> to All albums in the filters.</div>` : ''}`;
}
let wikiRequested = false;
function loadWiki() {
  if (window.WIKI || wikiRequested) return;
  wikiRequested = true;
  const el = document.createElement('script');
  el.src = 'data.wiki.js';
  el.onload = () => renderDetail();
  document.head.appendChild(el);
}
function renderDetail() {
  const el = $('detail');
  document.body.classList.toggle('hasDetail', !!selected);
  if (!selected) { el.hidden = true; return; }
  if (!window.WIKI) loadWiki();                              // summaries are fetched on first use, then this panel re-renders
  if (W <= 700 && !$('panel').classList.contains('closed')) setPanel(false);
  const b = selected, g = genreById[b.genre];
  const kids = children[b.id] || [], shared = sharedOf[b.id] || [];
  const wiki = (window.WIKI || {})[b.id];
  const q = filters.q.trim().toLowerCase();
  const memberQ = q && (filters.scope === 'all' || filters.scope === 'member');
  el.style.setProperty('--c', col(g));
  el.hidden = false;
  el.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <h3>${esc(b.name)}</h3>
    <div class="tags"><span class="tag click" data-genre="${b.genre}" title="Show only ${esc(g.name)}">${esc(g.name)}</span>${b.sub && b.sub !== 'Other' ? `<span class="tag ghost click" data-genre="${b.genre}" data-sub="${esc(b.sub)}" title="Show only ${esc(b.sub)}">${esc(b.sub)}</span>` : ''}<span class="tag ghost">${b.kind === 'artist' ? 'Solo artist' : 'Band'}</span></div>

    <h4>Summary</h4>
    ${wiki ? `<p class="sum">${wiki.desc ? `<em>${esc(wiki.desc)}.</em> ` : ''}${esc(wiki.text)}</p>
      <div class="src">Summary from <a href="${esc(wiki.url)}" target="_blank" rel="noopener">Wikipedia</a> · CC BY-SA 4.0</div>`
      : `<p class="sum">${esc(autoSummary(b))}</p><div class="src">${window.WIKI ? "Summary generated from this map's data." : 'Loading the Wikipedia summary…'}</div>`}

    <h4>At a glance</h4>
    <div class="facts">${facts(b).map(([l, v, sub]) => `<div><small>${l}</small><b>${esc(v)}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`).join('')}</div>

    ${releaseList(b)}

    ${b.from.length ? `<h4>Influenced by <button class="fbtn" data-focus="roots" title="Show only this band and everything that led to it">filter ▸</button></h4><div class="links">${linkList(b.from)}</div>` : ''}
    ${kids.length ? `<h4>Influenced <button class="fbtn" data-focus="offspring" title="Show only this band and everything it led to">filter ▸</button></h4><div class="links">${linkList(kids)}</div>` : ''}
    ${shared.length ? `<h4>Shared members <button class="fbtn" data-focus="shared" title="Show only this band and the bands it shares members with">filter ▸</button></h4><div class="links gold">${shared.map(x => {
        const o = bandById[x.id];
        const who = splitWho(x.who).map(p => `<span class="person" data-person="${esc(p.replace(/\s*\([^)]*\)/g, ''))}" title="Show every band this musician played in">${esc(p)}</span>`).join(', ');
        return `<a data-id="${x.id}" class="${visible.includes(o) ? '' : 'dim'}">${esc(o.name)}<small>${who}</small></a>`;
      }).join('')}</div>` : ''}
    ${b.members.length ? `<h4>${b.kind === 'artist' ? 'Musicians' : 'Lineup'} <span class="muted">(MusicBrainz)</span></h4>
      <ul class="members">${b.members.slice(0, 16).map(m =>
        `<li class="${memberQ && m.name.toLowerCase().includes(q) ? 'hit' : ''}"><b>${m.from ?? ''}${m.from || m.to ? '–' : ''}${m.to ?? ''}</b><span>${esc(m.name)}</span></li>`).join('')}</ul>
      ${b.members.length > 16 ? `<div class="muted">+ ${b.members.length - 16} more</div>` : ''}` : ''}

    <div class="ext">${wiki ? `<a href="${esc(wiki.url)}" target="_blank" rel="noopener">Wikipedia ↗</a>` : ''}${b.mbid ? `<a href="https://musicbrainz.org/artist/${b.mbid}" target="_blank" rel="noopener">MusicBrainz ↗</a>` : ''}</div>`;
}
$('detail').addEventListener('click', e => {
  if (e.target.closest('.close')) { selected = null; renderDetail(); dirty = true; return; }
  const gt = e.target.closest('[data-genre]');
  if (gt) { gt.dataset.sub ? filterSub(gt.dataset.genre, gt.dataset.sub) : filterGenre(gt.dataset.genre); return; }
  const fb = e.target.closest('[data-focus]');
  if (fb) { focusFilter(fb.dataset.focus); return; }
  const pp = e.target.closest('[data-person]');
  if (pp) { filterMember(pp.dataset.person); return; }
  const li = e.target.closest('li[data-year]');
  if (li) { setYear(+li.dataset.year, true); return; }
  const a = e.target.closest('a[data-id]');
  if (a) select(bandById[a.dataset.id]);
});
// ---------- filters launched from the details panel ----------
const splitWho = w => w.split(/,\s*(?![^()]*\))/).map(t => t.trim()).filter(Boolean);
function lineage(id, next) {                       // every band reachable through `next`, transitively
  const seen = new Set(), stack = [id];
  while (stack.length) for (const y of next(stack.pop())) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  seen.delete(id);
  return seen;
}
function filterGenre(id) {
  filters.genres = new Set([id]); filters.subOff = new Set();
  buildGenres(); refilter(); fit();
}
function filterSub(genre, name) { soloSub(genre, name); }
function focusFilter(kind) {
  const b = selected;
  if (!b) return;
  let ids, label;
  if (kind === 'roots') { ids = lineage(b.id, x => bandById[x].from); label = 'Roots of ' + b.name; }
  else if (kind === 'offspring') { ids = lineage(b.id, x => children[x] || []); label = 'Influenced by ' + b.name; }
  else { ids = new Set((sharedOf[b.id] || []).map(o => o.id)); label = 'Shares members with ' + b.name; }
  ids.add(b.id);
  filters.focus = { label, ids };
  filters.genres = new Set(GENRES.map(g => g.id)); filters.subOff = new Set();     // a lineage spans genres: do not hide any
  buildGenres(); refilter(); fit();
}
function filterMember(name) {
  filters.q = name; filters.scope = 'member'; filters.focus = null;
  $('search').value = name; $('scope').value = 'member';
  renderPeople(); refilter(); fit();
}
function renderFilterBar() {
  const bar = $('filterbar'), pills = [];
  if (filters.focus) pills.push(['focus', filters.focus.label + ' · ' + filters.focus.ids.size]);
  if (filters.genres.size === 1) {
    const gid = [...filters.genres][0], subs = subsOf(gid), on = subs.filter(n => !filters.subOff.has(gid + '|' + n));
    pills.push(['genre', 'Genre: ' + genreById[gid].name]);
    if (on.length && on.length < subs.length) pills.push(['sub', on.length === 1 ? 'Subgenre: ' + on[0] : 'Subgenres: ' + on.length + ' of ' + subs.length]);
  } else {
    const hidden = [...filters.subOff].filter(k => filters.genres.has(k.split('|')[0])).length;
    if (hidden) pills.push(['sub', hidden + ' subgenre' + (hidden > 1 ? 's' : '') + ' hidden']);
  }
  if (filters.q.trim()) pills.push(['q', (filters.scope === 'member' ? 'Member: ' : 'Search: ') + filters.q.trim()]);
  bar.hidden = !pills.length;
  bar.innerHTML = pills.map(([k, t]) => `<span class="pill">${esc(t)}<button data-clear="${k}" aria-label="Remove this filter">✕</button></span>`).join('');
}
$('filterbar').addEventListener('click', e => {
  const c = e.target.closest('[data-clear]');
  if (!c) return;
  const k = c.dataset.clear;
  if (k === 'focus') filters.focus = null;
  if (k === 'sub') { filters.subOff = new Set(); buildGenres(); }
  if (k === 'genre') { filters.subOff = new Set(); filters.genres = new Set(GENRES.map(g => g.id)); buildGenres(); }
  if (k === 'q') { filters.q = ''; $('search').value = ''; renderPeople(); }
  refilter(); fit();
});

function select(b, year) {
  selected = b; renderDetail(); dirty = true;
  if (b) focusBand(b, year);
}

// ---------- on this year ----------
function renderYear() {
  const list = $('yearList'), stats = $('yearStats');
  if (selYear == null) {
    list.innerHTML = '<p class="muted">Pick a year to see every key release, formation and breakup from that year.</p>';
    stats.textContent = '';
    return;
  }
  const rel = [], formed = [], ended = [];
  for (const b of visible) {
    rels(b).filter(a => a.year === selYear).forEach(a => rel.push({ b, a }));
    if (b.formed === selYear) formed.push(b);
    if (b.ended === selYear) ended.push(b);
  }
  const order = GENRES.map(g => g.id);
  rel.sort((x, y) => order.indexOf(x.b.genre) - order.indexOf(y.b.genre) || x.b.name.localeCompare(y.b.name));
  const total = BANDS.reduce((n, b) => n + rels(b).filter(a => a.year === selYear).length, 0);
  stats.textContent = `${rel.length} release${rel.length === 1 ? '' : 's'} · ${formed.length} formed · ${ended.length} ended` +
    (total > rel.length ? ` (${total - rel.length} hidden by filters)` : '');
  let html = '', last = null;
  for (const { b, a } of rel) {
    if (b.genre !== last) { const g = genreById[b.genre]; html += `<h5 style="--c:${col(g)}"><i></i>${esc(g.name)}</h5>`; last = b.genre; }
    html += `<div class="yi${a.key ? '' : ' minor'}" data-id="${b.id}" data-year="${selYear}"><b>${esc(a.title)}${a.live ? ' <em>live</em>' : ''}</b><span>${esc(b.name)}</span></div>`;
  }
  const people = (title, arr) => arr.length
    ? `<h5 class="plain">${title}</h5>` + arr.map(b => `<div class="yi" data-id="${b.id}" data-year="${selYear}"><b>${esc(b.name)}</b><span>${esc(genreById[b.genre].name)}</span></div>`).join('') : '';
  html += people('Formed', formed) + people('Ended', ended);
  list.innerHTML = html || '<p class="muted">Nothing on this map for that year with the current filters.</p>';
}
function setYear(y, openTab = false, recenter = false) {
  selYear = y == null || Number.isNaN(y) ? null : clamp(Math.round(y), T0, NOW);
  $('yearIn').value = selYear ?? '';
  if (openTab) showTab('year');
  if (filters.yearOnly) { layout(); fit(); } else renderYear();
  if (recenter && selYear != null) {
    const x = sx((selYear + .5 - T0) * PX_YEAR), left = W > 700 ? 300 : 0;
    if (x < left + 60 || x > W - 60) goTo({ ...view, x: left + (W - left) / 2 - (selYear + .5 - T0) * PX_YEAR * view.kx });
  }
  renderDetail();
  dirty = true;
}
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('tab-filters').hidden = name !== 'filters';
  $('tab-year').hidden = name !== 'year';
  $('tab-about').hidden = name !== 'about';
}

// ---------- tooltip ----------
const tip = $('tip');
function showTip(e, band, album) {
  if (!band) { tip.hidden = true; return; }
  const g = genreById[band.genre];
  tip.innerHTML = album
    ? `<b>${esc(album.a.title)}</b><small>${esc(band.name)} · ${album.a.year} · ${album.a.live ? 'live album' : album.a.key ? 'key release' : 'studio album'}</small>`
    : `<b>${band.name}</b><small>${band.kind === 'artist' ? 'Solo artist · ' : ''}${g.name} · ${band.formed}–${band.ended ?? 'present'} · ${band.country}</small>`;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 14, W - r.width - 8) + 'px';
  tip.style.top = Math.min(e.clientY + 14, H - r.height - 8) + 'px';
}

// ---------- input ----------
const ptrs = new Map();
let down = null, moved = false, pinch = null;

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  anim = null;
  if (ptrs.size === 1) { down = { x: e.clientX, y: e.clientY }; moved = false; }
  if (ptrs.size === 2) { pinch = pinchState(); moved = true; }
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) {
    const h = hitTest(e.clientX, e.clientY);
    if (h.band !== hovered || h.album?.a !== hoverAlbum?.a) {
      hovered = h.band || null; hoverAlbum = h.album || null; dirty = true;
    }
    canvas.classList.toggle('hit', !!hovered || e.clientY < AXIS_H);
    showTip(e, hovered, hoverAlbum);
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) {
    if (!moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
    moved = true; tip.hidden = true; canvas.classList.add('drag');
    view.x += dx; view.y += dy; dirty = true;
  } else if (ptrs.size === 2 && pinch) {
    const n = pinchState();
    zoomAt(n.cx, n.cy, n.d / pinch.d);
    view.x += n.cx - pinch.cx; view.y += n.cy - pinch.cy;
    pinch = n; dirty = true;
  }
});
const yearAt = px => clamp(Math.floor(wxOf(px) / PX_YEAR + T0), T0, NOW);
function pinchState() {
  const [a, b] = [...ptrs.values()];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
}
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); pinch = null;
  canvas.classList.remove('drag');
  if (ptrs.size === 0 && !moved && e.type === 'pointerup') {
    if (e.clientY < ERA_H) { toggleEra(ERAS.findIndex(x => yearAt(e.clientX) >= x.from && yearAt(e.clientX) <= x.to)); return; }
    if (e.clientY < AXIS_H) { setYear(yearAt(e.clientX), true); return; }
    const h = hitTest(e.clientX, e.clientY);
    if (h.band) { select(h.band); if (h.album) setYear(h.album.a.year); }
    else { selected = null; renderDetail(); dirty = true; }
  }
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('pointerleave', () => { if (!ptrs.size) { hovered = null; hoverAlbum = null; tip.hidden = true; dirty = true; } });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  let d = e.deltaY || e.deltaX;
  if (e.deltaMode === 1) d *= 16;
  zoomAt(e.clientX, e.clientY, Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)), e.shiftKey);
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.target.matches('input, select')) return;
  const s = 80;
  if (e.key === 'ArrowLeft') view.x += s;
  else if (e.key === 'ArrowRight') view.x -= s;
  else if (e.key === 'ArrowUp') view.y += s;
  else if (e.key === 'ArrowDown') view.y -= s;
  else if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.25);
  else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.25);
  else if (e.key === '0') fit();
  else if (e.key === 'Escape') { selected = null; renderDetail(); }
  else return;
  anim = null; dirty = true;
});
$('zin').onclick = () => zoomAt(W / 2, H / 2, 1.4);
$('zout').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.4);
window.addEventListener('resize', resize);

// ---------- filter UI ----------
// Subgenres of a genre, in lane order (every subgenre that has at least one act).
function subsOf(gid) {
  const present = [...new Set(BANDS.filter(b => b.genre === gid).map(b => b.sub))];
  const order = SUB_ORDER[gid] || [];
  return [...order.filter(n => present.includes(n)), ...present.filter(n => !order.includes(n))];
}
const expanded = new Set();                                      // genres whose subgenres are shown in the list
const allSubsOff = gid => subsOf(gid).every(n => filters.subOff.has(gid + '|' + n));
function toggleSub(gid, name) {
  const key = gid + '|' + name;
  if (!filters.genres.has(gid)) {                                // genre was off: turn it on with only this subgenre
    filters.genres.add(gid);
    subsOf(gid).forEach(n => filters.subOff.add(gid + '|' + n));
    filters.subOff.delete(key);
  } else filters.subOff.has(key) ? filters.subOff.delete(key) : filters.subOff.add(key);
  if (allSubsOff(gid)) {                                         // nothing left: that is the same as switching the genre off
    filters.genres.delete(gid);
    subsOf(gid).forEach(n => filters.subOff.delete(gid + '|' + n));
  }
  buildGenres(); refilter();
}
function soloSub(gid, name) {
  filters.genres = new Set([gid]);
  filters.subOff = new Set(subsOf(gid).filter(n => n !== name).map(n => gid + '|' + n));
  expanded.add(gid);
  buildGenres(); refilter(); fit();
}
function buildGenres() {
  const box = $('genres'); box.innerHTML = '';
  GENRES.forEach(g => {
    const n = BANDS.filter(b => b.genre === g.id).length, subs = subsOf(g.id);
    const off = subs.filter(x => filters.subOff.has(g.id + '|' + x)).length;
    const on = filters.genres.has(g.id), open = expanded.has(g.id);
    const d = document.createElement('div');
    d.className = 'chip' + (!on ? ' off' : off ? ' partial' : '');
    d.style.setProperty('--c', col(g));
    d.innerHTML = '<i></i><span>' + g.name + '</span><em>' + n + '</em>' +
      '<button class="car" aria-label="' + (open ? 'Hide' : 'Show') + ' subgenres of ' + g.name + '" aria-expanded="' + open + '">' + (open ? '▾' : '▸') + '</button>';
    d.title = 'Click to show or hide · Alt+click to show only this genre · arrow to list its subgenres';
    d.onclick = e => {
      if (e.target.closest('.car')) { open ? expanded.delete(g.id) : expanded.add(g.id); buildGenres(); return; }
      if (e.altKey) { filters.genres = new Set([g.id]); filters.subOff = new Set(); }
      else filters.genres.has(g.id) ? filters.genres.delete(g.id) : filters.genres.add(g.id);
      buildGenres(); refilter();
    };
    box.appendChild(d);
    if (!open) return;
    subs.forEach(name => {
      const key = g.id + '|' + name, cnt = BANDS.filter(b => b.genre === g.id && b.sub === name).length;
      const sd = document.createElement('div');
      sd.className = 'subchip' + (!on || filters.subOff.has(key) ? ' off' : '');
      sd.style.setProperty('--c', col(g));
      sd.innerHTML = '<i></i><span>' + name + '</span><em>' + cnt + '</em>';
      sd.title = 'Click to show or hide · Alt+click to show only this subgenre';
      sd.onclick = e => e.altKey ? soloSub(g.id, name) : toggleSub(g.id, name);
      box.appendChild(sd);
    });
  });
}
function refilter() { layout(); }

function buildEras() {
  const box = $('eras'); box.innerHTML = '';
  ERAS.forEach((e, i) => {
    const b = document.createElement('button');
    b.textContent = e.label; b.title = e.tag;
    b.className = 'era' + (filters.eras.has(i) ? ' on' : '');
    b.onclick = () => toggleEra(i);
    box.appendChild(b);
  });
}
function toggleEra(i) {
  if (i < 0) return;
  filters.eras.has(i) ? filters.eras.delete(i) : filters.eras.add(i);
  buildEras(); refilter(); fit();
}
$('eraClear').onclick = () => { filters.eras.clear(); buildEras(); refilter(); fit(); };

function renderPeople() {
  const box = $('people'), q = filters.q.trim().toLowerCase();
  if (q.length < 2 || filters.scope === 'name' || filters.scope === 'album') { box.innerHTML = ''; return; }
  const hits = [...peopleMap.values()].filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => b.bands.size - a.bands.size || a.name.localeCompare(b.name)).slice(0, 6);
  box.innerHTML = hits.map(p => `<button data-name="${esc(p.name)}"><b>${esc(p.name)}</b><span>${[...p.bands].slice(0, 4).map(id => esc(bandById[id].name)).join(' · ')}${p.bands.size > 4 ? ' …' : ''}</span></button>`).join('');
}
$('people').addEventListener('click', e => {
  const b = e.target.closest('button[data-name]');
  if (!b) return;
  filters.q = b.dataset.name; filters.scope = 'member';
  $('search').value = filters.q; $('scope').value = 'member';
  renderPeople(); refilter();
});
$('scope').addEventListener('change', e => { filters.scope = e.target.value; renderPeople(); refilter(); });
$('search').addEventListener('input', e => { filters.q = e.target.value; renderPeople(); refilter(); });

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('yearIn').addEventListener('change', e => setYear(e.target.value === '' ? null : +e.target.value, false, true));
$('yPrev').onclick = () => setYear((selYear ?? NOW + 1) - 1, false, true);
$('yNext').onclick = () => setYear((selYear ?? T0 - 1) + 1, false, true);
$('yClear').onclick = () => setYear(null);
$('yearOnly').onchange = e => { filters.yearOnly = e.target.checked; layout(); fit(); };
$('yearList').addEventListener('click', e => {
  const it = e.target.closest('[data-id]');
  if (it) select(bandById[it.dataset.id], +it.dataset.year || null);
});
$('gAll').onclick = () => { filters.genres = new Set(GENRES.map(g => g.id)); filters.subOff = new Set(); buildGenres(); refilter(); };
$('gNone').onclick = () => { filters.genres.clear(); buildGenres(); refilter(); };
$('from').addEventListener('input', e => { filters.from = +e.target.value || T0; refilter(); });
$('to').addEventListener('input', e => { filters.to = +e.target.value || NOW; refilter(); });
$('country').addEventListener('change', e => { filters.country = e.target.value; refilter(); });
document.querySelectorAll('#kinds input').forEach(cb => cb.onchange = () => {
  cb.checked ? filters.kinds.add(cb.value) : filters.kinds.delete(cb.value); refilter();
});
$('optAlbums').onchange = e => { filters.albums = e.target.checked; dirty = true; };
function setReleases(mode, live) {
  const apply = () => {
    filters.releases = mode; if (live != null) filters.live = live;
    $('optReleases').value = mode; $('optLive').checked = filters.live; $('optLive').disabled = mode !== 'all';
    layout();
  };
  if (mode === 'all' && !allLoaded) {
    $('optReleases').disabled = true;
    loadAlbums(ok => {
      $('optReleases').disabled = false;
      if (ok) apply(); else { $('optReleases').value = 'key'; alert('Could not load data.albums.js. Run: node tools/albums.js'); }
    });
  } else apply();
}
$('optReleases').onchange = e => setReleases(e.target.value);
$('optLive').onchange = e => { filters.live = e.target.checked; layout(); };
$('optStatus').onchange = e => { filters.fade = e.target.checked; dirty = true; };
$('optRel').onchange = e => { filters.rel = e.target.value; dirty = true; };
$('optShared').onchange = e => { filters.shared = e.target.value; dirty = true; };
$('optSplit').onchange = e => { filters.split = e.target.checked; layout(); fit(); };
$('fit').onclick = () => fit();
$('reset').onclick = () => {
  Object.assign(filters, { q: '', genres: new Set(GENRES.map(g => g.id)), from: T0, to: NOW, country: '', kinds: new Set(['band', 'artist']), scope: 'all', eras: new Set(), yearOnly: false, focus: null, subOff: new Set() });
  filters.releases = 'key'; filters.live = false; $('optReleases').value = 'key'; $('optLive').checked = false; $('optLive').disabled = true;
  $('scope').value = 'all'; $('yearOnly').checked = false; $('people').innerHTML = ''; buildEras(); selYear = null; $('yearIn').value = '';
  document.querySelectorAll('#kinds input').forEach(cb => cb.checked = true);
  $('search').value = ''; $('from').value = T0; $('to').value = NOW; $('country').value = '';
  buildGenres(); refilter(); fit();
};
function setPanel(open) {
  if (open && W <= 700 && selected) { selected = null; renderDetail(); }
  $('panel').classList.toggle('closed', !open);
  document.body.classList.toggle('pclosed', !open);
  $('open').hidden = open;
  dirty = true;
}
$('collapse').onclick = () => setPanel(false);
$('open').onclick = () => setPanel(true);

const countries = [...new Set(BANDS.flatMap(b => b.country.split('/')))].sort();
countries.forEach(c => $('country').add(new Option(c, c)));

// ---------- about ----------
(() => {
  const releases = BANDS.reduce((n, b) => n + b.albums.length, 0);
  const countries = new Set(BANDS.flatMap(b => b.country.split('/'))).size;
  $('aboutStats').textContent = BANDS.length + ' bands and artists · ' + releases + ' key releases · ' + GENRES.length + ' genres · ' + countries + ' countries';
})();

// ---------- boot ----------
resize(); if (W <= 700) setPanel(false);
buildGenres(); buildEras(); layout(); fit(false);
if (document.fonts) {
  // also fetch the accented-letter subset up front, so names like Mgła or Hüsker Dü never draw in a fallback font
  const accents = [...new Set(BANDS.flatMap(b => [...b.name, ...b.albums.flatMap(x => [...x.title])]).filter(c => c.charCodeAt(0) > 126))].join('');
  Promise.all(['600 14px "Barlow Condensed"', '700 12px Cinzel'].map(f => document.fonts.load(f, 'Aa ' + accents)))
    .then(() => layout()).catch(() => {});
}
(() => {
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('scope')) { filters.scope = hp.get('scope'); $('scope').value = filters.scope; }
  if (hp.get('q')) { filters.q = hp.get('q'); $('search').value = filters.q; renderPeople(); }
  if (hp.get('era')) { hp.get('era').split(',').forEach(i => ERAS[+i] && filters.eras.add(+i)); buildEras(); }
  if (hp.get('year')) { selYear = +hp.get('year'); $('yearIn').value = selYear; }
  if (hp.get('tab')) showTab(hp.get('tab'));
  if (hp.get('expand')) { hp.get('expand').split(',').forEach(g => expanded.add(g)); buildGenres(); }
  layout(); fit(false);
  if (hp.get('releases') === 'all') setReleases('all', hp.get('live') === '1');
  if (hp.get('band') && bandById[hp.get('band')] && visible.includes(bandById[hp.get('band')])) {
    selected = bandById[hp.get('band')]; renderDetail();
    const k = +hp.get('zoom') || 1.4, b = selected, cy = b.y + BAR_H / 2;
    const cx = selYear != null ? (selYear + .5 - T0) * PX_YEAR : b.x0 + (b.x1 - b.x0) / 2;
    goTo({ kx: k, ky: k, x: 300 + (W - 300 - 340) / 2 - cx * k, y: AXIS_H + (H - AXIS_H) / 2 - cy * k }, false);
  } else if (hp.get('zoom')) {
    const k = +hp.get('zoom'), cy = +hp.get('cy') || 0;
    goTo({ kx: k, ky: k, x: 300 - ((+hp.get('from') || 1960) - T0) * PX_YEAR * k, y: AXIS_H - cy * k }, false);
  }
  if (hp.get('focus') && selected) focusFilter(hp.get('focus'));               // #band=metallica&focus=roots|offspring|shared
  if (hp.get('sub') && bandById[hp.get('band')]) filterSub(bandById[hp.get('band')].genre, hp.get('sub'));
})();
requestAnimationFrame(frame);
(window.requestIdleCallback || (f => setTimeout(f, 200)))(loadWiki);

// Dev hook for tools/perf.js (open the page with #perf in the URL)
if (/perf/.test(location.hash)) {
  window.__atlas = { draw, layout, fit, setReleases, zoomAt, view, filters, bandById, bootMs: performance.now(), setRange, brushRange, brushMode, bx, yearAtB,
                     get visibleCount() { return visible.length; } };
}
})();
