// #5904 · Sammenligning af schema-fingeraftryk (scripts/staging/schema-fingerprint.sql).
//
// Input er enten den FULDE liste (en `kind|navn|md5` pr. linje, fx psql -tA mod staging)
// eller et RESUME (`kind count md5` pr. linje, se SUMMARY_SQL nedenfor) - resuméet er det
// prod kan levere read-only i én lille raekke via Supabase MCP uden at dumpe hele listen.
//
//   node scripts/staging/schemaFingerprint.mjs summary <full.txt>
//   node scripts/staging/schemaFingerprint.mjs compare <a.txt> <b.txt>
//
// compare: exit 0 = identisk app-schema (alle kinds undtagen backup_table matcher).
// backup_table rapporteres altid separat (ad hoc data-backups, ikke app-schema).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BACKUP_KIND = 'backup_table';

// Samme resumé beregnet i SQL (for prod): md5 over linjerne sorteret bytevist, '\n'-joinet.
export const SUMMARY_SQL = `select kind || ' ' || count(*) || ' ' || md5(string_agg(fp, E'\\n' order by fp collate "C"))
from (<fingerprint-query>) f, lateral (select split_part(f.fp, '|', 1) as kind) k group by kind order by kind`;

export function parse(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .filter(l => !l.startsWith('['));
  if (lines.length && lines.every(l => /^[a-z_]+ \d+ [0-9a-f]{32}$/.test(l))) {
    const summary = new Map();
    for (const l of lines) { const [kind, n, h] = l.split(' '); summary.set(kind, { count: Number(n), md5: h }); }
    return { summary, full: null };
  }
  const full = lines.filter(l => /^[a-z_]+\|/.test(l));
  return { summary: summarize(full), full };
}

export function summarize(fullLines) {
  const byKind = new Map();
  for (const l of fullLines) {
    const kind = l.split('|', 1)[0];
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(l);
  }
  const out = new Map();
  for (const [kind, rows] of [...byKind].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    rows.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    out.set(kind, { count: rows.length, md5: createHash('md5').update(rows.join('\n')).digest('hex') });
  }
  return out;
}

export function compare(a, b) {
  const kinds = [...new Set([...a.summary.keys(), ...b.summary.keys()])].sort();
  const mismatched = [];
  for (const k of kinds) {
    if (k === BACKUP_KIND) continue;
    const x = a.summary.get(k), y = b.summary.get(k);
    if (!x || !y || x.md5 !== y.md5) mismatched.push({ kind: k, a: x?.count ?? 0, b: y?.count ?? 0 });
  }
  let objectDiff = null;
  if (a.full && b.full && mismatched.length) {
    const sa = new Set(a.full), sb = new Set(b.full);
    objectDiff = {
      onlyA: a.full.filter(l => !sb.has(l) && !l.startsWith(`${BACKUP_KIND}|`)),
      onlyB: b.full.filter(l => !sa.has(l) && !l.startsWith(`${BACKUP_KIND}|`)),
    };
  }
  return {
    identical: mismatched.length === 0,
    mismatched,
    backupTables: { a: a.summary.get(BACKUP_KIND)?.count ?? 0, b: b.summary.get(BACKUP_KIND)?.count ?? 0 },
    objectDiff,
  };
}

export function runCli(argv, { read = p => readFileSync(p, 'utf8'), write = s => process.stdout.write(s) } = {}) {
  const [cmd, ...files] = argv;
  if (cmd === 'summary' && files.length === 1) {
    for (const [k, v] of parse(read(files[0])).summary) write(`${k} ${v.count} ${v.md5}\n`);
    return 0;
  }
  if (cmd === 'compare' && files.length === 2) {
    const result = compare(parse(read(files[0])), parse(read(files[1])));
    write(`${JSON.stringify(result, null, 2)}\n`);
    return result.identical ? 0 : 1;
  }
  write('usage: schemaFingerprint.mjs summary <full.txt> | compare <a.txt> <b.txt>\n');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
