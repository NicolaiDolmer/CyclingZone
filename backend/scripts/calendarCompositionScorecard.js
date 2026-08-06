#!/usr/bin/env node
// backend/scripts/calendarCompositionScorecard.js
// #3295: mål en sæsonkalenders TERRÆN-KOMPOSITION mod ejerens K-B-beslutning (6/8),
// plus etaperækkefølge (#3326) og arketype-variation (#3371). RØRER INTET I DB.
//
//   node scripts/calendarCompositionScorecard.js --season 2     # eksisterende sæson
//   node scripts/calendarCompositionScorecard.js --plan 3       # sæson der IKKE findes endnu
//   node scripts/calendarCompositionScorecard.js --plan 3 --json
//
// TO MODES, fordi S3 ikke findes endnu:
//
//   --season N   Læser sæsonens FAKTISKE løbssæt fra races og regenererer profilerne
//                in-memory (samme data-lag som raceRouteRealismScorecard.js). Bruges til
//                at måle en kalender der allerede er materialiseret.
//
//   --plan N     Kører HELE selection+packing-pipelinen (materializeTierCalendars med
//                dryRun) for en sæson der endnu ikke er materialiseret, og måler PLANEN.
//                Det er den eneste måde at se S3's komposition før den skrives — og
//                dry-run er materializerens DEFAULT, så intet kan skrives ved et uheld.
//
// Begge modes måler det parcours skrive-stien VILLE producere: samme
// generateRaceStageProfiles, samme seed-kontekst (external_id + terrain_archetype +
// season_id) og samme #3347-re-draw-variant.
//
// NÆVNER: antal etaper = løbsdage. Én repræsentativ pulje pr. tier (puljer i en tier
// deler identisk kalender, #2276), så tier-tallene summer til game-day-kvoterne
// 140/112/84/56 og sæson-aggregatet vægtes efter dage der faktisk køres.
//
// EXIT-KONTRAKT (samme tre udfald som #2854/raceRouteRealismScorecard.js):
//   0 = GO      · kompositionen ligger inden for tolerancen OG rækkefølge-kriterierne holder
//   1 = NO-GO   · mindst ét mål blev målt og brudt
//   2 = UKENDT  · gaten kunne ikke vurdere det den skal (0 løb, manglende creds, fejl)
// Kun exit 0 er grønt. Aldrig GO på tomt grundlag.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSeasonTierRaces } from "./raceRouteRealismScorecard.js";
import { materializeTierCalendars } from "../lib/tierCalendarMaterializer.js";
import { GENERATOR_VERSION } from "../lib/raceStageProfileGenerator.js";
import {
  ACTIVE_TARGET, KB_TARGET_FULL, KB_TARGET_INTERIM, TTT_ENGINE_SUPPORTED,
  COMPOSITION_CATEGORIES, CATEGORY_LABELS, COMPOSITION_TOLERANCE_PP,
  computeCompositionStats, aggregateCompositionStats, detectCompositionViolations,
} from "../lib/calendarCompositionTargets.js";
import { computeStageOrderStats, detectStageOrderViolations, STAGE_ORDER_TARGETS } from "../lib/stageOrderMetrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

export const VERDICT = Object.freeze({ GO: "GO", NO_GO: "NO-GO", UNKNOWN: "UKENDT" });
export const EXIT_CODE = Object.freeze({ [VERDICT.GO]: 0, [VERDICT.NO_GO]: 1, [VERDICT.UNKNOWN]: 2 });

// Sæson-UUID følger computeSeasonUuid(n) i seasonTransition.js: hex(n).padStart(12,'0').
export function seasonUuid(n) {
  return `00000000-0000-0000-0000-${Number(n).toString(16).padStart(12, "0")}`;
}

/**
 * Mode --plan: kør selection+packing i dry-run for en sæson der (måske) ikke findes,
 * og træk de målbare tier-entries ud af summary'en.
 * materializeTierCalendars har dryRun=true som DEFAULT — vi sender den eksplicit
 * alligevel, så intet fremtidigt default-skift kan gøre dette script skrivende.
 */
export async function collectPlannedTierEntries({ supabase, seasonNumber, materialize = materializeTierCalendars, log = () => {} }) {
  const summary = await materialize({ supabase, seasonId: seasonUuid(seasonNumber), dryRun: true, log });
  return summary.tiers.map((t) => ({
    tier: t.tier,
    compositionStats: t.compositionStats,
    stageOrderStats: t.stageOrderStats,
    errors: [
      ...(t.compositionStats ? [] : [`tier ${t.tier}: ingen repræsentativ pulje at måle (0 live puljer i tieren?)`]),
      ...(t.quotaHit === false ? [`tier ${t.tier}: kvoten blev ikke fyldt (mangler ${t.shortfall} game-days) — kompositionen måles på en ufuldstændig kalender`] : []),
    ],
    plan: { quota: t.quota, totalGameDays: t.totalGameDays, quotaHit: t.quotaHit, shortfall: t.shortfall, calendarViolations: t.calendarViolations },
  }));
}

