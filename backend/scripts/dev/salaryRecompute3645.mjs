#!/usr/bin/env node
// #3645 / #3393 — GENBEREGNING AF LØN. DRY-RUN ER DEFAULT.
//
// HVAD DETTE SCRIPT ER, OG HVAD DET IKKE ER.
// Det ER værktøjet der læser populationen, kører den GÆLDENDE løn-formel over den,
// og fremlægger før/efter-tallene så ejeren kan se hvad en genberegning ville gøre.
// Det er IKKE stedet hvor formlen bor. Formlen designes separat med ejeren
// (beslutning Ø4/Ø5 17/8: ankerværdien som grundlag, ét globalt A kalibreret mod
// ~35 % af målt indtægt) og lever i `backend/lib/salaryBasis.js` + `contractSeed.js`.
// Scriptet KALDER dem. Det ændrer dem aldrig, og det har ingen egen kopi af dem.
//
// TO GRUNDLAG, ÉT VÆRKTØJ.
//   --basis production  (default) — den løn der kører i dag: computeFrozenSalary,
//                       altså current_production_value × divisions-satsen (#2594).
//   --basis market      — #3393's grundlag. Kræver at `lib/salaryBasis.js` og
//                       `SALARY_MARKET_MODEL` findes, dvs. at #3393 er merged.
//                       Er de der ikke, stopper scriptet og siger hvorfor i stedet
//                       for at gætte en model.
//
// Grunden til at begge findes: drejebogens gate for komponent 2 er "genberegnings-
// script dry-run mod staging". Den gate skal kunne passeres FØR #3393 merges, ellers
// er værktøjet først klar samtidig med det det skal sikre. Med `production` kan
// hele kæden (læsning, rapport, apply-porte, backup-krav) tør-køres i dag, og
// `market` slår til af sig selv den dag modulet er der.
//
// APPLY.
//   Kræver BEGGE dele: CONFIRM_SALARY_RECOMPUTE=yes i miljøet OG --apply.
//   Kræver desuden at `cutoverBackup3645.mjs` HAR kørt: scriptet tjekker at
//   backup-tabellen dækker de ryttere det er ved at skrive, og stopper ellers.
//   Idempotent: ryttere hvis løn allerede matcher, kommer ikke i planen.
//
// AFGRÆNSNING (bevidst, spejler #2083-genberegningen):
//   Kun ryttere PÅ ET HOLD med en frossen løn røres. Frie agenter har ingen frossen
//   løn at genberegne — deres viste tal er et estimat der følger formlen automatisk.
//   Pensionerede ryttere røres ikke.
//
// KØRSEL
//   dry-run mod staging:
//     cd backend && node scripts/dev/salaryRecompute3645.mjs
//   dry-run mod prod (read-only):
//     cd backend && infisical run --env=prod -- node scripts/dev/salaryRecompute3645.mjs --basis market
//   skrivning (ejer-gated på dagen):
//     CONFIRM_SALARY_RECOMPUTE=yes infisical run --env=prod -- node scripts/dev/salaryRecompute3645.mjs --basis market --apply
//
// Refs #3645 #3393 #3757 #2594 #2083.

import { createClient } from "@supabase/supabase-js";

import { computeFrozenSalary } from "../../lib/contractSeed.js";
import { backupTableName, fmtInt, fmtSigned, percentileSummary } from "../lib/cutover3645.js";

const BACKUP_TABLE = backupTableName("cutover", 3645, "2026-08-23");
const WRITE_BATCH = 100;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

const BASIS = val("--basis") || "production";
const APPLY = flag("--apply");
const CONFIRMED = process.env.CONFIRM_SALARY_RECOMPUTE === "yes";

if (!["production", "market"].includes(BASIS)) {
  console.error(`Ukendt --basis "${BASIS}". Gyldige: production, market.`);
  process.exit(1);
}
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kræver også miljøvariablen CONFIRM_SALARY_RECOMPUTE=yes.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

