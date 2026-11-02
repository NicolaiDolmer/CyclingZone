import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseSource, memberName } from './lint-tailwind-v4.mjs';

const patchFile = 'frontend/src/data/patchNotes.js';
function literal(node) {
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node?.type)) return node.value;
  if (node?.type === 'NullLiteral') return null;
  if (node?.type === 'ArrayExpression') return node.elements.map(literal);
  if (node?.type === 'ObjectExpression') {
    const result = Object.create(null);
    for (const property of node.properties) {
      if (property.type !== 'ObjectProperty' || property.computed) throw new Error('Patch history must be literal data');
      const key = memberName(property.key);
      if (Object.hasOwn(result, key)) throw new Error(`Duplicate history key: ${key}`);
      result[key] = literal(property.value);
    }
    return result;
  }
  throw new Error('Patch history must be literal data');
}
function entries(source) {
  const tree = parseSource(source, patchFile);
  // The publishing plugin imports this module. Permit exactly its literal
  // named export; executable statements or alternate exports can change output.
  if (tree.program.directives.length || tree.program.body.length !== 1) throw new Error('Patch history must be a static PATCHES data module');
  const statement = tree.program.body[0];
  const declaration = statement.type === 'ExportNamedDeclaration' && !statement.source && statement.specifiers.length === 0 ? statement.declaration : null;
  if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const' || declaration.declarations.length !== 1 || declaration.declarations[0].id.type !== 'Identifier' || declaration.declarations[0].id.name !== 'PATCHES') throw new Error('Expected only a static PATCHES literal export');
  const result = literal(declaration.declarations[0].init);
  if (!Array.isArray(result) || result.some(entry => typeof entry.version !== 'string')) throw new Error('Invalid patch history');
  return result;
}
// Intentional corrections are audited in the PR's commits, version by version:
// [patch-history-correction:VERSION] Reason: issue/link and explanation
// This never permits deletion or reordering of a published version.
export function checkHistory(baseSource, headSource, messages = '') {
  const base = entries(baseSource), head = entries(headSource), findings = [];
  for (const list of [base, head]) if (new Set(list.map(entry => entry.version)).size !== list.length) findings.push('Duplicate patch version');
  const published = new Set(base.map(entry => entry.version));
  const firstPublished = head.findIndex(entry => published.has(entry.version));
  const suffix = firstPublished < 0 ? [] : head.slice(firstPublished);
  if (!isDeepStrictEqual(suffix.map(entry => entry.version), base.map(entry => entry.version))) findings.push('Published versions must remain ordered; new versions must be prepended');
  for (const entry of base) {
    const current = head.find(item => item.version === entry.version);
    const marker = `[patch-history-correction:${entry.version}] Reason: `;
    const approved = messages.split(/\r?\n/).some(line => line.startsWith(marker) && line.slice(marker.length).trim().length > 0);
    if (!current) findings.push(`Deleted published version ${entry.version}`);
    else if (!isDeepStrictEqual(entry, current) && !approved) findings.push(`Changed published version ${entry.version}; intentional corrections require a standalone ${marker}<audit reference and explanation>`);
  }
  return findings;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = args => {
    try {
      return execFileSync('git', ['-C', process.cwd(), ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      throw new Error('Cannot read PR base/history from git; fetch full PR history before running this guard');
    }
  };
  const base = process.argv[2];
  if (!base || !/^[a-f0-9]{40}$/.test(base)) throw new Error('Pass the immutable PR base SHA (40 hex characters)');
  const findings = checkHistory(git(['show', `${base}:${patchFile}`]), readFileSync(patchFile, 'utf8'), git(['log', '--format=%B', `${base}..HEAD`]));
  findings.forEach(finding => console.error(finding));
  console.log(`Patch history: ${findings.length} finding(s).`);
  process.exitCode = findings.length ? 1 : 0;
}