/**
 * Mode --season: regenerér en materialiseret sæsons profiler in-memory.
 */
export async function collectExistingTierEntries({ supabase, seasonNumber }) {
  const entries = await collectSeasonTierRaces({ supabase, seasonNumber });
  return entries.map((e) => ({
    tier: e.tier,
    compositionStats: computeCompositionStats(e.races),
    stageOrderStats: computeStageOrderStats(e.races),
    errors: [...(e.errors ?? []), ...(e.draw?.exhausted ? [`tier ${e.tier}: alle realisme-gen-træk brød båndene (#3347) — profilen er målt på det kanoniske træk`] : [])],
    plan: null,
    draw: e.draw ?? null,
  }));
}

/**
 * Sæson-aggregat + verdict. Ren funktion, så gatens beslutning kan testes uden DB.
 */
export function scoreComposition(tierEntries = [], { target = ACTIVE_TARGET } = {}) {
  const failures = [];
  const unassessed = [];
  const tiers = [];

  for (const e of tierEntries) {
    for (const err of e.errors ?? []) unassessed.push(err);

    if (!e.compositionStats || e.compositionStats.raceDays === 0) {
      unassessed.push(`tier ${e.tier}: 0 løbsdage at måle komposition på`);
      tiers.push({ ...e, compositionRows: [], compositionViolations: [], stageOrderViolations: [] });
      continue;
    }

    // Pr. tier bruges den skalerede tolerance (±2 pp ELLER ±2 løbsdage): tier 4 har kun
    // 56 dage, så én etape flytter 1,8 pp og en ren ±2 pp-grænse ville gøre tieren
    // umulig at ramme stabilt. Sæson-aggregatet (392 dage) bruger den skarpe ±2 pp.
    const { rows, violations } = detectCompositionViolations({
      stats: e.compositionStats, target, label: `tier ${e.tier}`, applyMinRaceDayTolerance: true,
    });
    const orderViolations = detectStageOrderViolations({ stats: e.stageOrderStats, label: `tier ${e.tier}` });

    failures.push(...violations, ...orderViolations);
    tiers.push({ ...e, compositionRows: rows, compositionViolations: violations, stageOrderViolations: orderViolations });
  }

  const measured = tierEntries.map((e) => e.compositionStats).filter((s) => s && s.raceDays > 0);
  const season = aggregateCompositionStats(measured);

  // Et TOMT sæson-aggregat må ikke score: alle kategorier ville stå 0 % mod deres mål og
  // blive til lige så mange "båndbrud", hvilket ville melde NO-GO på fravær af evidens.
  // 0 løbsdage er UKENDT, ikke skævt (#2854 — samme kontrakt som scoreSeason i
  // raceRouteRealismMetrics.js, hvor "0 løb at score" er unassessed, ikke en failure).
  let seasonScore = { rows: [], violations: [] };
  if (measured.length === 0) {
    unassessed.push("ingen tier kunne måles — kalenderen gav 0 løbsdage");
  } else {
    seasonScore = detectCompositionViolations({ stats: season, target, label: "sæson (alle tiers)" });
    failures.push(...seasonScore.violations);
  }

  const verdict = failures.length ? VERDICT.NO_GO : unassessed.length ? VERDICT.UNKNOWN : VERDICT.GO;
  return {
    target, tiers, season, seasonRows: seasonScore.rows,
    failures, unassessed, verdict, exitCode: EXIT_CODE[verdict],
  };
}

// ── Render ──────────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 5, d = 1) => v.toFixed(d).padStart(n);

function compositionTable(rows, raceDays) {
  const lines = [
    `    ${pad("terræn", 9)} ${pad("faktisk", 8)} ${pad("mål", 6)} ${pad("afvigelse", 10)} status`,
  ];
  for (const r of rows) {
    const delta = `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)} pp`;
    lines.push(`    ${pad(r.label, 9)} ${pad(num(r.actual) + " %", 8)} ${pad(r.target + " %", 6)} ${pad(delta, 10)} ${r.pass ? "OK" : `UDENFOR ±${r.tolerance.toFixed(1)} pp`}`);
  }
  lines.push(`    (${raceDays} løbsdage)`);
  return lines;
}

