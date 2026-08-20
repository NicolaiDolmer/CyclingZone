#!/usr/bin/env node
// backend/scripts/dev/lofterApply3746.mjs
// ============================================================================
// #3746 trin 7 — KONTROLLERET GENBEREGNING AF DE GEMTE UDVIKLINGSLOFTER.
//
// HVAD DEN GØR. Skriver `rider_derived_abilities.ability_caps` for ALLE
// ryttere der HAR en rider_derived_abilities-række, hvis gemte loft ikke
// matcher det loftet SKAL være efter trin 7's model (fladt rolle-tag, ingen
// potentiale i formlen, gulvet fjernet — se riderProgression.js's
// buildCapsForRider). Rører ÉN kolonne. Aldrig evner, aldrig typer, aldrig
// værdier, aldrig løn.
//
// SCOPE er BREDERE end #3591's søster-script (lofterApply3591.mjs, frosset):
// dér var det én afgrænset fejlgruppe, her er det HELE populationen — trin 7
// ændrede selve formlen, så ethvert gemt loft er potentielt forkert.
//
// HVORFOR DEN GENBEREGNER I STEDET FOR AT SKRIVE EN FORUDBEREGNET LISTE.
// Populationen driver mens vi arbejder (se #3591's begrundelse, samme logik
// gælder her). Værktøjet tager derfor sit eget friske øjebliksbillede og
// bygger planen forfra, hver gang det kører.
//
// TYPE-VALG + ALDERS-KONTRAKT: se backend/lib/dev/backfill3746Core.js —
// PLANLÆGNINGEN er en ren funktion derfra, delt med unit-testene og med
// --snapshot-tilstanden nedenfor. Denne fil er kun I/O-skallen.
//
// GULVET ER FJERNET I TRIN 7 (#3794, ejer 16/8): et nyt loft under rytterens
// nuværende evne er nu LOVLIGT — designet, ikke en fejl (evnen står stille
// til loftet indhenter den; ingen spiller mister evne, verificeret i
// riderProgression.js's topkommentar for GULVET ER FJERNET). Dette script
// gater derfor IKKE på det, i modsætning til #3591's søster-script. Det
// TÆLLER det (floorBreaches) som informations-metrik i dry-run-rapporten.
//
// SIKKERHEDS-KÆDEN (prod-tilstand, i den rækkefølge den udføres):
//   1. Ejer-gate i koden: dry-run er default; --apply kræver OGSÅ
//      --jeg-har-set-dry-runnet.
//   2. Frisk læsning fra prod (kun SELECT) → plan bygges forfra.
//   3. Backup FØR skrivning: hver berørt rytters gamle ability_caps sikres og
//      tælles ind i BACKUP_TABLE, som verificeres FØR første skrivning.
//   4. Batchet skrivning med {data, error}-tjek på hver batch.
//   5. Post-verify: læs tilbage fra DB og bekræft at hver skrevet række
//      matcher planen.
//   6. Idempotent: en anden kørsel finder 0 ryttere at ændre (ren formel,
//      ingen akkumuleret state).
//
// KØRSEL
//   offline dry-run mod et snapshot (INGEN DB, INGEN secrets krævet):
//     node scripts/dev/lofterApply3746.mjs --snapshot=../../docs/snapshots/3591/riders_full.json
//
//   dry-run mod prod (default, skriver ALDRIG):
//     infisical run --env=prod -- node scripts/dev/lofterApply3746.mjs
//
//   skrivning mod prod (kræver BEGGE flag):
//     infisical run --env=prod -- node scripts/dev/lofterApply3746.mjs --apply --jeg-har-set-dry-runnet
//
// Refs #3746 #3794 #3591.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildPlan, capsEqual } from "../../lib/dev/backfill3746Core.js";

const BACKUP_TABLE = "rider_caps_3746_backup_20260816";
const WRITE_BATCH = 100;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const BEKRAEFTET = args.includes("--jeg-har-set-dry-runnet");
const snapshotArg = args.find((a) => a.startsWith("--snapshot="));
const seasonArg = args.find((a) => a.startsWith("--season="));

const fmt = (n) => (n == null ? "—" : (Number.isInteger(n) ? n.toLocaleString("da-DK") : n.toFixed(2)));

