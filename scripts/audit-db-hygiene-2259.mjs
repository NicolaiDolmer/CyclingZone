#!/usr/bin/env node
// audit-db-hygiene-2259.mjs — READ-ONLY audit for #2259 (Supabase DB-hygiejne):
// backup_*-tabel-ophobning + unindexed foreign keys, opdelt hot-path vs. resten.
//
//   infisical run --env=prod -- node scripts/audit-db-hygiene-2259.mjs
//
// Why: #2259 blev oprettet 10/7 med ~20 backup_*-tabeller og 62 unindexed FKs
// (Supabase advisors). Tallet er kun vokset siden (23 pr. 19/7, 59 pr. 30/8) —
// backup-tabeller dominerer nu security-advisor-støjen (65 af 101
// rls_enabled_no_policy). Denne audit gør begge dele MÅLBARE så ejeren kan
// beslutte konkret drop-/index-liste ud fra tal, ikke fornemmelser.
//
// Dette script sletter INTET og opretter INGEN indexes. Det:
//   1. Lister hver backup_*-tabel i public med alder (udledt af det indlejrede
//      datostempel i navnet, YYYYMMDD eller YYYY_MM_DD — findes intet, flages
//      "dato ukendt") og et EKSAKT rækketal (COUNT(*), ikke pg_stat-estimatet —
//      se advarslen i sektion 1, mange af disse tabeller viser n_live_tup=0
//      fordi de aldrig er blevet ANALYZE't efter deres engangs-CTAS/INSERT).
//   2. Lister unindexed foreign keys (samme "ingen dækkende index på FK-kolonnen"
//      -logik som Supabase-advisoren) og SKELNER hot-path-tabeller (spiller-
//      vendte flows, #2259's egen liste) fra admin/log/øvrigt — issuets
//      acceptkriterie er eksplicit "ikke blindt på alle".
//
// Credentials kommer fra SUPABASE_DB_URL via Infisical (PG* env, aldrig printet)
// — samme kanal som db-backup.mjs. psqlJson kører kun SELECTs.

import { requireEnv, pgEnvFromDsn, describeTarget, psqlJson } from './db-lib.mjs';

const log = (...a) => console.error(...a); // fremdrift → stderr; rapport → stdout

const dsn = requireEnv('SUPABASE_DB_URL');
const pgEnv = pgEnvFromDsn(dsn);
log(`▶ Audit target : ${describeTarget(pgEnv)}`);
log(`▶ Mode         : READ-ONLY (ingen DROP, ingen CREATE INDEX, ingen writes)\n`);

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Hot-path-tabeller per #2259 (spiller-vendte flows) — resten er admin/log eller
// lavere-prioritet og skal IKKE have index bare for at gøre en advisor grøn.
const HOT_PATH_TABLES = new Set([
  'auctions',
  'swap_offers',
  'transfer_offers',
  'scout_assignments',
  'pending_race_results',
  'riders',
  'teams',
  'finance_transactions',
]);
// Eksplicit nævnt i issuet som admin/log-eksempler (kan vente ubegrænset).
const ADMIN_LOG_TABLES = new Set(['admin_log', 'import_log', 'board_request_log']);

console.log('═'.repeat(78));
console.log('DB-HYGIEJNE AUDIT #2259 — backup-tabeller + unindexed foreign keys');
console.log('═'.repeat(78));

// ── SEKTION 1: backup_*-tabeller ────────────────────────────────────────────
console.log(`\n${'─'.repeat(78)}`);
console.log('1. BACKUP_*-TABELLER I PUBLIC');
console.log('─'.repeat(78));

const backupTables = psqlJson(`
  SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname LIKE 'backup\\_%'
`, pgEnv);

