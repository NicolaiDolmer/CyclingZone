#!/usr/bin/env node
// #3645 — BACKUP AF DE TABELLER LØN- OG MANDAT-KOMPONENTERNE RØRER 23/8.
//
// HVORFOR. Drejebogen (`docs/2026-08-23-cutover-drejebog.md`) kræver et før-billede
// pr. komponent, ikke kun for race-day-flippet. Løn-genberegningen (#3393) skriver
// `riders.salary` for hele den ejede population; mandat-migrationen (#3514) skriver
// `board_profiles` og opretter/ændrer `team_board_members`. Ingen af delene kan
// regnes tilbage fra resultatet.
//
// HVAD DER BACKES OP:
//   riders             — kun de kolonner løn afhænger af eller ændrer:
//                        id, team_id, division-grundlag, base_value, market_value,
//                        current_production_value, prize_earnings_bonus, salary,
//                        contract_length, contract_end_season, is_academy, is_retired
//   board_profiles     — HELE rækken (mandat-migrationen omformer den)
//   team_board_members — HELE rækken (navnepulje + medlemmer omformes)
//
// HVOR. Tabellen `cutover_3645_backup_20260823`, oprettet af
// `database/2026-08-23-3645-cutover-backup-table.sql`. Datosuffikset er
// CUTOVER-datoen, ikke kørselsdatoen, så to kørsler samme cutover fylder samme
// tabel. Skrivningen er en upsert på (table_name, row_id) — en gentagen kørsel
// opdaterer før-billedet i stedet for at lave dubletter.
//
// VIGTIGT OM RÆKKEFØLGEN. Kør backuppen FØR genberegningerne, ikke efter. Kører
// den efter, gemmer den resultatet i stedet for udgangspunktet, og backuppen er
// værdiløs uden at nogen kan se det.
//
// TILSTANDE
//   dry-run (default, skriver ALDRIG):
//     cd backend && infisical run --env=prod -- node scripts/dev/cutoverBackup3645.mjs
//   skrivning (kræver BEGGE dele):
//     CONFIRM_BACKUP=yes infisical run --env=prod -- node scripts/dev/cutoverBackup3645.mjs --apply
//   efterprøvning af en allerede taget backup (kun SELECT):
//     infisical run --env=prod -- node scripts/dev/cutoverBackup3645.mjs --verify
//
// Backuppen er den mindst farlige mutation i hele cutoveren — den skriver kun til
// sin egen tabel og rører ingen spiller-data. Bekræftelsen er der alligevel, så
// ingen kommer til at fylde den på det forkerte tidspunkt.
//
// Refs #3645 #3393 #3514.

import { createClient } from "@supabase/supabase-js";

import { backupTableName, fmtInt } from "../lib/cutover3645.js";

const BACKUP_TABLE = backupTableName("cutover", 3645, "2026-08-23");
const WRITE_BATCH = 200;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const VERIFY_ONLY = argv.includes("--verify");
const CONFIRMED = process.env.CONFIRM_BACKUP === "yes";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kræver også miljøvariablen CONFIRM_BACKUP=yes.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

// Kolonne-udtrækket pr. kilde-tabel. `*` betyder hele rækken.
const SOURCES = [
  {
    table: "riders",
    // Løn-grundlaget (#3393 Ø4: ankerværdien) og alt lønnen skrives ind i.
    // `team_id` er med, fordi divisions-satsen slås op via holdet.
    columns:
      "id, team_id, base_value, market_value, current_production_value, prize_earnings_bonus, " +
      "salary, contract_length, contract_end_season, is_academy, is_retired",
    idColumn: "id",
    reason: "løn-genberegning (#3393)",
  },
  { table: "board_profiles", columns: "*", idColumn: "id", reason: "mandat-migration (#3514)" },
  { table: "team_board_members", columns: "*", idColumn: "id", reason: "mandat-migration (#3514)" },
];

async function selectAll(table, cols, orderCol) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function backupCounts() {
  const rows = await selectAll(BACKUP_TABLE, "table_name, row_id", "row_id");
  const byTable = {};
  for (const r of rows) byTable[r.table_name] = (byTable[r.table_name] || 0) + 1;
  return byTable;
}

console.log("=== #3645 backup før løn- og mandat-genberegning ===");
console.log(VERIFY_ONLY ? "TILSTAND: VERIFY (kun SELECT)" : APPLY ? "TILSTAND: APPLY (skriver til backup-tabellen)" : "TILSTAND: DRY-RUN (skriver intet)");
console.log(`Database     : ${projectRef}`);
console.log(`Backup-tabel : ${BACKUP_TABLE}`);

