// JSON helpers that keep the data files readable and diff-friendly.
const fs = require('fs');

// An array of records, one compact record per line: easy to scan, edit and review in a pull request.
function writeRecords(file, records) {
  fs.writeFileSync(file, '[\n' + records.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
}

// An object whose values are records, one key per line.
function writeKeyed(file, obj) {
  const keys = Object.keys(obj);
  fs.writeFileSync(file, '{\n' + keys.map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(obj[k])).join(',\n') + '\n}\n');
}

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

module.exports = { writeRecords, writeKeyed, read };