// ── Løn-funktionen hentes, den skrives ikke ─────────────────────────────────
// `market`-grundlaget lever i #3393. Er PR'en ikke merged, findes modulet ikke, og
// så stopper vi højlydt i stedet for at bygge en andenudgave af formlen her.
let salaryFn = null;
let basisNote = "";
if (BASIS === "production") {
  salaryFn = (rider, division) => computeFrozenSalary({ current_production_value: rider.current_production_value, division });
  basisNote = "computeFrozenSalary (contractSeed.js) — current_production_value × divisions-sats, #2594.";
} else {
  let basisMod = null;
  let konst = null;
  try {
    basisMod = await import("../../lib/salaryBasis.js");
    konst = await import("../../lib/economyConstants.js");
  } catch {
    basisMod = null;
  }
  if (!basisMod?.marketBasisSalary || !basisMod?.resolveMarketBase || !konst?.SALARY_MARKET_MODEL) {
    console.error("STOP — --basis market kræver backend/lib/salaryBasis.js + SALARY_MARKET_MODEL i economyConstants.js.");
    console.error("De findes først når #3393 er merged. Kør indtil da med --basis production.");
    console.error("Scriptet bygger IKKE sin egen udgave af formlen — den designes med ejeren (beslutning Ø4/Ø5).");
    process.exit(1);
  }
  const model = konst.SALARY_MARKET_MODEL;
  salaryFn = (rider) => basisMod.marketBasisSalary(basisMod.resolveMarketBase(rider).base, model);
  basisNote = `marketBasisSalary (salaryBasis.js) med SALARY_MARKET_MODEL fra economyConstants.js.`;
}

console.log("=== #3393 løn-genberegning ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver riders.salary)" : "TILSTAND: DRY-RUN (skriver intet)");
console.log(`Database : ${projectRef}`);
console.log(`Grundlag : ${BASIS} — ${basisNote}`);

async function selectAll(table, cols, orderCol, filterFn) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const teams = await selectAll("teams", "id, name, division, is_ai, is_test_account", "id");
const teamById = new Map(teams.map((t) => [t.id, t]));

const riders = await selectAll(
  "riders",
  "id, firstname, lastname, team_id, base_value, market_value, current_production_value, prize_earnings_bonus, salary, is_academy, is_retired",
  "id",
  (q) => q.not("team_id", "is", null).not("salary", "is", null).or("is_retired.is.null,is_retired.eq.false"),
);
console.log(`\nRyttere på et hold med frossen løn: ${fmtInt(riders.length)}`);

// ── Plan ────────────────────────────────────────────────────────────────────
const plan = [];
const deltas = [];
const perDivision = new Map();
let sumFoer = 0;
let sumEfter = 0;
let uaendret = 0;

for (const r of riders) {
  const team = teamById.get(r.team_id) || null;
  const division = team?.division ?? null;
  const foer = Number(r.salary);
  const efter = salaryFn(r, division);
  sumFoer += foer;
  sumEfter += efter;

  const key = division == null ? "ukendt" : `D${division}`;
  const d = perDivision.get(key) || { n: 0, foer: 0, efter: 0, ai: 0, menneske: 0 };
  d.n++;
  d.foer += foer;
  d.efter += efter;
  if (team?.is_ai) d.ai++; else d.menneske++;
  perDivision.set(key, d);

  if (efter === foer) { uaendret++; continue; }
  deltas.push(efter - foer);
  plan.push({
    id: r.id,
    navn: `${r.firstname} ${r.lastname}`,
    hold: team?.name ?? "(ukendt)",
    erAi: !!team?.is_ai,
    division,
    foer,
    efter,
    delta: efter - foer,
  });
}

console.log(`Ændres : ${fmtInt(plan.length)} · uændret: ${fmtInt(uaendret)}`);
console.log(`   op ${fmtInt(plan.filter((p) => p.delta > 0).length)} · ned ${fmtInt(plan.filter((p) => p.delta < 0).length)}`);
console.log(`\nSamlet lønbyrde FØR  : ${fmtInt(sumFoer)} CZ$`);
console.log(`Samlet lønbyrde EFTER: ${fmtInt(sumEfter)} CZ$`);
console.log(`Netto                : ${sumEfter - sumFoer >= 0 ? "+" : ""}${fmtInt(sumEfter - sumFoer)} CZ$ (${sumFoer ? Math.round(((sumEfter - sumFoer) / sumFoer) * 1000) / 10 : 0} %)`);

