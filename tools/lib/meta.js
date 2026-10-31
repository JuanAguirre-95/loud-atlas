// Remembers when each source was last pulled, in data/meta.json: { "musicbrainz": "2026-10-25", ... }.
// The fetch tools call stamp('<source>') when they finish; build-data.js puts the dates in the page.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', '..', 'data', 'meta.json');
const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
function stamp(source) {
  const m = read();
  m[source] = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(file, '{\n' + Object.keys(m).sort().map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(m[k])}`).join(',\n') + '\n}\n');
}
module.exports = { stamp, read };