if (backupTables.length === 0) {
  console.log('\nIngen backup_*-tabeller fundet i public. Rene forhold — intet at gøre her.');
} else {
  const names = backupTables.map((t) => t.table_name);

  // Ægte rækketal via COUNT(*), IKKE pg_stat_user_tables.n_live_tup — den estimering
  // er kun opdateret efter ANALYZE, og mange af disse engangs-backup-tabeller er
  // aldrig blevet analyseret (samme fejlklasse som db-health.sql check 5:
  // never_analyzed_table). Verificeret 30/8: op til 55.450 reelle rækker viste 0.
  const rowCountSql = names
    .map((n) => `SELECT ${sqlStr(n)}::text AS table_name, count(*)::bigint AS actual_rows FROM "${n}"`)
    .join('\nUNION ALL\n');
  const rowCounts = psqlJson(rowCountSql, pgEnv);
  const rowsByName = Object.fromEntries(rowCounts.map((r) => [r.table_name, Number(r.actual_rows)]));

  // Alder udledes af et indlejret datostempel i navnet (YYYYMMDD eller
  // YYYY_MM_DD). Postgres gemmer ingen tabel-oprettelsestidspunkt i kataloget
  // (ingen created_at-kolonne findes for relationer), så dette er best-effort —
  // tabeller navngivet kun efter issue-nummer (fx backup_4215_races) har intet
  // datostempel og flages eksplicit som "dato ukendt" i stedet for at blive gættet.
  const dateRe = /(20\d{2})_?(0[1-9]|1[0-2])_?(0[1-9]|[12]\d|3[01])/;
  const today = new Date();
  const rows = names.map((name) => {
    const m = name.match(dateRe);
    const isoDate = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    const ageDays = isoDate
      ? Math.round((today - new Date(isoDate + 'T00:00:00Z')) / 86400000)
      : null;
    return { name, isoDate, ageDays, rows: rowsByName[name] ?? 0 };
  });

  // Sortér ældst først; "dato ukendt" samlet til sidst (kan ikke rangeres på alder).
  rows.sort((a, b) => {
    if (a.isoDate && b.isoDate) return a.isoDate.localeCompare(b.isoDate) || a.name.localeCompare(b.name);
    if (a.isoDate) return -1;
    if (b.isoDate) return 1;
    return a.name.localeCompare(b.name);
  });

  const dated = rows.filter((r) => r.isoDate);
  const undated = rows.filter((r) => !r.isoDate);
  const totalRows = rows.reduce((sum, r) => sum + r.rows, 0);

  console.log(`\n${rows.length} backup_*-tabel(ler) fundet. Samlet ${totalRows.toLocaleString('da-DK')} rækker på tværs af dem.\n`);
  console.log(`  ${'tabel'.padEnd(56)} ${'alder'.padEnd(10)} rækker`);
  console.log(`  ${'-'.repeat(56)} ${'-'.repeat(10)} ------`);
  for (const r of dated) {
    console.log(`  ${r.name.padEnd(56)} ${(r.ageDays + ' dage').padEnd(10)} ${String(r.rows).padStart(6)}   (${r.isoDate})`);
  }
  if (undated.length) {
    console.log(`\n  -- dato ukendt (intet datostempel i navnet, kun issue-nummer) --`);
    for (const r of undated) {
      console.log(`  ${r.name.padEnd(56)} ${'ukendt'.padEnd(10)} ${String(r.rows).padStart(6)}`);
    }
  }

  console.log(`\n  Ældste (dateret): ${dated[0]?.name ?? '(ingen daterede)'} — ${dated[0]?.ageDays ?? '—'} dage`);
  console.log(`  Nyeste (dateret): ${dated[dated.length - 1]?.name ?? '(ingen daterede)'} — ${dated[dated.length - 1]?.ageDays ?? '—'} dage`);
  console.log(`  Dato ukendt      : ${undated.length} tabel(ler) (${undated.map((r) => r.name).join(', ')})`);
}

// ── SEKTION 2: unindexed foreign keys ───────────────────────────────────────
console.log(`\n${'─'.repeat(78)}`);
console.log('2. UNINDEXED FOREIGN KEYS');
console.log('─'.repeat(78));
console.log('\nSamme logik som Supabase-advisoren "unindexed_foreign_keys": FK-kolonnen(erne)');
console.log('har intet index hvor de udgør et ledende præfiks. Multi-kolonne-FK\'er tælles');
console.log('som ét fund pr. constraint (kolonnerne listes samlet).\n');

