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
// Kørsel 1 (docs/audits/reputation-calibration-2026-09-05.md) fandt at
// SEED_FLOOR_WEIGHT 1,0 er korrekt (0 seed-only Stjerner i data) — det er
// IKKE længere en variabel her. De åbne akser er nu SOFT_CAP (det bløde
// loft der har erstattet den hårde clamp), ProSeries-klassevægten, og
// gulv-kreditten for ProSeries-/Class1-sejre (93 % af alle hændelser ligger
// i ProSeries/Class1/Class2).
//
// Konstanterne er overstyrbare UDEN at ændre produktions-defaults i
// reputationConstants.js — enten ad hoc via gentagne `--set sti=værdi`, eller
// som den indbyggede 8-variant-grid (`--grid`). Begge veje bruger
// `buildConstants()` (reputationConstants.js), som ALDRIG muterer de frosne
// production-exports.
//
// Usage:
//   node backend/scripts/reputation-calibration.js
//   node backend/scripts/reputation-calibration.js --markdown > docs/audits/reputation-calibration-<dato>.md
//   node backend/scripts/reputation-calibration.js --top=50
//   node backend/scripts/reputation-calibration.js --set SOFT_CAP=80 --set W_CLASS.ProSeries=0.35
//   node backend/scripts/reputation-calibration.js --grid [--markdown]
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, kun læsning)
// Exit: 0 = alle mål nået (single-run) / grid altid 0, 1 = mindst ét mål ikke nået, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRowsKeyset } from "../lib/supabasePagination.js";
import { runReplay, replayEvents } from "../lib/reputationReplay.js";
import { computeReputation, bandFor } from "../lib/reputationEngine.js";
import {
  SEED_FLOOR_WEIGHT,
  SOFT_CAP,
  STAR_BAND_THRESHOLD,
  LEGEND_BAND_THRESHOLD,
  REPUTATION_BANDS,
  buildConstants,
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

const RIDER_COLUMNS = "id, firstname, lastname, popularity, is_retired, nationality_code, team_id";

export async function loadRiders(supabase) {
  return fetchAllRowsKeyset((after) => {
    let query = supabase.from("riders").select(RIDER_COLUMNS).order("id", { ascending: true });
    if (after) query = query.gt("id", after);
    return query;
  }, { keyColumn: "id" });
}

// KUN til Top-tabellen i rapporten — "hold" er ikke en del af selve tallet.
export async function loadTeamNamesById(supabase) {
  const rows = await fetchAllRowsKeyset((after) => {
    let query = supabase.from("teams").select("id, name").order("id", { ascending: true });
    if (after) query = query.gt("id", after);
    return query;
  }, { keyColumn: "id" });
  return new Map(rows.map((t) => [t.id, t.name]));
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
 * REN scoring af hele populationen for ét sæt konstanter (softCap m.fl.).
 * `byRider` skal allerede være udledt med de SAMME konstanter (grid-
 * varianter ændrer også W_CLASS/FLOOR_CREDITS, som virker på hændelses-
 * udledningen, ikke kun på softCap).
 *
 * @returns {{populationSize, retiredSize, scored, p50, p75, p95, max, mean,
 *            starCount, legendCount, starShare, legendShare, legendCap99Count,
 *            bandCounts, top, seedOnlyStars, topWinners, topWinnersBelowStar, targets}}
 */
export function scorePopulation({ riders, byRider, currentSeasonIndex, seedFloorWeight, softCap = SOFT_CAP, topN = 50, teamNamesById = new Map() }) {
  const options = { seedFloorWeight, softCap };
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
      team_name: teamNamesById.get(rider.team_id) ?? null,
      nationality: rider.nationality_code ?? null,
      seed: Number(rider.popularity) || 0,
      is_retired: rider.is_retired === true,
      events: events.length,
      wins: winCount(events),
      floor,
      form,
      reputation,
      band: band.key,
      // Kortfattet "hvorfor" til Top-tabellen: de 3 hændelser med flest
      // formpoint, i klart sprog (spec §7 punkt 3's "hvorfor"-liste).
      topEvents: byRider.get(rider.id) ?? [],
    });
  }

  // Fordelingen måles på den LEVENDE population: pensionerede ryttere er ude af
  // spillet og ville skævvride både median og Stjerne-andel (de har karriere-
  // gulv, men ingen ny form). De rapporteres separat.
  const population = scored.filter((r) => !r.is_retired);
  const values = population.map((r) => r.reputation).sort((a, b) => a - b);

  const starCount = population.filter((r) => r.reputation >= STAR_BAND_THRESHOLD).length;
  const legendCount = population.filter((r) => r.reputation >= LEGEND_BAND_THRESHOLD).length;
  // "Klemt på toppen"-signal for det bløde loft: hvor mange lander ≥ 99 (i
  // praksis umuligt at skelne fra "ramte 100" for en spiller).
  const legendCap99Count = population.filter((r) => r.reputation >= 99).length;
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
  const max = values.length ? values[values.length - 1] : 0;
  const starShare = population.length ? starCount / population.length : 0;
  const legendShare = population.length ? legendCount / population.length : 0;

  return {
    softCap,
    populationSize: population.length,
    retiredSize: scored.length - population.length,
    scored,
    p50, p75, p95, max,
    mean: population.length ? population.reduce((s, r) => s + r.reputation, 0) / population.length : 0,
    starCount, legendCount, starShare, legendShare, legendCap99Count,
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

// ── Enkelt-kørsel (produktions-konstanter eller ad hoc --set) ───────────────

function renderSummaryTable(run) {
  const lines = [];
  lines.push("| Mål (spec §9) | Krav | Opnået |");
  lines.push("|---|---|---|");
  lines.push(`| Median (p50) | ≤ ${TARGETS.medianMax} | ${run.p50.toFixed(1)} (${tick(run.targets.medianOk)}) |`);
  lines.push(`| p75 | — | ${run.p75.toFixed(1)} |`);
  lines.push(`| p95 | — | ${run.p95.toFixed(1)} |`);
  lines.push(`| Max | — | ${run.max.toFixed(1)} |`);
  lines.push(`| Andel ≥ 70 (Stjerne) | 1-2 % | ${pct(run.starShare)} = ${run.starCount} (${tick(run.targets.starShareOk)}) |`);
  lines.push(`| Andel ≥ 90 (Legende) | ≤ 0,3 % | ${pct(run.legendShare)} = ${run.legendCount} (${tick(run.targets.legendShareOk)}) |`);
  lines.push(`| Antal ≥ 99 (klemt på toppen) | lavt | ${run.legendCap99Count} |`);
  lines.push(`| Top-20 vindere alle ≥ 70 | ja | ${tick(run.targets.topWinnersOk)} (${run.topWinnersBelowStar.length} under) |`);
  lines.push(`| Stjerner UDEN hændelser (kun seed) | lavt | ${run.seedOnlyStars.length} |`);
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

// Klart-sprog "hvorfor" (spec §7 punkt 3): de op til 3 hændelser med flest
// formpoint for rytteren, oversat fra event_kind til dansk prosa. KUN
// rapport-tekst — reputationConstants.js's "ingen tekst til UI"-regel gælder
// selve motoren, ikke denne harness-rapport.
const EVENT_KIND_LABELS = Object.freeze({
  one_day_win: "sejr i endagsløb", one_day_podium: "podium i endagsløb", one_day_top10: "top 10 i endagsløb",
  gc_win: "sammenlagt sejr", gc_podium: "sammenlagt podium", gc_top10: "sammenlagt top 10",
  stage_win: "etapesejr", stage_podium: "etapepodium", stage_top10: "etape-top 10",
  jersey_points_win: "vandt pointtrøjen", jersey_points_podium: "podium i pointtrøjen", jersey_points_top10: "top 10 i pointtrøjen",
  jersey_mountain_win: "vandt bjergtrøjen", jersey_mountain_podium: "podium i bjergtrøjen", jersey_mountain_top10: "top 10 i bjergtrøjen",
  jersey_young_win: "vandt ungdomstrøjen", jersey_young_podium: "podium i ungdomstrøjen", jersey_young_top10: "top 10 i ungdomstrøjen",
  leader_day: "dag i førertrøjen",
});

function describeEvent(e) {
  const label = EVENT_KIND_LABELS[e.event_kind] ?? e.event_kind;
  return `${label} (${e.race_class ?? "?"}, ${(Number(e.form_points) || 0).toFixed(1)} p)`;
}

function topEventSummaries(row, n = 3) {
  return [...(row.topEvents ?? [])]
    .sort((a, b) => (Number(b.form_points) || 0) - (Number(a.form_points) || 0))
    .slice(0, n)
    .map(describeEvent)
    .join("; ") || "(ingen hændelser — rent seed-gulv)";
}

function renderTopTable(run, topN) {
  const lines = [
    `| # | Rytter | Hold | Omdømme | Gulv | Form | Seed | Bånd | Hvorfor (top 3 hændelser) |`,
    "|---|---|---|---|---|---|---|---|---|",
  ];
  run.top.slice(0, topN).forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.name} | ${r.team_name ?? "—"} | ${r.reputation.toFixed(1)} | ${r.floor.toFixed(1)} | ${r.form.toFixed(1)} | ${r.seed} | ${r.band} | ${topEventSummaries(r)} |`);
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

export function renderMarkdown({ run, replay, topN, constantsLabel }) {
  const today = new Date().toISOString().slice(0, 10);
  const eventKinds = new Map();
  for (const e of replay.events) eventKinds.set(e.event_kind, (eventKinds.get(e.event_kind) ?? 0) + 1);

  const out = [];
  out.push(`# Omdømme-kalibrering — afspilning af S1-S3 (${today})`);
  out.push("");
  out.push(`> Genereret af \`backend/scripts/reputation-calibration.js\` (READ-ONLY) mod prod.`);
  out.push(`> Spec: \`docs/superpowers/specs/2026-09-04-reputation-system-design.md\` §9. Refs #1099.`);
  if (constantsLabel) out.push(`> Konstanter: ${constantsLabel}`);
  out.push("");
  out.push("## Grundlag");
  out.push("");
  out.push(`- Afsluttede løb afspillet: **${replay.races.length}**, heraf **${replay.racesWithEvents}** med mindst én hændelse.`);
  out.push(`- Hændelser udledt: **${replay.events.length}**.`);
  out.push(`- Aktiv sæson: **S${replay.activeSeason?.number ?? "?"}** (halveringen regnes herfra).`);
  out.push(`- Population i fordelingen: **${run.populationSize}** aktive ryttere (${run.retiredSize} pensionerede holdt udenfor).`);
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
  out.push(renderSummaryTable(run));
  out.push("");
  out.push(`## Fordeling`);
  out.push("");
  out.push(renderBandTable(run));
  out.push("");
  out.push(`Gennemsnit ${run.mean.toFixed(1)} · p50 ${run.p50.toFixed(1)} · p75 ${run.p75.toFixed(1)} · p95 ${run.p95.toFixed(1)} · max ${run.max.toFixed(1)}.`);
  out.push("");
  out.push(`## Top ${topN}`);
  out.push("");
  out.push(renderTopTable(run, topN));
  out.push("");
  out.push("## De 20 mest vindende ryttere i S1-S3");
  out.push("");
  out.push(renderWinnersTable(run));
  out.push("");
  out.push("## Sammenligning mod seed");
  out.push("");
  out.push(renderSeedComparison(run));
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

function printConsole({ run, replay, constantsLabel }) {
  console.log("");
  console.log("=== Omdømme-kalibrering (#1099, READ-ONLY) ===");
  if (constantsLabel) console.log(`  Konstanter: ${constantsLabel}`);
  console.log(`  Løb afspillet: ${replay.races.length} · hændelser: ${replay.events.length} · aktiv sæson S${replay.activeSeason?.number ?? "?"}`);
  console.log("");
  console.log(`    p50 ${run.p50.toFixed(1)} (mål ≤ ${TARGETS.medianMax}: ${tick(run.targets.medianOk)}) · p75 ${run.p75.toFixed(1)} · p95 ${run.p95.toFixed(1)} · max ${run.max.toFixed(1)}`);
  console.log(`    ≥70: ${run.starCount} (${pct(run.starShare)}, mål 1-2 %: ${tick(run.targets.starShareOk)})`);
  console.log(`    ≥90: ${run.legendCount} (${pct(run.legendShare)}, mål ≤0,3 %: ${tick(run.targets.legendShareOk)})`);
  console.log(`    ≥99 (klemt på toppen): ${run.legendCap99Count}`);
  console.log(`    top-20 vindere alle ≥70: ${tick(run.targets.topWinnersOk)} (${run.topWinnersBelowStar.length} under${run.topWinnersBelowStar.length ? ": " + run.topWinnersBelowStar.map((r) => r.name).join(", ") : ""})`);
  console.log(`    Stjerner uden hændelser (kun seed): ${run.seedOnlyStars.length}`);
  console.log("");
}

// ── Grid (maks 8 varianter, spec §9's åbne akser) ───────────────────────────
//
// SEED_FLOOR_WEIGHT er FAST 1,0 (kørsel 1's konklusion, ikke længere en
// akse). De fire varierede akser er: SOFT_CAP (det bløde loft), ProSeries-
// klassevægten (W_CLASS.ProSeries), gulv-kreditten for en ProSeries-sejr
// (FLOOR_CREDITS.{one_day,gc}.ProSeries) og gulv-kreditten for en Class1-sejr
// (0 = i dag, ekskluderet af NO_FLOOR_CREDIT_CLASSES; +1 = fjernet fra
// listen og givet samme kredit som ProSeries).
// VIGTIGT: hver variants `overrides` er FULDT EKSPLICIT (alle fire akser
// sat, aldrig "udelad = arv fra den aktuelle production-default"). Ellers
// ville grid-tabellen tavst blive forkert i det øjeblik nogen (fx en
// efterfølgende kørsel 3) ændrer reputationConstants.js's defaults —
// `buildConstants()` starter altid fra de LEVENDE exports, uanset hvad denne
// grid oprindeligt blev kørt mod.
function makeVariant(id, { softCap, proSeriesWeight, proSeriesFloor, class1Floor }) {
  const overrides = {
    SOFT_CAP: softCap,
    "W_CLASS.ProSeries": proSeriesWeight,
    "FLOOR_CREDITS.one_day.ProSeries": proSeriesFloor,
    "FLOOR_CREDITS.gc.ProSeries": proSeriesFloor,
  };
  if (class1Floor > 0) {
    overrides.NO_FLOOR_CREDIT_CLASSES = ["Class2"];
    overrides["FLOOR_CREDITS.one_day.Class1"] = class1Floor;
    overrides["FLOOR_CREDITS.gc.Class1"] = class1Floor;
  } else {
    overrides.NO_FLOOR_CREDIT_CLASSES = ["Class1", "Class2"];
  }
  return { id, softCap, proSeriesWeight, proSeriesFloor, class1Floor, overrides };
}

export const GRID_VARIANTS = Object.freeze([
  makeVariant("v1", { softCap: 70, proSeriesWeight: 0.25, proSeriesFloor: 1, class1Floor: 0 }),
  makeVariant("v2", { softCap: 80, proSeriesWeight: 0.25, proSeriesFloor: 1, class1Floor: 0 }),
  makeVariant("v3", { softCap: 95, proSeriesWeight: 0.25, proSeriesFloor: 1, class1Floor: 0 }),
  makeVariant("v4", { softCap: 70, proSeriesWeight: 0.35, proSeriesFloor: 1, class1Floor: 0 }),
  makeVariant("v5", { softCap: 70, proSeriesWeight: 0.25, proSeriesFloor: 2, class1Floor: 0 }),
  makeVariant("v6", { softCap: 70, proSeriesWeight: 0.25, proSeriesFloor: 1, class1Floor: 1 }),
  makeVariant("v7", { softCap: 70, proSeriesWeight: 0.25, proSeriesFloor: 2, class1Floor: 1 }),
  makeVariant("v8", { softCap: 74, proSeriesWeight: 0.25, proSeriesFloor: 2, class1Floor: 1 }),
]);

function variantLabel(variant) {
  return `SOFT_CAP=${variant.softCap} · ProSeries-vægt=${variant.proSeriesWeight} · ProSeries-sejr-gulv=+${variant.proSeriesFloor} · Class1-sejr-gulv=+${variant.class1Floor}`;
}

function runVariant({ variant, races, results, seasons, riders, currentSeasonIndex, topN }) {
  const constants = buildConstants(variant.overrides);
  const replay = replayEvents({ races, results, seasons, constants });
  const run = scorePopulation({
    riders,
    byRider: replay.byRider,
    currentSeasonIndex,
    seedFloorWeight: SEED_FLOOR_WEIGHT,
    softCap: constants.SOFT_CAP,
    topN,
  });
  return { variant, run, replay };
}

function renderGridMarkdownTable(results) {
  const lines = [
    "| Variant | SOFT_CAP | ProSeries-vægt | ProSeries-gulv | Class1-gulv | p50 | p75 | p95 | max | ≥70 | ≥90 | ≥99 | Top-20 ≥70 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { variant, run } of results) {
    const star = `${run.starCount} (${pct(run.starShare)})`;
    const legend = `${run.legendCount} (${pct(run.legendShare)})`;
    const top20 = run.targets.topWinnersOk ? "JA" : `NEJ (${run.topWinnersBelowStar.map((r) => r.name).join(", ")})`;
    lines.push(`| ${variant.id} | ${variant.softCap} | ${variant.proSeriesWeight} | +${variant.proSeriesFloor} | +${variant.class1Floor} | ${run.p50.toFixed(1)} | ${run.p75.toFixed(1)} | ${run.p95.toFixed(1)} | ${run.max.toFixed(1)} | ${star} | ${legend} | ${run.legendCap99Count} | ${top20} |`);
  }
  return lines.join("\n");
}

function printGridConsole(results) {
  console.log("");
  console.log(`=== Omdømme-kalibrering — grid (${results.length} varianter, #1099) ===`);
  for (const { variant, run } of results) {
    console.log("");
    console.log(`  ${variant.id}: ${variantLabel(variant)}`);
    console.log(`    p50 ${run.p50.toFixed(1)} (${tick(run.targets.medianOk)}) · p75 ${run.p75.toFixed(1)} · p95 ${run.p95.toFixed(1)} · max ${run.max.toFixed(1)}`);
    console.log(`    ≥70: ${run.starCount} (${pct(run.starShare)}, ${tick(run.targets.starShareOk)}) · ≥90: ${run.legendCount} (${pct(run.legendShare)}, ${tick(run.targets.legendShareOk)}) · ≥99: ${run.legendCap99Count}`);
    console.log(`    top-20 alle ≥70: ${tick(run.targets.topWinnersOk)}${run.topWinnersBelowStar.length ? ` (under: ${run.topWinnersBelowStar.map((r) => r.name).join(", ")})` : ""}`);
  }
  console.log("");
}

// ── CLI ──────────────────────────────────────────────────────────────────

function parseSetOverrides(argv) {
  const overrides = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--set") continue;
    const pair = argv[i + 1];
    if (!pair || !pair.includes("=")) continue;
    const eqIndex = pair.indexOf("=");
    const path = pair.slice(0, eqIndex);
    const raw = pair.slice(eqIndex + 1);
    if (path === "NO_FLOOR_CREDIT_CLASSES") {
      overrides[path] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const num = Number(raw);
      overrides[path] = raw.trim() !== "" && Number.isFinite(num) ? num : raw;
    }
  }
  return overrides;
}

async function main() {
  const argv = process.argv.slice(2);
  const markdown = argv.includes("--markdown");
  const grid = argv.includes("--grid");
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
  const teamNamesById = await loadTeamNamesById(supabase);
  const currentSeasonIndex = Number(replay.activeSeason?.number ?? 0);

  if (grid) {
    const results = GRID_VARIANTS.map((variant) => runVariant({
      variant,
      races: replay.races,
      results: replay.results,
      seasons: replay.seasons,
      riders,
      currentSeasonIndex,
      topN,
    }));
    if (markdown) {
      console.log(`## Grid — ${results.length} varianter (SEED_FLOOR_WEIGHT fast 1,0)`);
      console.log("");
      console.log(renderGridMarkdownTable(results));
    } else {
      printGridConsole(results);
    }
    process.exit(0);
  }

  const overrides = parseSetOverrides(argv);
  const constants = buildConstants(overrides);
  const constantsLabel = Object.keys(overrides).length
    ? Object.entries(overrides).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`).join(", ")
    : `SOFT_CAP=${constants.SOFT_CAP} (produktions-default)`;
  // replayEvents() returnerer KUN afspilningsdelen (events/byRider/coverage/…),
  // ikke races/seasons/activeSeason — dem beholder vi fra den oprindelige
  // runReplay()-hentning, som er identisk uanset overrides (kun hændelses-
  // udledningen ændrer sig, ikke hvilke løb/sæsoner der findes).
  const singleReplay = Object.keys(overrides).length
    ? { ...replay, ...replayEvents({ races: replay.races, results: replay.results, seasons: replay.seasons, constants }) }
    : replay;
  const run = scorePopulation({
    riders,
    byRider: singleReplay.byRider,
    currentSeasonIndex,
    seedFloorWeight: SEED_FLOOR_WEIGHT,
    softCap: constants.SOFT_CAP,
    topN,
    teamNamesById,
  });

  if (markdown) {
    console.log(renderMarkdown({ run, replay: singleReplay, topN, constantsLabel }));
  } else {
    printConsole({ run, replay: singleReplay, constantsLabel });
  }

  const allOk = Object.values(run.targets).every(Boolean);
  process.exit(allOk ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("reputation-calibration.js")) {
  main().catch((err) => {
    console.error(`reputation-calibration fejlede: ${err.message}`);
    process.exit(2);
  });
}

export { bandFor };