// Porten: findes tabellen? Uden den er der ingen backup, og cutoveren må ikke starte.
// Bevidst en almindelig select med limit(1) og IKKE et head/count-kald: målt mod
// staging 17/8 returnerede `{ count: "exact", head: true }` INGEN fejl for en tabel
// der ikke fandtes, så porten var tavs og scriptet væltede først længere nede.
const { error: probeErr } = await sb.from(BACKUP_TABLE).select("row_id").limit(1);
if (probeErr) {
  console.error(`\nSTOP — backup-tabellen findes ikke (eller kan ikke læses): ${probeErr.message}`);
  console.error("Kør database/2026-08-23-3645-cutover-backup-table.sql FØRST (idempotent, opretter kun en tom tabel).");
  process.exit(1);
}

if (VERIFY_ONLY) {
  const have = await backupCounts();
  console.log("\n── Indhold i backup-tabellen ──");
  let alt = 0;
  for (const src of SOURCES) {
    const n = have[src.table] || 0;
    alt += n;
    const live = await selectAll(src.table, src.idColumn, src.idColumn);
    const daekning = live.length ? Math.round((n / live.length) * 1000) / 10 : 0;
    const ok = n >= live.length;
    console.log(`${ok ? "OK  " : "MANGLER"} ${src.table.padEnd(20)} backup ${fmtInt(n).padStart(7)} · levende nu ${fmtInt(live.length).padStart(7)} · dækning ${daekning} %`);
  }
  console.log(`I alt: ${fmtInt(alt)} rækker.`);
  console.log("\nDækning under 100 % betyder enten at backuppen ikke er kørt, eller at der er");
  console.log("kommet rækker til efter den blev taget. Kør backuppen igen umiddelbart før cutoveren.");
  process.exit(0);
}

// ── Læsning + plan ──────────────────────────────────────────────────────────
const before = await backupCounts();
const planer = [];
for (const src of SOURCES) {
  const rows = await selectAll(src.table, src.columns, src.idColumn);
  planer.push({ ...src, rows });
  console.log(`\n${src.table} (${src.reason}): ${fmtInt(rows.length)} rækker · allerede i backup: ${fmtInt(before[src.table] || 0)}`);
  if (src.table === "riders") {
    const medLoen = rows.filter((r) => r.salary != null).length;
    const paaHold = rows.filter((r) => r.team_id != null).length;
    const loensum = rows.filter((r) => r.team_id != null && r.salary != null).reduce((a, r) => a + Number(r.salary), 0);
    console.log(`   med frossen løn: ${fmtInt(medLoen)} · på et hold: ${fmtInt(paaHold)} · samlet lønbyrde på hold: ${fmtInt(loensum)} CZ$`);
  }
  if (src.table === "board_profiles") {
    const byType = {};
    for (const r of rows) byType[r.plan_type] = (byType[r.plan_type] || 0) + 1;
    console.log(`   pr. plan-type: ${Object.entries(byType).map(([k, v]) => `${k} ${fmtInt(v)}`).join(" · ")}`);
  }
}

const total = planer.reduce((a, p) => a + p.rows.length, 0);
if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet. ${fmtInt(total)} rækker ville blive sikret i ${BACKUP_TABLE}.`);
  console.log("Skrivning kræver BEGGE dele: CONFIRM_BACKUP=yes i miljøet OG --apply.");
  process.exit(0);
}

// ── Skrivning ───────────────────────────────────────────────────────────────
let skrevet = 0;
for (const p of planer) {
  for (let i = 0; i < p.rows.length; i += WRITE_BATCH) {
    const batch = p.rows.slice(i, i + WRITE_BATCH).map((row) => ({
      table_name: p.table,
      row_id: row[p.idColumn],
      row_before: row,
    }));
    const { error } = await sb.from(BACKUP_TABLE).upsert(batch, { onConflict: "table_name,row_id" });
    if (error) throw new Error(`${p.table} ved ${i}: ${error.message}`);
    skrevet += batch.length;
  }
  console.log(`   ${p.table}: ${fmtInt(p.rows.length)} rækker sikret`);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
const after = await backupCounts();
let fejl = 0;
console.log("\nPost-verify:");
for (const p of planer) {
  const n = after[p.table] || 0;
  const ok = n >= p.rows.length;
  if (!ok) fejl++;
  console.log(`   ${ok ? "OK " : "FEJL"} ${p.table.padEnd(20)} ${fmtInt(n)} i backup mod ${fmtInt(p.rows.length)} læste`);
}
if (fejl) {
  console.error(`\nPOST-VERIFY FEJLEDE for ${fejl} tabel(ler). Cutoveren må IKKE fortsætte.`);
  process.exit(1);
}
console.log(`\nBackup verificeret: ${fmtInt(skrevet)} rækker skrevet, alle tabeller dækket.`);
console.log(`Rollback-SQL står i database/2026-08-23-3645-cutover-backup-table.sql.`);