const unindexedFks = psqlJson(`
  WITH fk AS (
    SELECT con.oid AS con_oid, con.conname, con.conrelid, con.conkey
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
     WHERE con.contype = 'f' AND ns.nspname = 'public'
  ),
  fk_cols AS (
    SELECT f.con_oid, f.conname, f.conrelid,
           array_agg(k.attnum ORDER BY k.ord) AS fk_attnums
      FROM fk f
      JOIN LATERAL unnest(f.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
     GROUP BY f.con_oid, f.conname, f.conrelid
  ),
  covered AS (
    -- Daekket hvis der findes ET index hvis ledende kolonner (praefiks) matcher
    -- FK-kolonnerne i samme raekkefoelge - det er det Postgres reelt kan bruge
    -- til join/DELETE-opslag paa FK-siden.
    SELECT fc.con_oid
      FROM fk_cols fc
      JOIN pg_index i ON i.indrelid = fc.conrelid
     WHERE (i.indkey::int2[])[0:array_length(fc.fk_attnums,1)-1] = fc.fk_attnums
  )
  SELECT
    fc.conrelid::regclass::text AS table_name,
    fc.conname AS constraint_name,
    (SELECT string_agg(a.attname, ', ' ORDER BY x.ord)
       FROM unnest(fc.fk_attnums) WITH ORDINALITY AS x(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = fc.conrelid AND a.attnum = x.attnum) AS fk_columns
    FROM fk_cols fc
   WHERE fc.con_oid NOT IN (SELECT con_oid FROM covered)
   ORDER BY table_name, constraint_name
`, pgEnv);

const classify = (table) => {
  if (HOT_PATH_TABLES.has(table)) return 'HOT-PATH';
  if (ADMIN_LOG_TABLES.has(table)) return 'ADMIN/LOG';
  return 'ØVRIGT';
};

const hot = unindexedFks.filter((r) => classify(r.table_name) === 'HOT-PATH');
const adminLog = unindexedFks.filter((r) => classify(r.table_name) === 'ADMIN/LOG');
const other = unindexedFks.filter((r) => classify(r.table_name) === 'ØVRIGT');

console.log(`${unindexedFks.length} unindexed FK-constraint(s) i alt: ${hot.length} hot-path, ${adminLog.length} admin/log, ${other.length} øvrigt.\n`);

const printGroup = (label, list) => {
  console.log(`  -- ${label} (${list.length}) --`);
  if (list.length === 0) {
    console.log('    (ingen)');
    return;
  }
  for (const r of list) {
    console.log(`    ${(r.table_name + '.' + r.fk_columns).padEnd(56)} ${r.constraint_name}`);
  }
};

printGroup(`HOT-PATH — kandidater til covering-index (${[...HOT_PATH_TABLES].join(', ')})`, hot);
console.log('');
printGroup('ADMIN/LOG — kan vente ubegraenset (issuets egne eksempler)', adminLog);
console.log('');
printGroup('ØVRIGT — hverken hot-path eller admin/log; vurdér fra sag til sag', other);

// Optælling pr. hot-path-tabel, så prioriteringen er let at se på ét blik.
if (hot.length) {
  console.log('\n  Hot-path fordelt pr. tabel:');
  const byTable = {};
  for (const r of hot) byTable[r.table_name] = (byTable[r.table_name] || 0) + 1;
  for (const t of [...HOT_PATH_TABLES]) {
    if (byTable[t]) console.log(`    ${t.padEnd(24)} ${byTable[t]}`);
  }
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(78)}`);
console.log('SUMMARY (til beslutningsgrundlag — ingen ændringer er lavet)');
console.log('═'.repeat(78));
console.log(`  backup_*-tabeller     : ${backupTables.length}`);
console.log(`  unindexed FKs i alt   : ${unindexedFks.length}  (hot-path ${hot.length} / admin-log ${adminLog.length} / øvrigt ${other.length})`);
console.log(`\n  (Read-only audit. Ingen rækker/tabeller/indexes ændret. Drop og index-tilføjelse`);
console.log('  er separate, ejer-godkendte skridt — se #2259.)\n');
