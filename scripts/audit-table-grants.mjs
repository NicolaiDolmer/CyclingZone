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
function name(raw) {
  if (/"[^"]*[A-Z][^"]*"/.test(raw)) throw Error('Mixed-case quoted identifiers require explicit parser support; do not guess object names.');
  const value = raw.trim().replaceAll('"', '').toLowerCase();
  return value.includes('.') ? value : `public.${value}`;
}
function freshAcl() { return new Map([...ROLES, 'public'].map(r => [r, new Set()])); }

export function auditSource(source) {
  const findings = [];
  const statements = splitStatements(source);
  const tables = new Map();
  for (const { text } of statements) {
    const m = text.match(new RegExp(`^CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${NAME})(?=\\s|\\()`, 'i'));
    if (m && name(m[1]).startsWith('public.')) tables.set(name(m[1]), { text, rls: false, policies: [] });
    else if (/\bCREATE\s+(?:UNLOGGED\s+)?TABLE\b/i.test(text) && !m) findings.push('Unsupported dynamic CREATE TABLE: use auditable top-level DDL.');
  }
  if (!tables.size) return findings;
  const contracts = new Map();
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/^\s*--\s*data-api-access:\s*(.+)$/);
    if (!m) continue;
    try {
      const contract = JSON.parse(m[1]);
      if (typeof contract.table !== 'string' || !contract.reason?.trim()) throw Error('table and reason required');
      if (contracts.has(name(contract.table))) throw Error('duplicate declaration');
      contracts.set(name(contract.table), contract);
    } catch (error) { findings.push(`Invalid data-api-access: ${error.message}`); }
  }
  const acls = new Map(), resets = new Map();
  const objectKey = (kind, table) => `${kind}:${table}`;
  for (const { text } of statements) {
    const rls = text.match(new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${NAME})\\s+(ENABLE|DISABLE)\\s+ROW\\s+LEVEL\\s+SECURITY$`, 'i'));
    if (rls && tables.has(name(rls[1]))) tables.get(name(rls[1])).rls = rls[2].toUpperCase() === 'ENABLE';
    const policy = text.match(new RegExp(`^CREATE\\s+POLICY\\s+(?:"[^"]+"|\\w+)\\s+ON\\s+(${NAME})(?:\\s+AS\\s+(?:PERMISSIVE|RESTRICTIVE))?(?:\\s+FOR\\s+(SELECT|INSERT|UPDATE|DELETE|ALL))?(?:\\s+TO\\s+(.+?))?\\s+(?:USING|WITH\\s+CHECK)\\b`, 'i'));
    if (policy && tables.has(name(policy[1]))) tables.get(name(policy[1])).policies.push({ name: text.match(/^CREATE\s+POLICY\s+("[^"]+"|\w+)/i)[1].replaceAll('"',''), op: (policy[2] || 'ALL').toUpperCase(), roles: (policy[3] || 'public').split(',').map(x => x.trim().replaceAll('"', '').toLowerCase()) });
    const dropPolicy = text.match(new RegExp(`^DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?("[^"]+"|\\w+)\\s+ON\\s+(${NAME})$`, 'i'));
    if (dropPolicy && tables.has(name(dropPolicy[2]))) {
      const state = tables.get(name(dropPolicy[2]));
      state.policies = state.policies.filter(p => p.name !== dropPolicy[1].replaceAll('"',''));
    }
    const grant = text.match(new RegExp(`^(GRANT|REVOKE)\\s+(.+?)\\s+ON\\s+(?:(TABLE|SEQUENCE)\\s+)?(.+?)\\s+(?:TO|FROM)\\s+(.+)$`, 'i'));
    if (grant) {
      const [, action, rawOps, rawKind, rawNames, rawRoles] = grant;
      const kind = (rawKind || 'TABLE').toUpperCase();
      const all = /^ALL(?:\s+PRIVILEGES)?$/i.test(rawOps.trim());
      const ops = all ? (kind === 'SEQUENCE' ? SEQUENCE_OPS : TABLE_OPS) : rawOps.split(',').map(x => x.trim().toUpperCase());
      for (const rawName of rawNames.split(',')) {
        if (!new RegExp(`^${NAME}$`, 'i').test(rawName.trim())) continue;
        const key = objectKey(kind, name(rawName));
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
    if (/^(?:DO|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION)\b/i.test(text) && /\b(?:GRANT|REVOKE|CREATE\s+POLICY|DISABLE\s+ROW)\b/i.test(text)) findings.push('Unsupported dynamic privilege/policy DDL: verify it explicitly; do not broaden grants to silence this audit.');
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

function main() {
  const args = process.argv.slice(2);
  let files;
  if (args[0] === '--base') {
    if (args.length !== 2) throw Error('Usage: --base COMMIT or SQL_FILE...');
    const base = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${args[1]}^{commit}`], { encoding: 'utf8' }).trim();
    files = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', '-z', base, 'HEAD', '--', 'database'], { encoding: 'utf8' }).split('\0').filter(p => p.endsWith('.sql'));
  } else {
    if (!args.length || args.some(a => a.startsWith('--'))) throw Error('Usage: audit-table-grants.mjs --base COMMIT | SQL_FILE...');
    files = args;
  }
  const results = files.map(file => ({ file, findings: auditSource(readFileSync(file, 'utf8')) }));
  for (const result of results) for (const finding of result.findings) console.error(`${result.file}: ${finding}`);
  const count = results.reduce((n,r) => n + r.findings.length, 0);
  console.log(`Table grant audit: ${files.length} SQL files, ${count} findings. Static check only; catalog/policy semantics require read-only verification.`);
  process.exitCode = count ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
