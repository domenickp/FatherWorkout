'use strict';
// Converts the sheet snapshot (data/expanded-routine.csv) to data/routine.json.
// See docs/contracts.md section 1. Node built-ins only; output is deterministic.
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = {
  spreadsheetId: '1vfiCFaBWlTc-K-sxayqttrKzbzbo45z-y4GoTqgkQwk',
  tab: 'Expanded Routine',
};

// RFC 4180 parser: quoted fields, "" escapes, commas/newlines inside quotes.
// Returns an array of rows (arrays of strings). Fully empty lines are skipped.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = '';
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
    } else if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      endRow();
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNumber(cell, label) {
  const s = (cell === undefined ? '' : cell).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${label}: "${s}"`);
  return n;
}

function toText(cell) {
  const s = (cell === undefined ? '' : cell).trim();
  return s === '' ? null : s;
}

function buildRoutine(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error('CSV is empty');
  const header = rows[0].map((h) => h.trim());
  const col = (n) => {
    const idx = header.indexOf(n);
    if (idx < 0) throw new Error(`Missing CSV column: ${n}`);
    return idx;
  };
  const C = {
    day: col('Day'), areas: col('Areas'), name: col('Exercise'), sets: col('Sets'),
    reps: col('Reps per set'), weight: col('Weight (pounds)'), time: col('Time (minutes)'),
    rest: col('Rest between sets'), notes: col('Notes'),
  };

  const days = new Map();
  const usedIds = new Set();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const day = toNumber(r[C.day], `Day (row ${line})`);
    if (!Number.isInteger(day)) throw new Error(`Missing/invalid Day on row ${line}`);
    const name = toText(r[C.name]);
    if (name === null) throw new Error(`Missing Exercise on row ${line}`);
    const areas = toText(r[C.areas]);
    if (!days.has(day)) days.set(day, { day, areas, exercises: [] });
    const d = days.get(day);
    if (d.areas === null) d.areas = areas;

    const base = `d${day}-${slugify(name)}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);

    d.exercises.push({
      id,
      name,
      warmup: /^warm up:/i.test(name),
      sets: toNumber(r[C.sets], `Sets (row ${line})`),
      reps: toNumber(r[C.reps], `Reps (row ${line})`),
      weightLb: toNumber(r[C.weight], `Weight (row ${line})`),
      timeMin: toNumber(r[C.time], `Time (row ${line})`),
      rest: toText(r[C.rest]),
      notes: toText(r[C.notes]),
    });
  });

  return {
    schemaVersion: 1,
    source: { ...SOURCE },
    days: [...days.values()].sort((a, b) => a.day - b.day),
  };
}

function main(argv) {
  const root = path.resolve(__dirname, '..');
  const inArg = argv[0] || 'data/expanded-routine.csv';
  const outArg = argv[1] || 'data/routine.json';
  const inPath = path.resolve(root, inArg);
  const outPath = path.resolve(root, outArg);
  const routine = buildRoutine(fs.readFileSync(inPath, 'utf8'));
  fs.writeFileSync(outPath, JSON.stringify(routine, null, 2) + '\n', 'utf8');
  const count = routine.days.reduce((n, d) => n + d.exercises.length, 0);
  console.log(`Wrote ${outArg}: ${routine.days.length} days, ${count} exercises`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseCsv, buildRoutine, slugify };