function printStatsBlock(stats, label) {
  console.log(`\n=== ${label} ===`);
  console.log(`Ryttere i alt: ${fmt(stats.ridersTotal)} · med ændret loft: ${fmt(stats.ridersChanged)} (uændret: ${fmt(stats.ridersUnchanged)})`);
  console.log(`   heraf på hold: ${fmt(stats.ridersHoldChanged)} · frie agenter: ${fmt(stats.ridersFriChanged)}`);
  console.log(`Gulv-brud, DET REELLE tal (evne > det SKREVNE, taperede loft — LOVLIGT jf. #3794): ${fmt(stats.totalFloorBreaches)} pladser / ${fmt(stats.ridersWithFloorBreach)} ryttere`);
  console.log(`Gulv-brud, design-sessionens sammenligningstal (evne > rå rolle-tag, INGEN taper — forventet ~898/553): ${fmt(stats.totalFloorBreachesFlatTag)} pladser / ${fmt(stats.ridersWithFlatTagBreach)} ryttere`);
  console.log(`Løft over alle evne-pladser:     n=${fmt(stats.loeftStats.n)} · median ${fmt(stats.loeftStats.median)} · p90 ${fmt(stats.loeftStats.p90)} · max ${fmt(stats.loeftStats.max)}`);
  console.log(`Sænkning over alle evne-pladser:  n=${fmt(stats.saenkningStats.n)} · median ${fmt(stats.saenkningStats.median)} · p90 ${fmt(stats.saenkningStats.p90)} · max ${fmt(stats.saenkningStats.max)}`);
  console.log("\nPr. evne-plads (op / ned / uændret):");
  for (const k of VISIBLE_ABILITIES) {
    const a = stats.perAbility[k];
    console.log(`   ${k.padEnd(14)} op ${String(a.up).padStart(5)}  ned ${String(a.down).padStart(5)}  uændret ${String(a.unchanged).padStart(5)}   (median løft ${fmt(a.loeftStats.median)}, median sænkning ${fmt(a.saenkningStats.median)})`);
  }
  console.log("\nPr. rolleklasse (op / ned / uændret / gulv-brud):");
  for (const rc of Object.keys(stats.perRoleClass)) {
    const r = stats.perRoleClass[rc];
    console.log(`   ${rc.padEnd(12)} op ${String(r.up).padStart(6)}  ned ${String(r.down).padStart(6)}  uændret ${String(r.unchanged).padStart(6)}  gulv-brud ${String(r.floorBreaches).padStart(6)}`);
  }
}

