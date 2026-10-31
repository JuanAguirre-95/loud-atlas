// Keeps headless-browser test runs from leaving profile folders behind.
//
//   require('./lib/browser-cleanup');          at the top of a script that spawns Edge/Chrome with --user-data-dir=...
//   node -r ./tools/lib/browser-cleanup.js x   or preload it for a script you cannot edit
//
// Why it exists: a script that calls browser.kill() and then deletes the profile right away loses the race. Edge is still
// holding files open, the delete fails quietly, and about half a gigabyte is left in the temp folder for every run.
//
// What it does:
//   - remembers every Edge/Chrome process the script spawns, and the --user-data-dir it was given
//   - when the script ends (normally, by process.exit, an uncaught error, or Ctrl-C / SIGTERM) it kills the whole browser
//     process tree, waits for the files to be released, and deletes the profile, retrying for a few seconds
//   - on start it removes stale profiles that earlier, hard-killed runs left in the temp folder (atlas-*, loudatlas-*),
//     skipping any that are younger than ATLAS_SWEEP_MINUTES (default 20) so it never touches a run in progress

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tracked = [];
const realSpawn = cp.spawn;
cp.spawn = function (cmd, args, opts) {
  const child = realSpawn.apply(this, arguments);
  const dir = (Array.isArray(args) ? args : []).map(String).find(a => a.startsWith('--user-data-dir='));
  if (dir && /msedge|chrome|chromium/i.test(String(cmd))) tracked.push({ child, dir: dir.slice('--user-data-dir='.length) });
  return child;
};

const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function removeDir(dir) {
  for (let i = 0; i < 25; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch { /* a file is still locked: wait and retry */ }
    if (!fs.existsSync(dir)) return true;
    wait(200);
  }
  return !fs.existsSync(dir);
}

function killTree(child) {
  try {
    if (process.platform === 'win32') cp.execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}

let done = false;
function cleanup() {
  if (done) return;
  done = true;
  for (const t of tracked) killTree(t.child);
  if (tracked.length) wait(300);
  for (const t of tracked) if (!removeDir(t.dir)) console.error('browser-cleanup: could not remove ' + t.dir);
}

// stale profiles from runs that were killed too hard to clean up after themselves
function sweep() {
  const minutes = process.env.ATLAS_SWEEP_MINUTES === undefined ? 20 : +process.env.ATLAS_SWEEP_MINUTES;
  const tmp = os.tmpdir();
  let names = [];
  try { names = fs.readdirSync(tmp); } catch { return; }
  for (const n of names) {
    if (!/^(atlas|loudatlas)-/.test(n)) continue;
    const p = path.join(tmp, n);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory() && Date.now() - st.mtimeMs > minutes * 60000) fs.rmSync(p, { recursive: true, force: true });
    } catch { /* locked or in use: leave it */ }
  }
}

process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
process.on('uncaughtException', e => { console.error(e); cleanup(); process.exit(1); });
sweep();

module.exports = { cleanup, sweep };
