#!/usr/bin/env node
// #1099 · Kalibrerings-harness for omdømme-systemet (spec §9). READ-ONLY —
// scriptet har ingen skrive-sti overhovedet, hverken bag et flag.
//
// Simulér-før-ship: point-tabellen i spec §4 er et UDGANGSPUNKT, ikke et
// facit. Harnessen afspiller alle sæsoner gennem motoren, beregner hver
// rytters tal som det VILLE se ud, og måler mod spec §9's mål:
//
//   · median (p50) ≤ 10
//   · 1-2 % af rytterne ≥ 70 (Stjerne)
//   · ≤ 0,3 % ≥ 90 (Legende)
//   · de 20 mest vindende ryttere i S1-S3 skal ALLE være ≥ 70
//
// Rammer seed-gulvet for mange Stjerner UDEN resultater, sænkes
// SEED_FLOOR_WEIGHT til 0,5 (spec §9). Harnessen kører derfor ALTID begge
// vægte og viser dem side om side, så beslutningen træffes på tal og ikke på
// en gentagelse af kørslen.
//
// Usage:
//   node backend/scripts/reputation-calibration.js
//   node backend/scripts/reputation-calibration.js --markdown > docs/audits/reputation-calibration-<dato>.md
//   node backend/scripts/reputation-calibration.js --top=50
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, kun læsning)
// Exit: 0 = alle mål nået, 1 = mindst ét mål ikke nået, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRowsKeyset } from "../lib/supabasePagination.js";
import { runReplay } from "../lib/reputationReplay.js";
import { computeReputation, bandFor } from "../lib/reputationEngine.js";
import {
  SEED_FLOOR_WEIGHT,
  SEED_FLOOR_WEIGHT_ALTERNATIVE,
  STAR_BAND_THRESHOLD,
  LEGEND_BAND_THRESHOLD,
  REPUTATION_BANDS,
} from "../lib/reputationConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

// Spec §9's mål.
export const TARGETS = Object.freeze({
  medianMax: 10,
  starShareMin: 0.01,
  starShareMax: 0.02,
  legendShareMax: 0.003,
  topWinnersChecked: 20,
});

const RIDER_COLUMNS = "id, firstname, lastname, popularity, is_retired, nationality_code";

export async function loadRiders(supabase) {
  return fetchAllRowsKeyset((after) => {
    let query = supabase.from("riders").select(RIDER_COLUMNS).order("id", { ascending: true });
    if (after) query = query.gt("id", after);
    return query;
  }, { keyColumn: "id" });
}

export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const index = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[index];
}

function riderName(rider) {
  return [rider?.firstname, rider?.lastname].filter(Boolean).join(" ") || "(uden navn)";
}

function winCount(events) {
  return events.filter((e) => e.event_kind.endsWith("_win")).length;
}

/**
 * REN scoring af hele populationen for ÉN seed-vægt.
 *
 * @returns {{seedFloorWeight, population, scored, p50, p75, p95, starCount, legendCount,
 *            starShare, legendShare, bandCounts, top, seedOnlyStars, topWinners, targets}}
 */