const s = percentileSummary(deltas);
if (s.n) {
  console.log(`\nLøn-delta pr. ændret rytter (CZ$): min ${fmtSigned(s.min)} · p10 ${fmtSigned(s.p10)} · p50 ${fmtSigned(s.p50)} · p90 ${fmtSigned(s.p90)} · max ${fmtSigned(s.max)}`);
}

console.log(`\nPr. division (lønbyrde før → efter):`);
for (const [key, d] of [...perDivision.entries()].sort()) {
  const pct = d.foer ? Math.round(((d.efter - d.foer) / d.foer) * 1000) / 10 : 0;
  console.log(`   ${key.padEnd(8)} n ${fmtInt(d.n).padStart(6)} (AI ${fmtInt(d.ai)} / menneske ${fmtInt(d.menneske)})  ${fmtInt(d.foer).padStart(12)} → ${fmtInt(d.efter).padStart(12)}  (${pct >= 0 ? "+" : ""}${pct} %)`);
}

// Menneske-ejede hold er dem spillerne mærker. De vises for sig, aldrig gemt i
// et samlet snit sammen med AI-holdene.
const menneske = plan.filter((p) => !p.erAi);
console.log(`\nMenneske-ejede hold: ${fmtInt(menneske.length)} ryttere ændres.`);
const stoerste = menneske.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15);
for (const p of stoerste) {
  console.log(`   ${p.navn.padEnd(28)} ${p.hold.padEnd(22)} ${fmtInt(p.foer).padStart(9)} → ${fmtInt(p.efter).padStart(9)}  (${p.delta >= 0 ? "+" : ""}${fmtInt(p.delta)})`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet.`);
  console.log(`Skrivning kræver: CONFIRM_SALARY_RECOMPUTE=yes + --apply + en kørt backup + ejerens go på dagen.`);
  process.exit(0);
}
if (!plan.length) {
  console.log("\nIntet at skrive — lønnen matcher allerede formlen. (Idempotent no-op.)");
  process.exit(0);
}

// ── Backup-porten ───────────────────────────────────────────────────────────
// En løn-genberegning kan ikke regnes tilbage fra resultatet. Uden et før-billede
// er der ingen vej hjem, så vi nægter at skrive før backuppen dækker planen.
const backupRows = await selectAll(BACKUP_TABLE, "row_id", "row_id", (q) => q.eq("table_name", "riders"));
const iBackup = new Set(backupRows.map((b) => b.row_id));
const udenBackup = plan.filter((p) => !iBackup.has(p.id));
if (udenBackup.length) {
  console.error(`\nSTOP — ${fmtInt(udenBackup.length)} af ${fmtInt(plan.length)} ryttere mangler i ${BACKUP_TABLE}.`);
  console.error("Kør cutoverBackup3645.mjs --apply FØRST. Uden før-billede er der intet rollback.");
  process.exit(1);
}
console.log(`\nBackup-porten: OK — alle ${fmtInt(plan.length)} ryttere har et før-billede.`);

// ── Skrivning ───────────────────────────────────────────────────────────────
let skrevet = 0;
for (let i = 0; i < plan.length; i += WRITE_BATCH) {
  for (const p of plan.slice(i, i + WRITE_BATCH)) {
    const { error } = await sb.from("riders").update({ salary: p.efter }).eq("id", p.id);
    if (error) throw new Error(`skrivning ${p.id}: ${error.message}`);
    skrevet++;
  }
  console.log(`   ${fmtInt(skrevet)}/${fmtInt(plan.length)}`);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
const efterRows = await selectAll("riders", "id, salary", "id", (q) => q.not("team_id", "is", null));
const efterById = new Map(efterRows.map((r) => [r.id, Number(r.salary)]));
const afvig = plan.filter((p) => efterById.get(p.id) !== p.efter);
if (afvig.length) {
  console.error(`POST-VERIFY FEJLEDE: ${fmtInt(afvig.length)} rækker matcher ikke planen.`);
  process.exit(1);
}
console.log(`\nPost-verify OK: alle ${fmtInt(plan.length)} lønninger i databasen matcher planen.`);
console.log(`Rollback-SQL: database/2026-08-23-3645-cutover-backup-table.sql (afsnittet "ROLLBACK: LØN").`);
