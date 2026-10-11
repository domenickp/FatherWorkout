// Derives dev/fixture-routine.json from data/expanded-routine.csv (contract section 1).
// Used only as a stand-in until data/routine.json exists. Run: node dev/make-fixture.js
const fs = require('node:fs');
const path = require('node:path');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const num = (s) => (s.trim() === '' ? null : Number(s));
const str = (s) => (s.trim() === '' ? null : s.trim());

function build(csv) {
  const rows = parseCsv(csv).slice(1);
  const days = new Map();
  const seen = new Set();
  for (const r of rows) {
    const day = Number(r[0]);
    if (!days.has(day)) days.set(day, { day, areas: r[1].trim(), exercises: [] });
    const name = r[2].trim();
    const base = `d${day}-${slug(name)}`;
    let id = base, n = 1;
    while (seen.has(id)) id = `${base}-${++n}`;
    seen.add(id);
    days.get(day).exercises.push({
      id, name, warmup: /^warm up:/i.test(name),
      sets: num(r[3]), reps: num(r[4]), weightLb: num(r[5]), timeMin: num(r[6]),
      rest: str(r[7]), notes: str(r[8]),
    });
  }
  return {
    schemaVersion: 1,
    source: { spreadsheetId: '1vfiCFaBWlTc-K-sxayqttrKzbzbo45z-y4GoTqgkQwk', tab: 'Expanded Routine' },
    days: [...days.values()].sort((a, b) => a.day - b.day),
  };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const out = build(fs.readFileSync(path.join(root, 'data', 'expanded-routine.csv'), 'utf8'));
  fs.writeFileSync(path.join(__dirname, 'fixture-routine.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('wrote dev/fixture-routine.json');
}
module.exports = { build };