export function scorePopulation({ riders, byRider, currentSeasonIndex, seedFloorWeight, topN = 50 }) {
  const options = { seedFloorWeight };
  const scored = [];

  for (const rider of riders) {
    const events = byRider.get(rider.id) ?? [];
    const { floor, form, reputation, band } = computeReputation({
      seedPopularity: rider.popularity,
      events,
      currentSeasonIndex,
      seasonIndexOf: (event) => Number(event?.season_number ?? currentSeasonIndex),
      options,
    });
    scored.push({
      rider_id: rider.id,
      name: riderName(rider),
      nationality: rider.nationality_code ?? null,
      seed: Number(rider.popularity) || 0,
      is_retired: rider.is_retired === true,
      events: events.length,
      wins: winCount(events),
      floor,
      form,
      reputation,
      band: band.key,
    });
  }

  // Fordelingen måles på den LEVENDE population: pensionerede ryttere er ude af
  // spillet og ville skævvride både median og Stjerne-andel (de har karriere-
  // gulv, men ingen ny form). De rapporteres separat.
  const population = scored.filter((r) => !r.is_retired);
  const values = population.map((r) => r.reputation).sort((a, b) => a - b);

  const starCount = population.filter((r) => r.reputation >= STAR_BAND_THRESHOLD).length;
  const legendCount = population.filter((r) => r.reputation >= LEGEND_BAND_THRESHOLD).length;
  const bandCounts = new Map(REPUTATION_BANDS.map((b) => [b.key, 0]));
  for (const r of population) bandCounts.set(r.band, (bandCounts.get(r.band) ?? 0) + 1);

  const top = [...population]
    .sort((a, b) => b.reputation - a.reputation || b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, topN);

  // Spec §9's advarselssignal: Stjerner der KUN er stjerner fordi de blev
  // seedet kendte — nul hændelser i tre sæsoner.
  const seedOnlyStars = population.filter((r) => r.reputation >= STAR_BAND_THRESHOLD && r.events === 0);

  // "De 20 mest vindende ryttere i S1-S3" — rangeret på antal SEJRE (ikke
  // omdømme, ellers ville tjekket være cirkulært).
  const topWinners = [...scored]
    .sort((a, b) => b.wins - a.wins || b.events - a.events || a.name.localeCompare(b.name))
    .slice(0, TARGETS.topWinnersChecked);
  const topWinnersBelowStar = topWinners.filter((r) => r.reputation < STAR_BAND_THRESHOLD);

  const p50 = percentile(values, 50);
  const p75 = percentile(values, 75);
  const p95 = percentile(values, 95);
  const starShare = population.length ? starCount / population.length : 0;
  const legendShare = population.length ? legendCount / population.length : 0;

  return {
    seedFloorWeight,
    populationSize: population.length,
    retiredSize: scored.length - population.length,
    scored,
    p50, p75, p95,
    mean: population.length ? population.reduce((s, r) => s + r.reputation, 0) / population.length : 0,
    starCount, legendCount, starShare, legendShare,
    bandCounts,
    top,
    seedOnlyStars,
    topWinners,
    topWinnersBelowStar,
    targets: {
      medianOk: p50 <= TARGETS.medianMax,
      starShareOk: starShare >= TARGETS.starShareMin && starShare <= TARGETS.starShareMax,
      legendShareOk: legendShare <= TARGETS.legendShareMax,
      topWinnersOk: topWinnersBelowStar.length === 0,
    },
  };
}

function pct(x) {
  return `${(x * 100).toFixed(2)} %`;
}

function tick(ok) {
  return ok ? "JA" : "NEJ";
}

function renderSummaryTable(runs) {
  const lines = [];
  lines.push("| Mål (spec §9) | Krav | SEED_FLOOR_WEIGHT 1,0 | SEED_FLOOR_WEIGHT 0,5 |");
  lines.push("|---|---|---|---|");
  const [a, b] = runs;
  lines.push(`| Median (p50) | ≤ ${TARGETS.medianMax} | ${a.p50.toFixed(1)} (${tick(a.targets.medianOk)}) | ${b.p50.toFixed(1)} (${tick(b.targets.medianOk)}) |`);
  lines.push(`| p75 | — | ${a.p75.toFixed(1)} | ${b.p75.toFixed(1)} |`);
  lines.push(`| p95 | — | ${a.p95.toFixed(1)} | ${b.p95.toFixed(1)} |`);
  lines.push(`| Andel ≥ 70 (Stjerne) | 1-2 % | ${pct(a.starShare)} = ${a.starCount} (${tick(a.targets.starShareOk)}) | ${pct(b.starShare)} = ${b.starCount} (${tick(b.targets.starShareOk)}) |`);
  lines.push(`| Andel ≥ 90 (Legende) | ≤ 0,3 % | ${pct(a.legendShare)} = ${a.legendCount} (${tick(a.targets.legendShareOk)}) | ${pct(b.legendShare)} = ${b.legendCount} (${tick(b.targets.legendShareOk)}) |`);
  lines.push(`| Top-20 vindere alle ≥ 70 | ja | ${tick(a.targets.topWinnersOk)} (${a.topWinnersBelowStar.length} under) | ${tick(b.targets.topWinnersOk)} (${b.topWinnersBelowStar.length} under) |`);
  lines.push(`| Stjerner UDEN hændelser (kun seed) | lavt | ${a.seedOnlyStars.length} | ${b.seedOnlyStars.length} |`);
  return lines.join("\n");
}

function renderBandTable(run) {
  const lines = ["| Bånd | Antal | Andel |", "|---|---|---|"];
  for (const band of REPUTATION_BANDS) {
    const count = run.bandCounts.get(band.key) ?? 0;
    lines.push(`| ${band.bandKeyEn}/${band.bandKeyDa} (${band.min}+) | ${count} | ${pct(run.populationSize ? count / run.populationSize : 0)} |`);
  }
  return lines.join("\n");
}

