#!/usr/bin/env node
// Forward audit for new public tables. No DB connection and no SQL execution.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './lint-migration-idempotency.mjs';

const ROLES = ['anon', 'authenticated', 'service_role'];
const TABLE_OPS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const SEQUENCE_OPS = ['USAGE', 'SELECT', 'UPDATE'];
const IDENT = '(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)';
const NAME = `(?:${IDENT}\\.)?${IDENT}`;
function name(raw, unchangedLegacy = false) {
  if (/"[^"]*[A-Z][^"]*"/.test(raw)) {
    if (unchangedLegacy) return null;
    throw Error('Mixed-case quoted identifiers require explicit parser support; do not guess object names.');
  }
  const value = raw.trim().replaceAll('"', '').toLowerCase();
  return value.includes('.') ? value : `public.${value}`;
}
function freshAcl() { return new Map([...ROLES, 'public'].map(r => [r, new Set()])); }
function createdTable(text, legacy = false) {
  const m = text.match(new RegExp(`^CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${NAME})(?=\\s|\\()`, 'i'));
  if (legacy && m && /"[^"]*[A-Z][^"]*"/.test(m[1])) return null;
  return m ? name(m[1]) : null;
}

export function auditSource(source, { checkNewTables = true, existingTables = new Set(), existingStatements = new Set(), exposureSource = source } = {}) {
  const findings = [];
  const statements = splitStatements(source);
  const tables = new Map();
  for (const { text } of statements) {
    if (existingStatements.has(text)) continue;
    const table = createdTable(text);
    if (checkNewTables && table?.startsWith('public.') && !existingTables.has(table)) tables.set(table, { text, rls: false, policies: [] });
    else if (checkNewTables && !existingStatements.has(text) && /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\b/i.test(text) && !table) findings.push('Unsupported dynamic CREATE TABLE: use auditable top-level DDL.');
  }
  // Exposure checks apply even without a CREATE TABLE in the same file.
  for (const { text } of splitStatements(exposureSource)) {
    if (/^GRANT\b/i.test(text) || /^ALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(text)) {
      const to = text.match(/\bTO\s+(.+)$/i);
      const clientRoles = to && /(?:^|,)\s*(?:GROUP\s+)?"?(?:anon|authenticated|public)"?(?=\s*(?:,|WITH\b|GRANTED\b|$))/i.test(to[1]);
      if (clientRoles && (/\bON\s+ALL\s+(?:TABLES|SEQUENCES|FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\b/i.test(text)
        || /^ALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(text))) {
        findings.push('Broad client grants/default privileges are not permitted: declare access per object.');
      }
      const standalone = text.match(/^(?:GRANT)\s+.+?\s+ON\s+(?:(TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|SCHEMA)\s+)?(.+?)\s+TO\s+(.+)$/i);
      if (standalone && (!standalone[1] || standalone[1].toUpperCase() === 'TABLE')
        && /(?:^|,)\s*(?:GROUP\s+)?"?(?:anon|public)"?(?=\s*(?:,|WITH\b|GRANTED\b|$))/i.test(standalone[3])) {
        for (const target of standalone[2].split(',').map(raw => raw.trim().replace(/^ONLY\s+/i, ''))) {
          if (!new RegExp(`^${NAME}$`, 'i').test(target)) continue;
          const table = name(target);
          if (table.startsWith('public.') && !tables.has(table)) findings.push(`${table}: anonymous/PUBLIC grant needs an explicit reviewed access decision; no new-table contract here.`);
        }
      }
    }
    if (/^(?:SELECT|WITH)\b/i.test(text) && /\bINTO\s+(?:(?:TEMP(?:ORARY)?|UNLOGGED)\s+)?(?:TABLE\s+)?"?public"?\./i.test(text)) {
      findings.push('SELECT INTO public creates a table outside the access template; use explicit CREATE TABLE.');
    }
    if (/^ALTER\s+TABLE\b/i.test(text) && /\bSET\s+SCHEMA\s+"?public"?$/i.test(text)) {
      findings.push('Moving a table into public requires an explicit access/RLS review.');
    }
  }
  if (!tables.size) return findings;
  const contracts = new Map();
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/^\s*--\s*data-api-access:\s*(.+)$/);
    if (!m) continue;
    try {
      const contract = JSON.parse(m[1]);
      if (typeof contract.table !== 'string' || !contract.reason?.trim()) throw Error('table and reason required');
      if (!tables.has(name(contract.table, true))) continue;
      if (contracts.has(name(contract.table))) throw Error('duplicate declaration');
      contracts.set(name(contract.table), contract);
    } catch (error) { findings.push(`Invalid data-api-access: ${error.message}`); }
  }
  const acls = new Map(), resets = new Map();
  const objectKey = (kind, table) => `${kind}:${table}`;
  for (const { text } of statements) {
    // Unsupported unchanged objects cannot satisfy a new supported table's
    // contract. Ignore their names, while newly added forms still fail closed.
    const objectName = raw => name(raw, existingStatements.has(text));
    const rls = text.match(new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${NAME})\\s+(ENABLE|DISABLE)\\s+ROW\\s+LEVEL\\s+SECURITY$`, 'i'));
    if (rls && tables.has(objectName(rls[1]))) tables.get(objectName(rls[1])).rls = rls[2].toUpperCase() === 'ENABLE';
    const policy = text.match(new RegExp(`^CREATE\\s+POLICY\\s+(?:"[^"]+"|\\w+)\\s+ON\\s+(${NAME})(?:\\s+AS\\s+(?:PERMISSIVE|RESTRICTIVE))?(?:\\s+FOR\\s+(SELECT|INSERT|UPDATE|DELETE|ALL))?(?:\\s+TO\\s+(.+?))?\\s+(?:USING|WITH\\s+CHECK)\\b`, 'i'));
    if (policy && tables.has(objectName(policy[1]))) tables.get(objectName(policy[1])).policies.push({ name: text.match(/^CREATE\s+POLICY\s+("[^"]+"|\w+)/i)[1].replaceAll('"',''), op: (policy[2] || 'ALL').toUpperCase(), roles: (policy[3] || 'public').split(',').map(x => x.trim().replaceAll('"', '').toLowerCase()) });
    const dropPolicy = text.match(new RegExp(`^DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?("[^"]+"|\\w+)\\s+ON\\s+(${NAME})$`, 'i'));
    if (dropPolicy && tables.has(objectName(dropPolicy[2]))) {
      const state = tables.get(objectName(dropPolicy[2]));
      state.policies = state.policies.filter(p => p.name !== dropPolicy[1].replaceAll('"',''));
    }
    const grant = text.match(new RegExp(`^(GRANT|REVOKE)\\s+(.+?)\\s+ON\\s+(?:(TABLE|SEQUENCE)\\s+)?(.+?)\\s+(?:TO|FROM)\\s+(.+)$`, 'i'));
    if (grant) {
      const [, action, rawOps, rawKind, rawNames, rawRoles] = grant;
      const kind = (rawKind || 'TABLE').toUpperCase();
      const all = /^ALL(?:\s+PRIVILEGES)?$/i.test(rawOps.trim());
      const ops = all ? (kind === 'SEQUENCE' ? SEQUENCE_OPS : TABLE_OPS) : rawOps.split(',').map(x => x.trim().toUpperCase());
      for (const rawName of rawNames.split(',')) {
        if (!new RegExp(`^${NAME}$`, 'i').test(rawName.trim().replace(/^ONLY\s+/i, ''))) continue;
        const object = objectName(rawName.replace(/^ONLY\s+/i, ''));
        if (!object) continue;
        const key = objectKey(kind, object);
        if (!acls.has(key)) { acls.set(key, freshAcl()); resets.set(key, new Set()); }
        for (const role of rawRoles.split(',').map(x => x.trim().replaceAll('"', '').toLowerCase())) {
          if (!acls.get(key).has(role)) continue;
          const set = acls.get(key).get(role);
          for (const op of ops) {
            if (action.toUpperCase() === 'GRANT') set.add(op); else set.delete(op);
          }
          if (action.toUpperCase() === 'REVOKE' && all) resets.get(key).add(role);
        }
      }
    }
    if (!existingStatements.has(text) && /^(?:DO|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION)\b/i.test(text) && /\b(?:GRANT|REVOKE|CREATE\s+POLICY|DISABLE\s+ROW)\b/i.test(text)) findings.push('Unsupported dynamic privilege/policy DDL: verify it explicitly; do not broaden grants to silence this audit.');
  }
  function checkAccess(kind, object, roles) {
    const key = objectKey(kind, object), acl = acls.get(key) || freshAcl();
    for (const role of [...ROLES, 'public']) {
      if (!resets.get(key)?.has(role)) findings.push(`${object}: explicitly REVOKE ALL from ${role} before granting intended access (defaults are unknown).`);
    }
    for (const role of ROLES) {
      const expected = roles?.[role];
      if (!Array.isArray(expected) || expected.some(op => !(kind === 'SEQUENCE' ? SEQUENCE_OPS : TABLE_OPS).includes(op))) {
        findings.push(`${object}: declare explicit operations or [] for ${role}.`); continue;
      }
      for (const op of expected) if (!acl.get(role).has(op) && !acl.get('public').has(op)) findings.push(`${object}: missing ${role} ${op} grant.`);
      for (const op of new Set([...acl.get(role), ...acl.get('public')])) if (!expected.includes(op)) findings.push(`${object}: undeclared ${role} ${op} grant.`);
    }
    if (acl.get('public').size) findings.push(`${object}: undeclared PUBLIC access is not permitted by this template.`);
  }
  for (const [table, state] of tables) {
    const contract = contracts.get(table);
    if (!contract) { findings.push(`${table}: new public table requires a data-api-access declaration.`); continue; }
    checkAccess('TABLE', table, contract.roles);
    if (!state.rls) findings.push(`${table}: enable RLS in the same migration.`);
    for (const role of ['anon', 'authenticated']) for (const op of contract.roles?.[role] || []) {
      if (['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(op) && !state.policies.some(p => (p.roles.includes(role) || p.roles.includes('public')) && (p.op === op || p.op === 'ALL'))) findings.push(`${table}: missing ${role} ${op} policy.`);
    }
    const sequences = contract.sequences || {};
    if (/\b(?:smallserial|serial|bigserial|nextval)\b/i.test(state.text) && !Object.keys(sequences).length) findings.push(`${table}: sequence-backed defaults require a sequence access declaration and explicit grants.`);
    for (const m of state.text.matchAll(new RegExp(`(?:\\(|,)\\s*(${IDENT})\\s+(?:smallserial|serial|bigserial)\\b`, 'gi'))) {
      const sequence = `${table}_${m[1].replaceAll('"','')}_seq`;
      if (!Object.hasOwn(sequences, sequence)) findings.push(`${table}: declare the serial sequence ${sequence}.`);
    }
    for (const m of state.text.matchAll(/\bnextval\s*\(\s*'([^']+)'/gi)) {
      if (!Object.hasOwn(sequences, name(m[1]))) findings.push(`${table}: declare the referenced sequence ${name(m[1])}.`);
    }
    for (const [sequence, roles] of Object.entries(sequences)) {
      checkAccess('SEQUENCE', name(sequence), roles);
      for (const role of ROLES) if (contract.roles?.[role]?.includes('INSERT') && !roles?.[role]?.some(op => ['USAGE', 'UPDATE'].includes(op))) findings.push(`${table}: ${role} INSERT requires ${sequence} USAGE (or UPDATE).`);
    }
  }
  return findings;
}

export function auditChangedSource(source, previousSource = null) {
  if (previousSource === null) return auditSource(source);
  // Legacy CREATE TABLE contracts are not re-litigated after an unrelated edit.
  // A new table in an existing file still needs the entire access contract.
  // Read the whole current file for its declaration, RLS, policies and grants;
  // exposure findings are limited to added statements to avoid legacy noise.
  const previous = new Set(splitStatements(previousSource).map(s => s.text));
  // Unchanged unsupported identifiers belong to the legacy scanner's scope.
  // A new/modified unsupported CREATE still throws in auditSource above.
  const existingTables = new Set([...previous].map(text => createdTable(text, true)).filter(Boolean));
  const currentStatements = splitStatements(source);
  const addedStatements = currentStatements.filter(s => !previous.has(s.text));
  const added = addedStatements.map(s => s.text).join(';\n');
  const recreations = [];
  for (const [index, { text }] of currentStatements.entries()) {
    if (previous.has(text)) continue;
    const drop = text.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+(?:CASCADE|RESTRICT))?$/i);
    if (!drop) continue;
    for (const raw of drop[1].split(',')) {
      const table = name(raw);
      if (existingTables.has(table) && currentStatements.slice(index + 1).some(s => createdTable(s.text, true) === table)) recreations.push(`${table}: table recreation requires an explicit access/RLS review; previous grants and policies cannot satisfy it.`);
    }
  }
  return [...recreations, ...auditSource(source, { existingTables, existingStatements: previous, exposureSource: added })];
}

function main() {
  const args = process.argv.slice(2);
  let files;
  let base;
  if (args[0] === '--base') {
    if (args.length !== 2) throw Error('Usage: --base COMMIT or SQL_FILE...');
    base = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${args[1]}^{commit}`], { encoding: 'utf8' }).trim();
    files = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', '-z', base, 'HEAD', '--', 'database'], { encoding: 'utf8' }).split('\0').filter(p => p.endsWith('.sql'));
  } else {
    if (!args.length || args.some(a => a.startsWith('--'))) throw Error('Usage: audit-table-grants.mjs --base COMMIT | SQL_FILE...');
    files = args;
  }
  const results = files.map(file => {
    let previousSource = null;
    if (base) {
      const exists = execFileSync('git', ['ls-tree', '--name-only', base, '--', file], { encoding: 'utf8' }).trim();
      if (exists) previousSource = execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
    }
    return { file, findings: auditChangedSource(readFileSync(file, 'utf8'), previousSource) };
  });
  for (const result of results) for (const finding of result.findings) console.error(`${result.file}: ${finding}`);
  const count = results.reduce((n,r) => n + r.findings.length, 0);
  console.log(`Table grant audit: ${files.length} SQL files, ${count} findings. Static check only; catalog/policy semantics require read-only verification.`);
  process.exitCode = count ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
