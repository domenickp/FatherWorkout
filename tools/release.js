'use strict';
// Release: run the tests, push the code to Apps Script, and update the EXISTING web-app
// deployment so its URL (and everyone's home-screen shortcut) stays the same.
//   npm run release -- "v3: what changed"
// Reads the deployment id from deploy.local.json (untracked; see deploy.local.json.example).
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const description = process.argv.slice(2).join(' ').trim();
if (!description) {
  console.error('usage: npm run release -- "vN: what changed"');
  process.exit(1);
}
const cfgPath = path.join(root, 'deploy.local.json');
if (!fs.existsSync(cfgPath)) {
  console.error('deploy.local.json not found. Copy deploy.local.json.example and fill in the deployment id.');
  process.exit(1);
}
const { deploymentId } = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

run('npm test');
run('clasp push --force');
run(`clasp update-deployment ${deploymentId} -d ${JSON.stringify(description)}`);
