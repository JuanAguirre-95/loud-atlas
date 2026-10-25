// Force-directed layout for the relationship graph, computed at build time so the page opens with the graph already settled.
// The forces mirror the live simulation in app.js (graph view), which only has to nudge things when you drag an act.
//
//   layout(acts, influence, shared) -> { "<act id>": [x, y] }   integer coordinates
//   influence: [[fromId, actId], ...]   shared: [[idA, idB], ...]

function rng(seed) {                                   // mulberry32: same layout on every build
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function layout(acts, genreIds, influence, shared) {
  const rand = rng(20260101);
  const anchor = {};
  genreIds.forEach((g, i) => { const a = (i / genreIds.length) * Math.PI * 2 - Math.PI / 2; anchor[g] = { x: Math.cos(a) * 760, y: Math.sin(a) * 470 }; });
  const ids = new Set(acts.map(a => a.id));
  const edges = [...influence.filter(e => ids.has(e[0]) && ids.has(e[1])).map(e => ({ a: e[0], b: e[1], t: 'i' })), ...shared.filter(e => ids.has(e[0]) && ids.has(e[1])).map(e => ({ a: e[0], b: e[1], t: 's' }))];
  const nodes = acts.map(a => {
    const an = anchor[a.genre] || { x: 0, y: 0 }, r = rand() * 180, t = rand() * 6.283;
    return { id: a.id, genre: a.genre, x: an.x + Math.cos(t) * r, y: an.y + Math.sin(t) * r, vx: 0, vy: 0 };
  });
  const by = new Map(nodes.map(n => [n.id, n]));
  edges.forEach(e => { e.na = by.get(e.a); e.nb = by.get(e.b); });
  let alpha = 0.9;
  while (alpha > 0.004) {
    const cells = new Map();
    for (const n of nodes) { const k = Math.floor(n.x / 300) + ',' + Math.floor(n.y / 300); (cells.get(k) || cells.set(k, []).get(k)).push(n); }
    for (const n of nodes) {
      const cx = Math.floor(n.x / 300), cy = Math.floor(n.y / 300);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const m of cells.get((cx + ox) + ',' + (cy + oy)) || []) {
          if (m === n || m.id < n.id) continue;
          let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy;
          if (d2 > 90000) continue;
          if (d2 < 1) { dx = rand() - .5; dy = rand() - .5; d2 = 1; }
          const f = (900 / d2) * alpha * 14, d = Math.sqrt(d2);
          n.vx += dx / d * f; n.vy += dy / d * f; m.vx -= dx / d * f; m.vy -= dy / d * f;
        }
      }
    }
    for (const e of edges) {
      const p = e.na, q = e.nb, dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - (e.t === 'i' ? 40 : 80)) * (e.t === 'i' ? 0.006 : 0.002) * alpha;
      p.vx += dx / d * f; p.vy += dy / d * f; q.vx -= dx / d * f; q.vy -= dy / d * f;
    }
    for (const n of nodes) {
      const an = anchor[n.genre] || { x: 0, y: 0 };
      n.vx += (an.x - n.x) * 0.011 * alpha - n.x * 0.0002 * alpha;
      n.vy += (an.y - n.y) * 0.011 * alpha - n.y * 0.0002 * alpha;
      n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
    }
    alpha *= 0.985;
  }
  return Object.fromEntries(nodes.map(n => [n.id, [Math.round(n.x), Math.round(n.y)]]));
}

module.exports = { layout };
