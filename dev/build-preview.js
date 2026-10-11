// Builds dev/preview.html: src/index.html plus a mock google.script.run and routine data.
// Uses data/routine.json when it exists, otherwise dev/fixture-routine.json.
// Run: node dev/build-preview.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function build() {
  const real = path.join(root, 'data', 'routine.json');
  const routinePath = fs.existsSync(real) ? real : path.join(__dirname, 'fixture-routine.json');
  const routine = JSON.parse(fs.readFileSync(routinePath, 'utf8'));
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const mock = fs.readFileSync(path.join(__dirname, 'mock-gas.js'), 'utf8');
  const data = JSON.stringify(routine).replace(/</g, '\\u003c');
  const inject =
    '<script id="fw-dev-mock">\n/* Local preview only: not part of src/index.html */\n' +
    'window.__FW_ROUTINE__ = ' + data + ';\n' + mock + '\n</script>\n';
  const marker = '<div id="rest"';
  if (!html.includes(marker)) throw new Error('marker not found in src/index.html');
  return { html: html.replace(marker, () => inject + marker), routinePath };
}

if (require.main === module) {
  const { html, routinePath } = build();
  const out = path.join(__dirname, 'preview.html');
  fs.writeFileSync(out, html);
  console.error('routine data: ' + path.relative(root, routinePath));
  console.log(out);
}
module.exports = { build };