export function formatScorecard(summary, { seasonNumber, mode }) {
  const targetName = TTT_ENGINE_SUPPORTED ? "K-B fuld" : "K-B interim (TTT-motor mangler)";
  const lines = [
    ``,
    `=== Kalender-kompositions-scorecard — sæson ${seasonNumber} (${mode}, generator v${GENERATOR_VERSION}) ===`,
    ``,
    `Målprofil: ${targetName} — ${COMPOSITION_CATEGORIES.map((c) => `${CATEGORY_LABELS[c]} ${summary.target[c]}`).join(" · ")} (% af løbsdage)`,
    `Tolerance: ±${COMPOSITION_TOLERANCE_PP} pp samlet · pr. tier ±${COMPOSITION_TOLERANCE_PP} pp eller ±2 løbsdage (hvad der er størst)`,
    ``,
  ];

  if (!TTT_ENGINE_SUPPORTED) {
    lines.push(
      `⚠ TTT-forbeholdet er AKTIVT: race-motoren scorer en TTT-etape som en individuel`,
      `  enkeltstart (terrainBucket("ttt") → "itt"), så K-B's TTT 4 % er sat til 0 og de`,
      `  4 pp fordelt på ITT (8→10) og kuperet (30→32). Flip TTT_ENGINE_SUPPORTED i`,
      `  lib/calendarCompositionTargets.js når motoren kan simulere ægte holdtidskørsel.`,
      ``,
    );
  }

  for (const t of summary.tiers) {
    const hasViolations = t.compositionViolations.length || t.stageOrderViolations.length;
    const mark = !t.compositionStats || t.compositionStats.raceDays === 0 ? "⚠" : hasViolations ? "❌" : "✅";
    const drawNote = t.draw?.attempt > 0 ? ` [realisme-gen-træk ${t.draw.attempt}, #3347]` : "";
    const planNote = t.plan ? ` [plan: ${t.plan.totalGameDays}/${t.plan.quota} game-days${t.plan.quotaHit ? "" : ` — MANGLER ${t.plan.shortfall}`}]` : "";
    lines.push(`${mark} Tier ${t.tier}${drawNote}${planNote}`);
    if (t.compositionRows.length) lines.push(...compositionTable(t.compositionRows, t.compositionStats.raceDays));

    const o = t.stageOrderStats;
    if (o && o.stageRaces > 0) {
      lines.push(
        `    rækkefølge (#3326): ${num(o.mountainFinishPct)} % slutter i bjerg (maks ${STAGE_ORDER_TARGETS.mountain_finish_max_pct}) · ` +
        `${num(o.mountainFirstHalfPct)} % har bjerg i 1. halvdel (min ${STAGE_ORDER_TARGETS.mountain_first_half_min_pct}) · ` +
        `mest delte sekvens ${o.maxSharedSequence} løb (maks ${STAGE_ORDER_TARGETS.max_shared_sequence})`,
        `    åbning: ${num(o.flatOpenPct)} % flad · ${num(o.mountainOpenPct)} % bjerg · ${num(o.ittOpenPct)} % ITT` +
        `   |   variation: ${o.distinctSequences} distinkte sekvenser af ${o.stageRaces} etapeløb · ${o.distinctArchetypes} arketyper (#3371)`,
      );
    }
    lines.push(``);
  }

  lines.push(`── SÆSON I ALT ──`, ...compositionTable(summary.seasonRows, summary.season.raceDays), ``);

  if (summary.unassessed.length) {
    lines.push(`⚠ Kunne ikke vurderes (${summary.unassessed.length}):`);
    for (const u of summary.unassessed) lines.push(`   · ${u}`);
    lines.push(``);
  }
  if (summary.failures.length) {
    lines.push(`❌ Brud (${summary.failures.length}):`);
    for (const f of summary.failures) lines.push(`   · ${f}`);
    lines.push(``);
  }

  lines.push({
    GO: `✅ GO — kompositionen rammer ${targetName} inden for tolerancen, og rækkefølge-kriterierne holder (exit 0)`,
    "NO-GO": `❌ NO-GO — ${summary.failures.length} brud (exit 1)`,
    UKENDT: `⚠ KUNNE IKKE VURDERES — ${summary.unassessed.length} delscore(r) uden datagrundlag (exit 2)`,
  }[summary.verdict], ``);

  return lines;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
  const planArg = argOf("--plan");
  const seasonArg = argOf("--season");
  const asJson = process.argv.includes("--json");
  const mode = planArg ? "dry-run-plan" : "in-memory regen";
  const seasonNumber = Number(planArg ?? seasonArg ?? 2);

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ KUNNE IKKE VURDERES — Missing SUPABASE creds (exit 2)"); process.exit(2); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const tierEntries = planArg
      ? await collectPlannedTierEntries({ supabase, seasonNumber })
      : await collectExistingTierEntries({ supabase, seasonNumber });
    const summary = scoreComposition(tierEntries);
    if (asJson) console.log(JSON.stringify({ seasonNumber, mode, ...summary }, null, 2));
    else for (const line of formatScorecard(summary, { seasonNumber, mode })) console.log(line);
    process.exitCode = summary.exitCode;
  } catch (e) {
    console.error(e);
    console.error("\n⚠ KUNNE IKKE VURDERES — scorecardet nåede aldrig en verdict (exit 2)");
    process.exitCode = 2;
  }
}