function renderTopTable(run, topN) {
  const lines = [
    `| # | Rytter | Omdømme | Gulv | Form | Seed | Hændelser | Sejre | Bånd |`,
    "|---|---|---|---|---|---|---|---|---|",
  ];
  run.top.slice(0, topN).forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.name} (\`${r.rider_id.slice(0, 8)}\`) | ${r.reputation.toFixed(1)} | ${r.floor.toFixed(1)} | ${r.form.toFixed(1)} | ${r.seed} | ${r.events} | ${r.wins} | ${r.band} |`);
  });
  return lines.join("\n");
}

function renderWinnersTable(run) {
  const lines = ["| # | Rytter | Sejre | Omdømme | Gulv | Form | Seed | ≥ 70 |", "|---|---|---|---|---|---|---|---|"];
  run.topWinners.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.name} | ${r.wins} | ${r.reputation.toFixed(1)} | ${r.floor.toFixed(1)} | ${r.form.toFixed(1)} | ${r.seed} | ${r.reputation >= STAR_BAND_THRESHOLD ? "ja" : "NEJ"} |`);
  });
  return lines.join("\n");
}

function renderSeedComparison(run) {
  const withEvents = run.scored.filter((r) => !r.is_retired && r.events > 0);
  const risers = [...withEvents].sort((a, b) => (b.reputation - b.seed) - (a.reputation - a.seed)).slice(0, 15);
  const fallers = [...run.scored.filter((r) => !r.is_retired)]
    .sort((a, b) => (a.reputation - a.seed) - (b.reputation - b.seed)).slice(0, 15);
  const lines = ["**Største stigninger vs. seed (`riders.popularity`)**", "", "| Rytter | Seed | Omdømme | Δ | Hændelser |", "|---|---|---|---|---|"];
  for (const r of risers) lines.push(`| ${r.name} | ${r.seed} | ${r.reputation.toFixed(1)} | +${(r.reputation - r.seed).toFixed(1)} | ${r.events} |`);
  lines.push("", "**Største fald vs. seed** (seedede kendisser uden resultater)", "", "| Rytter | Seed | Omdømme | Δ | Hændelser |", "|---|---|---|---|---|");
  for (const r of fallers) lines.push(`| ${r.name} | ${r.seed} | ${r.reputation.toFixed(1)} | ${(r.reputation - r.seed).toFixed(1)} | ${r.events} |`);
  return lines.join("\n");
}

export function renderMarkdown({ runs, replay, topN }) {
  const [primary] = runs;
  const today = new Date().toISOString().slice(0, 10);
  const eventKinds = new Map();
  for (const e of replay.events) eventKinds.set(e.event_kind, (eventKinds.get(e.event_kind) ?? 0) + 1);

  const out = [];
  out.push(`# Omdømme-kalibrering — afspilning af S1-S3 (${today})`);
  out.push("");
  out.push(`> Genereret af \`backend/scripts/reputation-calibration.js\` (READ-ONLY) mod prod.`);
  out.push(`> Spec: \`docs/superpowers/specs/2026-09-04-reputation-system-design.md\` §9. Refs #1099.`);
  out.push("");
  out.push("## Grundlag");
  out.push("");
  out.push(`- Afsluttede løb afspillet: **${replay.races.length}**, heraf **${replay.racesWithEvents}** med mindst én hændelse.`);
  out.push(`- Hændelser udledt: **${replay.events.length}**.`);
  out.push(`- Aktiv sæson: **S${replay.activeSeason?.number ?? "?"}** (halveringen regnes herfra).`);
  out.push(`- Population i fordelingen: **${primary.populationSize}** aktive ryttere (${primary.retiredSize} pensionerede holdt udenfor).`);
  out.push("");
  out.push("## Datadækning (læs FØR tallene nedenfor)");
  out.push("");
  out.push("Resultatrækker der KUNNE give en hændelse (top-10 i gc/stage/trøje, plus førertrøje-dage), og hvor mange af dem der har `rider_id = NULL` og derfor pr. definition ikke kan give omdømme til nogen:");
  out.push("");
  out.push("| Sæson | Relevante rækker | Uden `rider_id` | Andel |");
  out.push("|---|---|---|---|");
  for (const row of replay.coverage) {
    const share = row.rows ? row.without_rider / row.rows : 0;
    const label = row.season_number == null ? "(løb ikke afsluttet)" : `S${row.season_number}`;
    out.push(`| ${label} | ${row.rows} | ${row.without_rider} | ${pct(share)} |`);
  }
  out.push("");
  out.push("## Mål (spec §9)");
  out.push("");
  out.push(renderSummaryTable(runs));
  out.push("");
  out.push(`## Fordeling — SEED_FLOOR_WEIGHT ${String(primary.seedFloorWeight).replace(".", ",")}`);
  out.push("");
  out.push(renderBandTable(primary));
  out.push("");
  out.push(`Gennemsnit ${primary.mean.toFixed(1)} · p50 ${primary.p50.toFixed(1)} · p75 ${primary.p75.toFixed(1)} · p95 ${primary.p95.toFixed(1)}.`);
  out.push("");
  out.push(`## Fordeling — SEED_FLOOR_WEIGHT ${String(runs[1].seedFloorWeight).replace(".", ",")}`);
  out.push("");
  out.push(renderBandTable(runs[1]));
  out.push("");
  out.push(`Gennemsnit ${runs[1].mean.toFixed(1)} · p50 ${runs[1].p50.toFixed(1)} · p75 ${runs[1].p75.toFixed(1)} · p95 ${runs[1].p95.toFixed(1)}.`);
  out.push("");
  out.push(`## Top ${topN} (SEED_FLOOR_WEIGHT ${String(primary.seedFloorWeight).replace(".", ",")})`);
  out.push("");
  out.push(renderTopTable(primary, topN));
  out.push("");
  out.push("## De 20 mest vindende ryttere i S1-S3");
  out.push("");
  out.push(renderWinnersTable(primary));
  out.push("");
  out.push("## Sammenligning mod seed");
  out.push("");
  out.push(renderSeedComparison(primary));
  out.push("");
  out.push("## Hændelser pr. type");
  out.push("");
  out.push("| Hændelsestype | Antal |");
  out.push("|---|---|");
  for (const [kind, count] of [...eventKinds.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`| \`${kind}\` | ${count} |`);
  }
  out.push("");
  out.push("## Hændelser pr. sæson og løbsklasse");
  out.push("");
  out.push("| Sæson | Klasse | Hændelser | Form-point i alt | Gulv-kredit i alt |");
  out.push("|---|---|---|---|---|");
  for (const row of replay.perSeasonClass) {
    out.push(`| S${row.season_number ?? "?"} | ${row.race_class ?? "?"} | ${row.events} | ${row.form_points.toFixed(1)} | ${row.floor_credit.toFixed(1)} |`);
  }
  out.push("");
  return out.join("\n");
}

