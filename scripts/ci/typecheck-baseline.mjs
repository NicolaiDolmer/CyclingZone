#!/usr/bin/env node
// Refs #7002. Budgets are per file AND code. Run --update after fixing errors;
// increases are never accepted by --update. Initial creation needs --update.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const frontend = join(root, 'frontend');
const baselinePath = join(frontend, 'typecheck-baseline.json');

export function parseDiagnostics(output) {
  const diagnostics = [];
  for (const text of output.split(/\r?\n/)) {
    if (!text.trim()) continue;
    const match = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(text);
    if (match) {
      diagnostics.push({ file: match[1].replaceAll('\\', '/'), line: Number(match[2]),
        column: Number(match[3]), code: match[4], message: match[5] });
    } else if (!/^\s+/.test(text) || /error TS\d+:/.test(text)) {
      // Indented lines are multiline diagnostic explanations. Any other output,
      // including project/config errors without a location, must fail closed.
      throw new Error('Unrecognized compiler diagnostic: ' + text);
    }
  }
  return diagnostics;
}

function counts(diagnostics) {
  const result = {};
  for (const { file, code } of diagnostics) {
    result[file] ??= {};
    result[file][code] = (result[file][code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(result).sort().map(file => [
    file, Object.fromEntries(Object.entries(result[file]).sort()),
  ]));
}

function validateBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid baseline');
  for (const codes of Object.values(value)) {
    if (!codes || typeof codes !== 'object' || Array.isArray(codes)) throw new Error('Invalid baseline codes');
    for (const [code, count] of Object.entries(codes)) {
      if (!/^TS\d+$/.test(code) || !Number.isSafeInteger(count) || count < 1) throw new Error('Invalid baseline count');
    }
  }
  return value;
}

function executeCompiler() {
  // Resolve the installed compiler entrypoint, avoiding shell/npx downloads and
  // Windows .cmd spawning. cwd keeps diagnostics relative and platform-stable.
  const manifest = JSON.parse(readFileSync(join(frontend, 'node_modules/typescript/package.json'), 'utf8'));
  const compiler = join(frontend, 'node_modules/typescript', manifest.bin.tsc);
  return spawnSync(process.execPath, [compiler, '-p', 'tsconfig.checkjs.json', '--pretty', 'false'],
    { cwd: frontend, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function run({
  update = false, execute = executeCompiler, read = readFileSync,
  write = writeFileSync, log = console.log,
} = {}) {
  try {
    const result = execute();
    if (result.error || ![0, 1, 2].includes(result.status)) throw new Error('Compiler failed: ' + (result.error?.message ?? (result.stderr?.trim() || result.status)));
    if (result.stderr?.trim()) throw new Error('Compiler stderr: ' + result.stderr);
    const diagnostics = parseDiagnostics(result.stdout);
    if ((result.status === 0) !== (diagnostics.length === 0)) throw new Error('Compiler status/diagnostics mismatch');
    const current = counts(diagnostics);
    let baseline;
    try {
      baseline = validateBaseline(JSON.parse(read(baselinePath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT' || !update) throw error;
      write(baselinePath, JSON.stringify(current, null, 2) + '\n');
      log('Initialized baseline: ' + diagnostics.length + ' errors.');
      return 0;
    }
    const regressions = diagnostics.filter(({ file, code }) =>
      (current[file]?.[code] ?? 0) > (baseline[file]?.[code] ?? 0));
    if (regressions.length) {
      log('Typecheck regression (file/code budget exceeded):');
      for (const d of regressions.slice(0, 20)) log(d.file + ':' + d.line + ':' + d.column + ' ' + d.code + ' ' + d.message);
      if (regressions.length > 20) log('... ' + (regressions.length - 20) + ' more diagnostics in regressed groups');
      return 1;
    }
    const decreased = Object.entries(baseline).some(([file, codes]) =>
      Object.entries(codes).some(([code, count]) => (current[file]?.[code] ?? 0) < count));
    if (decreased && !update) {
      log('Errors decreased. Run node scripts/ci/typecheck-baseline.mjs --update and commit the lower baseline.');
      return 1;
    }
    if (decreased) write(baselinePath, JSON.stringify(current, null, 2) + '\n');
    log('Typecheck baseline OK: ' + diagnostics.length + ' errors in ' + Object.keys(current).length + ' files.' + (decreased ? ' Baseline lowered.' : ''));
    return 0;
  } catch (error) {
    log('Typecheck baseline failed: ' + error.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--update')) {
    console.error('Usage: node scripts/ci/typecheck-baseline.mjs [--update]');
    process.exitCode = 1;
  } else process.exitCode = run({ update: args.includes('--update') });
}
