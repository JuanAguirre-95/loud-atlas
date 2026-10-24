#!/usr/bin/env node
// Measure load time, payload and frame time of the app in headless Edge/Chrome (uses the DevTools protocol).
//
//   node tools/perf.js                  # local ./index.html
//   node tools/perf.js dist             # local ./dist/index.html
//   node tools/perf.js https://loud-atlas.pages.dev/
//   BROWSER="C:\path\to\msedge.exe" node tools/perf.js
//
// Needs Node 22+ (global WebSocket). Frame times come from software rendering, so compare runs against each other
// rather than reading them as absolute numbers.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const arg = process.argv[2] || '';
const url = /^https?:/.test(arg) ? arg
  : 'file:///' + path.join(root, arg === 'dist' ? 'dist' : '', 'index.html').replace(/\\/g, '/');
const target = url + (url.includes('#') ? '' : '#perf');

const candidates = [process.env.BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) { console.error('No Chrome/Edge found. Set BROWSER=...'); process.exit(1); }

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-perf-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1600,900', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(p) { for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${port}${p}`)).json(); } catch { await sleep(250); } } throw new Error('browser not reachable'); }

(async () => {
  const targets = await json('/json');
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result)); return r.result.result.value; };

  await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: target });
  for (let i = 0; i < 120; i++) { if (await evalJs('!!window.__atlas')) break; await sleep(250); }
  await sleep(1500);                                         // let fonts / lazy scripts settle

  const load = await evalJs(`(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').map(r => ({ name: r.name.split('/').pop().split('?')[0].slice(0, 28) || r.name, enc: r.encodedBodySize, size: r.decodedBodySize, xfer: r.transferSize, ms: Math.round(r.responseEnd) }));
    return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), boot: Math.round(window.__atlas.bootMs), res };
  })()`);

  const frames = (name, setup) => evalJs(`(async () => {
    ${setup}
    const A = window.__atlas, t = [];
    for (let i = 0; i < 40; i++) { const s = performance.now(); A.draw(); t.push(performance.now() - s); }
    t.sort((a, b) => a - b);
    return { avg: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1), p95: +t[Math.floor(t.length * .95)].toFixed(1), max: +t[t.length - 1].toFixed(1) };
  })()`).then(v => ({ name, ...v }));

  const out = [];
  out.push(await frames('overview (everything visible)', `window.__atlas.fit(false);`));
  out.push(await frames('zoomed in (2.2x)', `const V = window.__atlas.view; V.kx = V.ky = 2.2; V.x = -9000; V.y = -2500;`));
  out.push(await frames('zoomed in + all influence lines', `window.__atlas.filters.rel = 'all'; window.__atlas.filters.shared = 'all';`));
  await evalJs(`window.__atlas.filters.rel = 'selected'; window.__atlas.filters.shared = 'selected'; window.__atlas.fit(false);`);
  out.push(await frames('overview + all albums + live', `await new Promise(r => { window.__atlas.setReleases('all', true); const w = () => window.__atlas.filters.releases === 'all' ? r() : setTimeout(w, 50); w(); }); window.__atlas.fit(false);`));
  const lay = await evalJs(`(() => { const s = performance.now(); for (let i = 0; i < 20; i++) window.__atlas.layout(); return +((performance.now() - s) / 20).toFixed(1); })()`);
  const heap = await send('Runtime.getHeapUsage');

  const kb = n => (n / 1024).toFixed(0).padStart(5) + ' KB';
  console.log('\\nURL:', target);
  console.log(`DOMContentLoaded ${load.dcl} ms | load ${load.load} ms | app booted at ${load.boot} ms`);
  console.log('\\nResources (encoded = bytes over the wire; local files are never compressed):');
  load.res.sort((a, b) => b.enc - a.enc).forEach(r => console.log('  ' + r.name.padEnd(30), kb(r.enc), ' decoded', kb(r.size), ' done@', String(r.ms).padStart(5) + ' ms'));
  console.log('  total encoded', kb(load.res.reduce((a, r) => a + r.enc, 0)), '| requests', load.res.length);
  console.log('\\nFrame time (ms per draw):');
  out.forEach(o => console.log('  ' + o.name.padEnd(34), `avg ${String(o.avg).padStart(6)}  p95 ${String(o.p95).padStart(6)}  max ${String(o.max).padStart(6)}`));
  console.log(`\\nlayout(): ${lay} ms | JS heap ${(heap.result.usedSize / 1048576).toFixed(1)} MB`);
  ws.close(); proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch(e => { console.error(e); proc.kill(); process.exit(1); });