function printConsole({ runs, replay }) {
  const [a, b] = runs;
  console.log("");
  console.log("=== Omdømme-kalibrering (#1099, READ-ONLY) ===");
  console.log(`  Løb afspillet: ${replay.races.length} · hændelser: ${replay.events.length} · aktiv sæson S${replay.activeSeason?.number ?? "?"}`);
  for (const run of [a, b]) {
    console.log("");
    console.log(`  SEED_FLOOR_WEIGHT ${run.seedFloorWeight}`);
    console.log(`    p50 ${run.p50.toFixed(1)} (mål ≤ ${TARGETS.medianMax}: ${tick(run.targets.medianOk)}) · p75 ${run.p75.toFixed(1)} · p95 ${run.p95.toFixed(1)}`);
    console.log(`    ≥70: ${run.starCount} (${pct(run.starShare)}, mål 1-2 %: ${tick(run.targets.starShareOk)})`);
    console.log(`    ≥90: ${run.legendCount} (${pct(run.legendShare)}, mål ≤0,3 %: ${tick(run.targets.legendShareOk)})`);
    console.log(`    top-20 vindere alle ≥70: ${tick(run.targets.topWinnersOk)} (${run.topWinnersBelowStar.length} under)`);
    console.log(`    Stjerner uden hændelser (kun seed): ${run.seedOnlyStars.length}`);
  }
  console.log("");
}

async function main() {
  const argv = process.argv.slice(2);
  const markdown = argv.includes("--markdown");
  const topArg = argv.find((a) => a.startsWith("--top="));
  const topN = topArg ? Number(topArg.split("=")[1]) || 50 : 50;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const replay = await runReplay(supabase);
  const riders = await loadRiders(supabase);
  const currentSeasonIndex = Number(replay.activeSeason?.number ?? 0);

  const runs = [SEED_FLOOR_WEIGHT, SEED_FLOOR_WEIGHT_ALTERNATIVE].map((seedFloorWeight) =>
    scorePopulation({ riders, byRider: replay.byRider, currentSeasonIndex, seedFloorWeight, topN }));

  if (markdown) {
    console.log(renderMarkdown({ runs, replay, topN }));
  } else {
    printConsole({ runs, replay });
  }

  const primary = runs[0];
  const allOk = Object.values(primary.targets).every(Boolean);
  process.exit(allOk ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("reputation-calibration.js")) {
  main().catch((err) => {
    console.error(`reputation-calibration fejlede: ${err.message}`);
    process.exit(2);
  });
}

export { bandFor };
