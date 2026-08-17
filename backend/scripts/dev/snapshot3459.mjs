#!/usr/bin/env node
// #3645 / #3459 — SNAPSHOT FØR RACE-DAY-FLIPPET. KUN SELECT.
//
// HVORFOR. Når `race_day_engine_enabled` går fra 'off' til 'on', begynder
// `dailyTrainingEngine` at dække AI-holdene, og første tik genopbygger deres
// `ability_caps` med alder. At sætte flaget tilbage gendanner IKKE de gamle lofter
// — flaget styrer hvilken motor der kører, ikke hvad den allerede har skrevet.
// Dette snapshot er derfor den eneste ting der gør et rollback muligt.
// (`docs/2026-08-23-cutover-drejebog.md`, komponent 3.)
//
// HVAD DER GEMMES (drejebogens tabel, uændret):
//   rider_derived_abilities  rider_id, ability_caps, ability_progress
//                            — det eneste der ikke kan rekonstrueres efter tikket
//   riders                   id, primary_type, secondary_type, archetype_draw,
//                            potentiale, birthdate — klassifikations-grundlaget
//                            lofterne afledes af
//   app_config               hele tabellen — flag-tilstanden før
//
// Mønstret følger `snapshot-3570-full.mjs` og `docs/snapshots/3591/`.
//
// SIKKERHED. Scriptet udfører KUN SELECT. Der er ingen skrive-sti i filen, og
// ingen --apply. Kør det gerne mod prod.
//
// KØRSEL
//   prod (read-only):
//     cd backend && infisical run --env=prod -- node scripts/dev/snapshot3459.mjs ../docs/snapshots/3459
//   staging (samme kommando, andre secrets)
//
// VERIFICÉR AT SNAPSHOTTET ER LÆSBART bagefter — drejebogens gate siger
// "snapshot taget + verificeret læsbart", ikke bare "taget":
//     node scripts/dev/restoreCaps3459.mjs --snapshot ../docs/snapshots/3459
//
// Refs #3645 #3459 #3591.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

import { fmtInt } from "../lib/cutover3645.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Projekt-ref'en (ikke nøglen) skrives i meta, så et snapshot aldrig kan gendannes
// ind i det forkerte miljø ved et uheld. Gendannelses-scriptet håndhæver det.
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

const OUT_DIR = process.argv[2] || path.join(import.meta.dirname, "../../../docs/snapshots/3459");
fs.mkdirSync(OUT_DIR, { recursive: true });

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

const measuredAt = new Date();
console.log("=== #3459 snapshot før race-day-flippet (READ-ONLY, kun SELECT) ===");
console.log(`Projekt      : ${projectRef}`);
console.log(`Måletidspunkt: ${measuredAt.toISOString()} UTC (${measuredAt.toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" })} dansk tid)`);
console.log(`Mappe        : ${path.resolve(OUT_DIR)}`);

const seasons = await selectAll("seasons", "number, status, start_date, end_date, race_days_completed, race_days_total", "number");
const activeSeason = seasons.find((s) => s.status === "active") ?? null;
if (!activeSeason) throw new Error("Ingen aktiv sæson — snapshottet ville mangle sit alders-grundlag.");

// Hele tabellen, alle kolonner: flag-tilstanden før flippet skal kunne læses uden
// at nogen på forhånd har gættet hvilke nøgler der viste sig at betyde noget.
const appConfig = await selectAll("app_config", "*", "key");

const riders = await selectAll(
  "riders",
  "id, primary_type, secondary_type, archetype_draw, potentiale, birthdate",
  "id",
);

const derived = await selectAll("rider_derived_abilities", "rider_id, ability_caps, ability_progress", "rider_id");

const raceDayFlag = appConfig.find((c) => c.key === "race_day_engine_enabled")?.value ?? null;
const derivedIds = new Set(derived.map((d) => d.rider_id));
const ridersUdenLofter = riders.filter((r) => !derivedIds.has(r.id)).length;

const meta = {
  issue: 3459,
  toolIssue: 3645,
  purpose: "Rollback-grundlag for race-day-flippet 2026-08-23 (race_day_engine_enabled off → on).",
  takenAt: measuredAt.toISOString(),
  takenAtCopenhagen: measuredAt.toLocaleString("sv-SE", { timeZone: "Europe/Copenhagen" }),
  supabaseProjectRef: projectRef,
  activeSeasonNumber: activeSeason.number,
  activeSeason,
  raceDayEngineEnabled: raceDayFlag,
  rowCounts: {
    rider_derived_abilities: derived.length,
    riders: riders.length,
    app_config: appConfig.length,
    seasons: seasons.length,
  },
  integritet: {
    derivedMedCaps: derived.filter((d) => d.ability_caps != null).length,
    derivedMedProgress: derived.filter((d) => d.ability_progress != null).length,
    ridersUdenAfledtRaekke: ridersUdenLofter,
    ridersMedArchetypeDraw: riders.filter((r) => r.archetype_draw != null).length,
  },
  // riders-udtrækket er BEVIDST uden is_retired-filter: et rollback skal kunne
  // dække enhver rytter der har en afledt række, også en der pensioneres i vinduet.
  noter: [
    "Alle rækker, ingen is_retired-filtrering — rollback skal dække hele tabellen.",
    "ability_caps/ability_progress er jsonb og gemmes uændret.",
    "app_config er hele tabellen, alle kolonner.",
  ],
};

fs.writeFileSync(path.join(OUT_DIR, "rider_derived_abilities.json"), JSON.stringify(derived));
fs.writeFileSync(path.join(OUT_DIR, "riders.json"), JSON.stringify(riders));
fs.writeFileSync(path.join(OUT_DIR, "app_config.json"), JSON.stringify(appConfig, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

console.log(`\nrider_derived_abilities : ${fmtInt(derived.length)} rækker (${fmtInt(meta.integritet.derivedMedCaps)} med lofter, ${fmtInt(meta.integritet.derivedMedProgress)} med progress)`);
console.log(`riders                  : ${fmtInt(riders.length)} rækker (${fmtInt(meta.integritet.ridersMedArchetypeDraw)} med anlæg)`);
console.log(`app_config              : ${fmtInt(appConfig.length)} rækker · race_day_engine_enabled = ${raceDayFlag === null ? "(nøglen findes ikke)" : `'${raceDayFlag}'`}`);
console.log(`Aktiv sæson             : ${activeSeason.number} (${activeSeason.race_days_completed}/${activeSeason.race_days_total} løbsdage)`);
if (ridersUdenLofter) console.log(`ADVARSEL: ${fmtInt(ridersUdenLofter)} ryttere har ingen rider_derived_abilities-række.`);
console.log(`\nSkrevet til ${path.resolve(OUT_DIR)}`);
console.log("Næste skridt (gaten kræver 'verificeret læsbart', ikke bare 'taget'):");
console.log(`  node scripts/dev/restoreCaps3459.mjs --snapshot ${OUT_DIR}`);
