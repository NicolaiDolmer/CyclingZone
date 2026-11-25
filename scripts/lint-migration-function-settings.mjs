#!/usr/bin/env node
// scripts/lint-migration-function-settings.mjs
// ============================================================
// Forward-guard: no custom setting attached to a function, procedure, role or
// database in a migration.
//
// WHY (25/11, #8668): `CREATE FUNCTION ... SET cyclingzone.x = 'on'` passed
// the PG17 replay in CI, which runs as a superuser. Prod's migration role is
// not a superuser, and PostgreSQL refused the statement with
// "permission denied to set parameter". auto-migrate rolled the whole
// migration back, so the merged code ran without its schema.
//
// RULE: set a custom (dotted) setting inside the body instead:
//   PERFORM set_config('cyclingzone.x', 'on', true);
// and restore the caller's value before each return. Built-in settings such as
// `SET search_path = ''` are unaffected.
//
// Usage:
//   node scripts/lint-migration-function-settings.mjs            # database/*.sql
//   node scripts/lint-migration-function-settings.mjs file.sql   # given files
//
// Exit codes: 0 no findings, 1 at least one finding.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATEMENT_HEAD = /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)|ALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE|ROLE|USER|DATABASE))\b/i;
const CUSTOM_SETTING = /\bSET\s+("?[A-Za-z_][\w$]*"?\s*\.\s*"?[A-Za-z_][\w$]*"?)\s*(?:=|\bTO\b)/i;

/** Replace comments, quoted strings and dollar-quoted bodies with spaces, keeping newlines. */
export function stripSql(source) {
  let out = '';
  let i = 0;
  const blank = text => text.replace(/[^\n]/g, ' ');
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith('--')) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = source.indexOf(tag, i + tag.length);
      const stop = end === -1 ? source.length : end + tag.length;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (source[i] === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "'" && source[j + 1] === "'") { j += 2; continue; }
        if (source[j] === "'") break;
        j += 1;
      }
      const stop = Math.min(j + 1, source.length);
      out += "'" + blank(source.slice(i + 1, stop - 1)) + (stop - 1 > i ? "'" : '');
      i = stop;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** @returns {{file: string, line: number, setting: string}[]} */
export function findFunctionSettings(source, file = '<sql>') {
  const stripped = stripSql(source);
  const findings = [];
  let offset = 0;
  for (const statement of stripped.split(';')) {
    if (STATEMENT_HEAD.test(statement)) {
      const match = CUSTOM_SETTING.exec(statement);
      if (match) {
        const at = offset + match.index;
        const line = stripped.slice(0, at).split('\n').length;
        findings.push({ file, line, setting: match[1].replace(/\s+/g, '') });
      }
    }
    offset += statement.length + 1;
  }
  return findings;
}

function defaultFiles(root) {
  const dir = join(root, 'database');
  return readdirSync(dir)
    .filter(name => name.endsWith('.sql'))
    .map(name => join(dir, name));
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const files = process.argv.length > 2 ? process.argv.slice(2) : defaultFiles(root);
  const findings = files.flatMap(file => findFunctionSettings(readFileSync(file, 'utf8'), basename(file)));
  for (const f of findings) {
    console.error(`❌ ${f.file}:${f.line}: SET ${f.setting} on a function/role/database. Prod's migration role is not a superuser and is refused. Use PERFORM set_config('${f.setting}', ..., true) in the body (#8668).`);
  }
  if (findings.length) process.exit(1);
  console.log(`✅ ${files.length} migration file(s): no custom setting attached to a function, role or database.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