function buildReportMarkdown(stats, label, extraLines = []) {
  const lines = [];
  lines.push(`# ${label}`);
  lines.push("");
  lines.push(...extraLines);
  lines.push("");
  lines.push(`- Ryttere i alt: **${fmt(stats.ridersTotal)}**`);
  lines.push(`- Med ændret loft: **${fmt(stats.ridersChanged)}** (uændret: ${fmt(stats.ridersUnchanged)})`);
  lines.push(`  - heraf på hold: ${fmt(stats.ridersHoldChanged)} · frie agenter: ${fmt(stats.ridersFriChanged)}`);
  lines.push(`- Gulv-brud, DET REELLE tal (evne > det skrevne, taperede loft — LOVLIGT jf. #3794): **${fmt(stats.totalFloorBreaches)}** pladser / ${fmt(stats.ridersWithFloorBreach)} ryttere`);
  lines.push(`- Gulv-brud, design-sessionens sammenligningstal (evne > rå rolle-tag, INGEN taper — forventet ~898/553): **${fmt(stats.totalFloorBreachesFlatTag)}** pladser / ${fmt(stats.ridersWithFlatTagBreach)} ryttere`);
  lines.push(`- Løft over alle evne-pladser: n=${fmt(stats.loeftStats.n)} · median **${fmt(stats.loeftStats.median)}** · p90 ${fmt(stats.loeftStats.p90)} · max ${fmt(stats.loeftStats.max)}`);
  lines.push(`- Sænkning over alle evne-pladser: n=${fmt(stats.saenkningStats.n)} · median **${fmt(stats.saenkningStats.median)}** · p90 ${fmt(stats.saenkningStats.p90)} · max ${fmt(stats.saenkningStats.max)}`);
  lines.push("");
  lines.push("## Pr. evne-plads");
  lines.push("");
  lines.push("| Evne | Op | Ned | Uændret | Median løft | Median sænkning |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const k of VISIBLE_ABILITIES) {
    const a = stats.perAbility[k];
    lines.push(`| ${k} | ${a.up} | ${a.down} | ${a.unchanged} | ${fmt(a.loeftStats.median)} | ${fmt(a.saenkningStats.median)} |`);
  }
  lines.push("");
  lines.push("## Pr. rolleklasse");
  lines.push("");
  lines.push("| Rolleklasse | Op | Ned | Uændret | Gulv-brud | Median løft | Median sænkning |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const rc of Object.keys(stats.perRoleClass)) {
    const r = stats.perRoleClass[rc];
    lines.push(`| ${rc} | ${r.up} | ${r.down} | ${r.unchanged} | ${r.floorBreaches} | ${fmt(r.loeftStats.median)} | ${fmt(r.saenkningStats.median)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── --snapshot=<sti> — OFFLINE dry-run, ingen DB, ingen secrets ─────────────
if (snapshotArg) {
  const snapshotPath = snapshotArg.slice("--snapshot=".length);
  const resolved = join(process.cwd(), snapshotPath);
  const finalPath = existsSync(resolved) ? resolved : snapshotPath;
  if (!existsSync(finalPath)) {
    console.error(`Snapshot ikke fundet: ${finalPath}`);
    process.exit(1);
  }
  console.log(`=== #3746 trin 7 — OFFLINE dry-run mod snapshot ${finalPath} ===`);

  const riders = JSON.parse(readFileSync(finalPath, "utf8"));
  let seasonNumber = seasonArg ? Number(seasonArg.slice("--season=".length)) : null;
  if (!Number.isFinite(seasonNumber)) {
    const metaPath = join(dirname(finalPath), "meta.json");
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      seasonNumber = meta.activeSeasonNumber;
      console.log(`Aktiv sæson (fra sibling meta.json): ${seasonNumber}`);
    }
  }
  if (!Number.isFinite(seasonNumber)) {
    console.error("Kan ikke bestemme aktiv sæson — angiv --season=N eller sørg for en sibling meta.json.");
    process.exit(1);
  }

  const rows = riders.map((r) => ({
    riderId: r.rider_id,
    firstname: r.firstname,
    lastname: r.lastname,
    birthdate: r.birthdate,
    potentiale: r.potentiale,
    teamId: r.team_id,
    archetypeDraw: r.archetype_draw || null,
    persistedPrimaryType: r.primary_type,
    persistedSecondaryType: r.secondary_type,
    currentAbilities: r.abilities || {},
    currentCaps: r.ability_caps || {},
  }));

  const { plan, stats } = buildPlan(rows, seasonNumber);
  printStatsBlock(stats, `DRY-RUN mod snapshot (sæson ${seasonNumber}, ${rows.length} ryttere)`);
  console.log(`\nPlan: ${plan.length} ryttere ville få skrevet et nyt loft ved en ægte kørsel.`);
  console.log("\nIngen DB rørt — dette er ren offline-planlægning.");

  const md = buildReportMarkdown(
    stats,
    "Backfill #3746 — dry-run mod snapshot",
    [
      `Snapshot: \`${finalPath}\``,
      `Aktiv sæson: ${seasonNumber}`,
      `Ryttere i snapshottet: ${rows.length}`,
      `Ryttere der ville få skrevet et nyt loft: **${plan.length}**`,
      "",
      "Gulv-brud er tælleren for hvor mange (rytter, evne)-pladser hvor den nuværende evne ligger over det nye loft — legalt jf. #3794.",
    ],
  );
  console.log(`\n--- MARKDOWN-RAPPORT ---\n${md}\n--- SLUT ---`);
  process.exit(0);
}

// ── Prod-tilstand ────────────────────────────────────────────────────────
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...), eller brug --snapshot=<sti> for en offline dry-run.");
  process.exit(1);
}
if (APPLY && !BEKRAEFTET) {
  console.error("--apply kræver også --jeg-har-set-dry-runnet. Kør dry-runnet først.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log("=== #3746 trin 7 — genberegning af gemte udviklingslofter ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver til prod)" : "TILSTAND: DRY-RUN (skriver intet)");

async function fetchAllRange(table, cols, orderCol, filterFn) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).range(from, from + PAGE - 1).order(orderCol, { ascending: true });
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
async function readAllIn(table, cols, inCol, ids) {
  const out = [];
  const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const { data, error } = await sb.from(table).select(cols).in(inCol, ids.slice(i, i + CH));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

const seasons = await fetchAllRange("seasons", "number, status", "number");
const activeSeason = seasons.find((s) => s.status === "active");
if (!activeSeason) throw new Error("Ingen aktiv sæson — sæson-alder kan ikke regnes.");
const seasonNumber = activeSeason.number;
console.log(`Aktiv sæson: ${seasonNumber}`);

// SCOPE (#3746): ALLE ryttere med en rider_derived_abilities-række — bredere
// end #3591's søster-script, som kun dækkede en afgrænset fejlgruppe.
const derivedCols = ["rider_id", "ability_caps", ...VISIBLE_ABILITIES].join(", ");
const derived = await fetchAllRange("rider_derived_abilities", derivedCols, "rider_id");
console.log(`Ryttere med en rider_derived_abilities-række: ${derived.length}`);

const riderIds = derived.map((d) => d.rider_id);
const riders = await readAllIn(
  "riders",
  "id, firstname, lastname, birthdate, potentiale, archetype_draw, primary_type, secondary_type, team_id",
  "id",
  riderIds,
);
const riderById = new Map(riders.map((r) => [r.id, r]));

const rows = [];
const stranded = [];
for (const d of derived) {
  const r = riderById.get(d.rider_id);
  if (!r) { stranded.push(d.rider_id); continue; }
  const currentAbilities = {};
  for (const k of VISIBLE_ABILITIES) if (d[k] != null) currentAbilities[k] = Number(d[k]);
  rows.push({
    riderId: d.rider_id,
    firstname: r.firstname,
    lastname: r.lastname,
    birthdate: r.birthdate,
    potentiale: r.potentiale,
    teamId: r.team_id,
    archetypeDraw: r.archetype_draw || null,
    persistedPrimaryType: r.primary_type,
    persistedSecondaryType: r.secondary_type,
    currentAbilities,
    currentCaps: d.ability_caps || {},
  });
}
if (stranded.length) {
  console.log(`(${stranded.length} rider_derived_abilities-rækker uden matchende riders-række sprunget over — riderDeriveHealSweep ejer dem, ikke os.)`);
}

const { plan, stats } = buildPlan(rows, seasonNumber);
printStatsBlock(stats, `PLAN (sæson ${seasonNumber}, ${rows.length} ryttere)`);
console.log(`\nPLAN: ${plan.length} ryttere får nyt loft.`);

if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet. Kør med --apply --jeg-har-set-dry-runnet for at skrive.`);
  process.exit(0);
}
if (!plan.length) {
  console.log("\nIntet at skrive.");
  process.exit(0);
}

// ── Backup FØR skrivning ────────────────────────────────────────────────────
console.log(`\nSikrer ${plan.length} rytteres nuværende lofter i ${BACKUP_TABLE} …`);
for (let i = 0; i < plan.length; i += WRITE_BATCH) {
  const batch = plan.slice(i, i + WRITE_BATCH).map((p) => ({ rider_id: p.id, ability_caps_before: p.gamle }));
  const { error } = await sb.from(BACKUP_TABLE).upsert(batch, { onConflict: "rider_id" });
  if (error) throw new Error(`backup ved ${i}: ${error.message}`);
}
const { count: backupCount, error: bcErr } = await sb.from(BACKUP_TABLE).select("rider_id", { count: "exact", head: true });
if (bcErr) throw new Error(`backup-tælling: ${bcErr.message}`);
if (backupCount < plan.length) throw new Error(`STOP — backuppen dækker kun ${backupCount} af ${plan.length} ryttere.`);
console.log(`Backup verificeret: ${backupCount} rækker.`);

// ── Skrivning ───────────────────────────────────────────────────────────────
let skrevet = 0;
for (let i = 0; i < plan.length; i += WRITE_BATCH) {
  const batch = plan.slice(i, i + WRITE_BATCH);
  for (const p of batch) {
    const { error } = await sb.from("rider_derived_abilities").update({ ability_caps: p.nye }).eq("rider_id", p.id);
    if (error) throw new Error(`skrivning ${p.id}: ${error.message}`);
    skrevet++;
  }
  console.log(`   ${skrevet}/${plan.length}`);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
console.log("\nPost-verify: læser tilbage fra DB …");
const efter = await readAllIn("rider_derived_abilities", "rider_id, ability_caps", "rider_id", plan.map((p) => p.id));
const efterById = new Map(efter.map((e) => [e.rider_id, e.ability_caps]));
const afvig = plan.filter((p) => !capsEqual(efterById.get(p.id), p.nye));
if (afvig.length) {
  console.error(`POST-VERIFY FEJLEDE: ${afvig.length} rækker matcher ikke planen.`);
  process.exit(1);
}
console.log(`Post-verify OK: alle ${plan.length} rækker i DB matcher planen.`);
console.log(`Rollback: UPDATE rider_derived_abilities SET ability_caps = b.ability_caps_before FROM ${BACKUP_TABLE} b WHERE rider_id = b.rider_id;`);
console.log(`\n(Anden kørsel af dette script bør nu finde 0 ryttere at ændre — se database/2026-08-16-3746-recompute-ability-caps.sql.)`);
