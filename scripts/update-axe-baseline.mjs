import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_PATH, baselineFromReports, reduceBaseline } from './lib/axe-ratchet.mjs';
import { axeInputHash } from './lib/axe-inputs.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const capture = process.argv.includes('--initialize');
if (capture && process.env.GITHUB_ACTIONS === 'true') throw Error('Initial baseline capture is local/reviewed only');
const folder = path.resolve(process.argv.find(arg => arg.startsWith('--reports='))?.slice(10) ?? path.join(root, 'frontend/test-results'));
const baselinePath = path.join(root, BASELINE_PATH);
let existing;
try { existing = JSON.parse(await readFile(baselinePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (capture === Boolean(existing)) throw Error(capture ? 'Cannot overwrite an existing baseline' : 'Missing baseline; use explicit --initialize for first capture');
const reports = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(target);
    else if (entry.isFile() && entry.name === 'axe-scan.json') reports.push(JSON.parse(await readFile(target, 'utf8')));
  }
}
await visit(folder);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (reports.some(report => report.revision !== revision)) throw Error('Stale scan revision; rerun all axe cases on current HEAD');
const currentInputHash = axeInputHash(root);
if (reports.some(report => report.inputHash !== currentInputHash)) throw Error('Stale scan build/source inputs; rerun all axe cases');
const next = capture ? baselineFromReports(reports) : reduceBaseline(existing, reports);
await writeFile(baselinePath, JSON.stringify(next, null, 2) + '\n');
console.log(`${capture ? 'Initialized' : 'Reduced'} ${Object.keys(next.cases).length} cases; review and commit the baseline diff.`);
