#!/usr/bin/env node
// backend/scripts/v4FlipReadiness.mjs
// #5515: FLIP-KLAR-RAPPORT for engine-v4 — ejerens ét samlede grundlag for at
// sige "flip" (lovet i ejer-kommentaren paa #4916 22/9). Samler de maalinger
// flip-gaten i spec'en 6/9 kraever (docs/superpowers/specs/
// 2026-09-06-race-engine-v4-flip-and-tactics-design.md §3 "Gate foer klar til
// flip") i ÉN koersel paa de PINNEDE filer:
//
//   (1) v3 mod v4 head-to-head paa 5 seeds (s1-s5): alle ankre, middel + spaend,
//       plus hvor mange enkelt-seeds der bestaar (RULES §7 raekke 8: gaten er
//       seed-middel, et enkelt seed kan hverken erklaere groent eller roedt).
//   (2) Hale-gaten paa de 3 ejer-laaste seeds (RULES §9 raekke 13) mod den
//       pinnede 09-07-population — praecis som gaten er defineret, ikke paa 5.
//   (3) Uhelds- og OTL-rate pr. etapetype (v4), fra de samme 5-seed-koersler.
//   (4) Ydelse: ms pr. etape ved 180 og 192 ryttere mod flip-gatens 60 s.
//   (6) Flip-infrastrukturens og kill-switchens EKSISTERENDE tests koeres og
//       rapporteres (spec 6/9: "kill-switch-test groen").
//
// RULES §9-tjeklisten (5) og de kendte roede punkter (7) er prosa i selve
// rapporten, ikke genereret — de er kildehenvisninger, ikke maalinger.
//
// HVAD DEN IKKE GOER: den aendrer intet i motoren, tuning.ts eller baseline-
// JSON'en (backend/scripts/baselines/v4-anchor-baseline.json). Den flipper
// intet. Den er 100 % READ-ONLY mod DB og git og skriver kun til de stier den
// faar som argumenter.
//
// OFFENTLIGHEDSPOLITIK (hard rule 17, #3436): repoet er offentligt. Rapporten
// deles derfor i TO:
//   * den OFFENTLIGE blok (--write-report) har ankrenes NAVNE og PASS/FAIL,
//     antal seeds der bestaar, og ydelses-tal (ms — ikke et balance-tal).
//     Ingen maalte anker-vaerdier, rater, baand-graenser eller vaegte.
//     `renderPublicBlock` er testet for at holde det loefte.
//   * den PRIVATE fil (--private-out, default under den gitignorerede
//     `balance-internals/`) har alle tallene: middel, spaend, rater pr. type.
//
// Usage (fra repo-roden):
//   node backend/scripts/v4FlipReadiness.mjs \
//     --write-report=docs/audits/2026-09-23-v4-flip-klar-rapport.md \
//     --private-out=balance-internals/5515-v4-flip-klar/2026-09-23-tal.md
//
//   Flag: --seeds=s1,...  (default s1-s5) · --tail-seeds=s1,s2,s3 (ejer-laast,
//   aendr kun bevidst) · --perf-sizes=180,192 · --json=<fil> (raa resultat) ·
//   --skip-tests (spring (6) over, fx under udvikling).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { runHeadToHead } from "./headToHeadV4.js";
import { aggregateScorecards, buildScorecard } from "./lib/headToHeadAnchors.js";
import { evaluateTailGate, runTailSpread } from "./v4TailSpread.js";
import { displayFor } from "./renderV4AnchorTable.mjs";
import { sampleField } from "./lib/headToHeadStats.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { stableSeed } from "../lib/raceSimulator.js";
import { rankedFromV4Output } from "../lib/raceEngineV4Bridge.js";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

// Samme to PINNEDE filer som ankertabellen i RULES §7b (#4911/#4936). Re-
// eksportér dem ALDRIG her: to ankre skiftede dom af populationsskiftet alene.
export const POPULATION_FILE = "backend/scripts/baselines/population-snapshot-2026-09-07.json";
export const STAGES_FILE = "backend/scripts/baselines/v4-proxy-stages-2026-09-06.json";
// Flip-gaten: "alle ankre groenne paa pinnet population + 5 seeds" (spec 6/9 §3).
export const HEAD_TO_HEAD_SEEDS = Object.freeze(["s1", "s2", "s3", "s4", "s5"]);
// Hale-gaten er ejer-laast paa 3 seeds (RULES §9 raekke 13) — koeres praecis
// saadan, jf. praecedensen i teamPlayAbMeasure.mjs.
export const TAIL_GATE_SEEDS = Object.freeze(["s1", "s2", "s3"]);
export const FIELD_SIZE = 180;
// 180 = gatens feltstoerrelse (spec 6/9). 192 = det stoerste felt prod har haft
// pr. loeb (race_entries maks 192, GAME_INVARIANTS.md #3331-auditten).
export const PERF_FIELD_SIZES = Object.freeze([180, 192]);
// Spec 6/9 §3: "én v4-etape med 180 ryttere under 60 sekunder". Etaper koeres
// hver hele time, saa en etape der ikke er faerdig inden naeste tick er en
// flip-blokker (raceEngineV4Bridge.test.js haandhaever samme graense).
export const PERF_GATE_MS = 60_000;
// Ejer-maalet for uheld (RULES §2c + §9 raekke 4): ca. 1-2 % af rytterne pr.
// etape, maalt samlet over alle etaper — ikke pr. etapetype.
export const OWNER_INCIDENT_TARGET = Object.freeze({ min: 0.01, max: 0.02 });

export const START_MARKER = "<!-- v4-flip-readiness:start -->";
export const END_MARKER = "<!-- v4-flip-readiness:end -->";

// ---------------------------------------------------------------------------
// (1) Ankre: middel + spaend (aggregateScorecards) + antal bestaaede seeds
// ---------------------------------------------------------------------------

function emptyVerdictCount() {
  return { PASS: 0, FAIL: 0, "N/A": 0 };
}

/**
 * Taeller PASS/FAIL/N-A pr. anker og motor paa tvaers af enkelt-seed-scorecards.
 * Et enkelt seed afgoer IKKE gaten (RULES §7 raekke 8) — tallet vises saa
 * ejeren kan se om en middel-dom hviler paa alle seeds eller paa et flertal.
 * @param {Array<Array<object>>} perSeedScorecards  ét buildScorecard-output pr. seed
 * @returns {Map<string, {v3: object, v4: object}>}
 */
export function countSeedVerdicts(perSeedScorecards) {
  const counts = new Map();
  for (const card of perSeedScorecards) {
    for (const anchor of card) {
      if (!counts.has(anchor.id)) counts.set(anchor.id, { v3: emptyVerdictCount(), v4: emptyVerdictCount() });
      const entry = counts.get(anchor.id);
      entry.v3[anchor.v3?.verdict ?? "N/A"] += 1;
      entry.v4[anchor.v4?.verdict ?? "N/A"] += 1;
    }
  }
  return counts;
}

/**
 * Samler anker-gaten: dom paa seed-MIDDEL (aggregateScorecards' egen dom) +
 * antal bestaaede enkelt-seeds. v4 er "alle ankre groenne" kun hvis INGEN
 * v4-celle er FAIL; N/A-ankre listes separat (de er ikke maalt, ikke groenne).
 * @param {Array<object>} aggregated  aggregateScorecards-output
 * @param {Map<string, {v3: object, v4: object}>} seedCounts  countSeedVerdicts-output
 * @param {number} seedCount
 */
export function summarizeAnchorGate(aggregated, seedCounts, seedCount) {
  const rows = aggregated.map((anchor) => {
    const counts = seedCounts.get(anchor.id) ?? { v3: emptyVerdictCount(), v4: emptyVerdictCount() };
    return {
      id: anchor.id,
      label: anchor.label,
      source: anchor.source,
      bandLabel: anchor.bandLabel,
      v3: {
        verdict: anchor.v3?.verdict ?? "N/A",
        value: anchor.v3?.value ?? null,
        spread: anchor.v3?.spread ?? null,
        seedsPass: counts.v3.PASS,
        seedsMeasured: counts.v3.PASS + counts.v3.FAIL,
      },
      v4: {
        verdict: anchor.v4?.verdict ?? "N/A",
        value: anchor.v4?.value ?? null,
        spread: anchor.v4?.spread ?? null,
        seedsPass: counts.v4.PASS,
        seedsMeasured: counts.v4.PASS + counts.v4.FAIL,
      },
    };
  });
  const v4Fail = rows.filter((r) => r.v4.verdict === "FAIL").map((r) => r.id);
  const v4NotMeasured = rows.filter((r) => r.v4.verdict === "N/A").map((r) => r.id);
  const v4Pass = rows.filter((r) => r.v4.verdict === "PASS").map((r) => r.id);
  return { rows, seedCount, v4Pass, v4Fail, v4NotMeasured, v4AllGreen: v4Fail.length === 0 };
}

// ---------------------------------------------------------------------------
// (3) Uhelds- og OTL-rate pr. etapetype
// ---------------------------------------------------------------------------

function emptyRateBucket() {
  return {
    stages: 0,
    riderStarts: 0,
    incidents: 0,
    light: 0,
    hard: 0,
    serious: 0,
    mechanical: 0,
    abandoned: 0,
    otl: 0,
    stagesWithOtl: 0,
    rescued: 0,
    stagesWithRescue: 0,
  };
}

function countEventRiders(events, type) {
  return events
    .filter((e) => e.type === type)
    .reduce((sum, e) => sum + (Number(e.params?.rider_count) || 0), 0);
}

/**
 * Laegger én v4-etapes uheld/udgaaede/OTL til akkumulatoren under etapetypen
 * OG under "_total". OTL laeses fra `status` (motorens egen udfaldsklasse,
 * RULES §0), redninger fra tidslinjens grupetto-event.
 * @param {Map<string, object>} acc
 * @param {string} profileType
 * @param {object} v4Output  StageOutput
 */
export function accumulateStageRates(acc, profileType, v4Output) {
  const results = v4Output?.results ?? [];
  const incidents = v4Output?.incidents ?? [];
  const events = v4Output?.timeline?.events ?? [];
  const otl = results.filter((r) => r.status === "otl").length;
  const rescued = countEventRiders(events, "grupetto_saved");
  for (const key of [profileType ?? "?", "_total"]) {
    if (!acc.has(key)) acc.set(key, emptyRateBucket());
    const b = acc.get(key);
    b.stages += 1;
    b.riderStarts += results.length;
    b.abandoned += results.filter((r) => r.status === "abandoned").length;
    b.otl += otl;
    if (otl > 0) b.stagesWithOtl += 1;
    b.rescued += rescued;
    if (rescued > 0) b.stagesWithRescue += 1;
    for (const inc of incidents) {
      b.incidents += 1;
      if (inc.kind === "mechanical") b.mechanical += 1;
      else if (inc.severity === "serious") b.serious += 1;
      else if (inc.severity === "hard") b.hard += 1;
      else b.light += 1;
    }
  }
  return acc;
}

const ratio = (part, whole) => (whole > 0 ? part / whole : null);

/**
 * Reducerer akkumulatoren til rater. Uheldsraten er "andel af rytterne pr.
 * etape" (samme definition som headToHeadV4.js's formatIncidentSummary).
 * Dommen mod ejer-maalet gives KUN paa "_total" — maalet er samlet, ikke pr. type.
 */
export function summarizeRates(acc, target = OWNER_INCIDENT_TARGET) {
  const keys = [...acc.keys()].filter((k) => k !== "_total").sort();
  const toRow = (key) => {
    const b = acc.get(key);
    const crashes = b.light + b.hard + b.serious;
    return {
      key,
      ...b,
      incidentRate: ratio(b.incidents, b.riderStarts),
      abandonRate: ratio(b.abandoned, b.riderStarts),
      otlRate: ratio(b.otl, b.riderStarts),
      rescueRate: ratio(b.rescued, b.riderStarts),
      seriousShareOfCrashes: ratio(b.serious, crashes),
    };
  };
  const rows = keys.map(toRow);
  const total = acc.has("_total") ? toRow("_total") : null;
  const incidentVerdict =
    total?.incidentRate == null
      ? "N/A"
      : total.incidentRate >= target.min && total.incidentRate <= target.max
        ? "PASS"
        : "FAIL";
  return {
    rows,
    total,
    incidentVerdict,
    otlObserved: (total?.otl ?? 0) > 0,
    rescueObserved: (total?.rescued ?? 0) > 0,
    otlTypes: rows.filter((r) => r.otl > 0).map((r) => r.key),
    rescueTypes: rows.filter((r) => r.rescued > 0).map((r) => r.key),
  };
}

// ---------------------------------------------------------------------------
// (4) Ydelse
// ---------------------------------------------------------------------------

function percentileSorted(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * @param {Array<{ms:number, stageNumber:number|string, profileType:string}>} samples
 * @param {number} gateMs
 */
export function summarizeTimings(samples, gateMs = PERF_GATE_MS) {
  if (!samples.length) return { n: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null, worst: null, verdict: "N/A" };
  const sorted = [...samples].map((s) => s.ms).sort((a, b) => a - b);
  const worst = samples.reduce((a, b) => (b.ms > a.ms ? b : a));
  const meanMs = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    n: samples.length,
    meanMs,
    p50Ms: percentileSorted(sorted, 0.5),
    p95Ms: percentileSorted(sorted, 0.95),
    maxMs: worst.ms,
    worst: { stageNumber: worst.stageNumber, profileType: worst.profileType },
    headroomFactor: worst.ms > 0 ? gateMs / worst.ms : null,
    verdict: worst.ms < gateMs ? "PASS" : "FAIL",
  };
}

function v4Entrants(fieldRiders) {
  const teamByRider = new Map(fieldRiders.map((r) => [r.id, r.team_id ?? null]));
  const rows = fieldRiders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  return entrantsFromAbilitiesRows(rows, (riderId) => ({
    role: "free_role",
    effort: "normal",
    condition: 1,
    teamId: teamByRider.get(riderId) ?? null,
  }));
}

/**
 * Tager tid paa HELE v4-vejen for én etape, som prod-broen gaar den: rute-
 * adapter + startliste-adapter + motoren + oversaettelsen tilbage til v3's
 * `ranked`-form. DB-kald og persistering er IKKE med (de er motor-uafhaengige).
 */
export function runPerf({ population, stages, fieldSizes = PERF_FIELD_SIZES, seed = "perf" }) {
  const out = [];
  // Opvarmning (JIT): én utidsat koersel, saa foerste maaling ikke er en outlier.
  if (stages.length > 0) {
    const warm = sampleField(makeRng(stableSeed(`${seed}:warmup`)), population.riders, fieldSizes[0] ?? FIELD_SIZE);
    simulateStageV4({ route: routeFromStageProfileRow(stages[0]), startlist: v4Entrants(warm), orders: [], seed: `${seed}:warmup`, tuning: RACE_V4_TUNING });
  }
  for (const size of fieldSizes) {
    const samples = [];
    for (const stageRow of stages) {
      const stageSeed = `${seed}:${size}:${stageRow.stage_number ?? 1}`;
      const fieldRiders = sampleField(makeRng(stableSeed(`${stageSeed}:field`)), population.riders, size);
      const t0 = performance.now();
      const route = routeFromStageProfileRow(stageRow);
      const output = simulateStageV4({ route, startlist: v4Entrants(fieldRiders), orders: [], seed: stageSeed, tuning: RACE_V4_TUNING });
      rankedFromV4Output(output);
      const ms = performance.now() - t0;
      samples.push({ ms, stageNumber: stageRow.stage_number ?? "?", profileType: stageRow.profile_type ?? "?", fieldCount: fieldRiders.length });
    }
    out.push({ fieldSize: size, samples, summary: summarizeTimings(samples) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (6) Flip-infrastruktur + kill-switch: de eksisterende tests koeres, ikke
// genopfundet. Spec 6/9 §3: "kill-switch-test groen".
// ---------------------------------------------------------------------------

// Relativt til backend/. Flag/kaldssted/kill-switch · broen (inkl. 180-rytter-
// ydelsestesten) · v4-paritet mod v3's afvikling · TTT-grenen i broen.
export const FLIP_INFRA_TEST_FILES = Object.freeze([
  "lib/raceRunnerEngineV4.test.js",
  "lib/raceEngineV4Bridge.test.js",
  "lib/raceRunnerEngineV4Parity.test.js",
  "lib/raceEngineV4Bridge.teamTimeTrial.test.js",
]);

// Tests hvis NAVN goer dem til kill-switch-tests (flag off = v3 uroert, v4
// kan ikke indlaeses = fald tilbage, skift motor midt i et etapeloeb).
const KILL_SWITCH_NAME = /kill-switch|flag off|flag-off/iu;

/**
 * Parser node --test's TAP-output (--test-reporter=tap). Kun top-level-
 * linjer (ingen indrykning) er testresultater; indrykkede er subtests.
 * @param {string} tap
 */
export function parseTap(tap) {
  const tests = [];
  const summary = {};
  for (const line of String(tap).split(/\r?\n/u)) {
    const m = line.match(/^(not ok|ok) \d+ - (.*)$/u);
    if (m) {
      tests.push({ ok: m[1] === "ok", name: m[2].replace(/\\#/gu, "#").trim() });
      continue;
    }
    const s = line.match(/^# (tests|pass|fail|skipped|todo|cancelled) (\d+)$/u);
    if (s) summary[s[1]] = Number(s[2]);
  }
  const fail = summary.fail ?? tests.filter((t) => !t.ok).length;
  return {
    tests,
    total: summary.tests ?? tests.length,
    pass: summary.pass ?? tests.filter((t) => t.ok).length,
    fail,
    killSwitch: tests.filter((t) => KILL_SWITCH_NAME.test(t.name)),
    ok: fail === 0 && tests.length > 0,
  };
}

export function runFlipInfraTests(files = FLIP_INFRA_TEST_FILES) {
  const backendDir = join(REPO_ROOT, "backend");
  return files.map((file) => {
    let stdout;
    try {
      stdout = execFileSync(process.execPath, ["--test", "--import", "./test-setup.js", "--test-reporter=tap", file], {
        cwd: backendDir,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // Exit != 0 = mindst én test roed. Det er en DOM, ikke en scriptfejl.
      stdout = typeof err?.stdout === "string" ? err.stdout : "";
    }
    return { file: `backend/${file}`, ...parseTap(stdout) };
  });
}

// ---------------------------------------------------------------------------
// Rendering: offentlig blok (ingen balance-tal) + privat fil (alle tal)
// ---------------------------------------------------------------------------

const fmtMs = (ms) => (ms == null ? "n/a" : `${Math.round(ms).toLocaleString("da-DK")} ms`);
const fmtPct = (v, d = 2) => (v == null ? "n/a" : `${(v * 100).toFixed(d)} %`);

function verdictMark(verdict) {
  if (verdict === "PASS") return "PASS";
  if (verdict === "FAIL") return "**FAIL**";
  return "ikke maalt";
}

function seedsCell(engine, seedCount) {
  if (engine.verdict === "N/A") return "-";
  return `${engine.seedsPass}/${engine.seedsMeasured || seedCount}`;
}

/**
 * Den OFFENTLIGE blok. Hard rule 17: KUN anker-navne, kilder, PASS/FAIL, antal
 * seeds, ja/nej-observationer og ydelse (ms). Ingen maalte anker-vaerdier,
 * rater eller baand-graenser — de staar i den private fil.
 */
export function renderPublicBlock(result) {
  const { meta, anchors, tailGate, rates, perf, infraTests } = result;
  const lines = [];
  lines.push(START_MARKER);
  lines.push("");
  lines.push(
    "> **Genereret af `backend/scripts/v4FlipReadiness.mjs`, ikke haandskrevet.** Tallene bag dommene " +
      "(middel, spaend, rater) staar i den private fil (hard rule 17), ikke her. Ret ikke i blokken; koer scriptet igen.",
  );
  lines.push(">");
  lines.push(
    `> Koert ${meta.generated_at} paa motor-sha \`${meta.engine_sha}\` · population \`${meta.population_file}\` ` +
      `· etaper \`${meta.stages_file}\` (${meta.stage_count} etaper) · felt ${meta.field_size} · orders=none.`,
  );
  lines.push("");
  lines.push(`### 1. Ankre, v3 mod v4 (${anchors.seedCount} seeds: ${meta.seeds.join(", ")})`);
  lines.push("");
  lines.push("Dommen er paa seed-middel (RULES §7 raekke 8). \"Seeds\" = antal enkelt-seeds der bestaar for sig; baandene staar i RULES §7b.");
  lines.push("");
  lines.push("| Anker | v3 | v3 seeds | v4 | v4 seeds |");
  lines.push("|---|---|---|---|---|");
  for (const r of anchors.rows) {
    lines.push(
      `| ${r.label} | ${verdictMark(r.v3.verdict)} | ${seedsCell(r.v3, anchors.seedCount)} | ${verdictMark(r.v4.verdict)} | ${seedsCell(r.v4, anchors.seedCount)} |`,
    );
  }
  lines.push("");
  lines.push(
    `**v4 samlet:** ${anchors.v4Pass.length} PASS · ${anchors.v4Fail.length} FAIL · ${anchors.v4NotMeasured.length} ikke maalt. ` +
      `Flip-gatens krav "alle ankre groenne": **${anchors.v4AllGreen && anchors.v4NotMeasured.length === 0 ? "OPFYLDT" : "IKKE OPFYLDT"}**.`,
  );
  lines.push("");
  lines.push(`### 2. Hale-gaten (ejer-laast, ${meta.tail_seeds.length} seeds: ${meta.tail_seeds.join(", ")})`);
  lines.push("");
  lines.push("| Etapetype | Dom |");
  lines.push("|---|---|");
  for (const r of tailGate.gatedRows) lines.push(`| ${r.profileType} | ${verdictMark(r.status)} |`);
  lines.push("");
  lines.push(`**Samlet hale-gate:** ${tailGate.allPass ? "PASS" : "**FAIL**"}. Ikke-laaste etapetyper rapporteres kun i den private fil.`);
  lines.push("");
  lines.push(`### 3. Uheld og tidsgraense (v4, ${anchors.seedCount} seeds x ${meta.stage_count} etaper)`);
  lines.push("");
  lines.push(
    `- **Uheldsrate samlet mod ejer-maalet** (RULES §2c / §9 raekke 4): ${verdictMark(rates.incidentVerdict)}.`,
  );
  lines.push(
    `- **OTL forekommer:** ${rates.otlObserved ? "ja" : "**nej**"}` +
      (rates.otlTypes.length ? ` (etapetyper: ${rates.otlTypes.join(", ")})` : "") + ".",
  );
  lines.push(
    `- **Grupetto-redning udloeses:** ${rates.rescueObserved ? "ja" : "**nej**"}` +
      (rates.rescueTypes.length ? ` (etapetyper: ${rates.rescueTypes.join(", ")})` : "") + ".",
  );
  lines.push("- Rater pr. etapetype (uheld, alvorlige styrt, udgaaede, OTL, redninger) staar i den private fil.");
  lines.push("");
  lines.push(`### 4. Ydelse (gate: under ${PERF_GATE_MS / 1000} s pr. etape)`);
  lines.push("");
  lines.push("| Felt | Etaper | Middel | p95 | Maks (etapetype) | Dom |");
  lines.push("|---|---|---|---|---|---|");
  for (const p of perf) {
    const s = p.summary;
    lines.push(
      `| ${p.fieldSize} | ${s.n} | ${fmtMs(s.meanMs)} | ${fmtMs(s.p95Ms)} | ${fmtMs(s.maxMs)} (${s.worst?.profileType ?? "n/a"}) | ${verdictMark(s.verdict)} |`,
    );
  }
  lines.push("");
  lines.push(
    `Maalt paa ${meta.host} (${meta.node}), rute-adapter + motor + oversaettelse til v3's ranked-form, uden DB. ` +
      "Railway-containerens CPU er ikke maalt her.",
  );
  if (infraTests?.length) {
    lines.push("");
    lines.push("### 5. Flip-infrastruktur og kill-switch (eksisterende tests, koert nu)");
    lines.push("");
    lines.push("| Testfil | Resultat | Heraf kill-switch-tests |");
    lines.push("|---|---|---|");
    for (const t of infraTests) {
      const ks = t.killSwitch.length ? `${t.killSwitch.filter((k) => k.ok).length}/${t.killSwitch.length} groenne` : "-";
      lines.push(`| \`${t.file}\` | ${t.ok ? "groen" : "**ROED**"} (${t.pass}/${t.total}) | ${ks} |`);
    }
    const allKill = infraTests.flatMap((t) => t.killSwitch);
    lines.push("");
    lines.push(
      `**Kill-switch samlet:** ${allKill.length > 0 && allKill.every((k) => k.ok) ? "groen" : "**ROED**"} ` +
        `(${allKill.filter((k) => k.ok).length}/${allKill.length}). Testene er lokale enhedstests med stub-DB, ikke en prod-oevelse.`,
    );
  }
  lines.push("");
  lines.push(END_MARKER);
  return lines.join("\n");
}

function anchorCell(id, cell) {
  if (!cell || cell.verdict === "N/A" || !Number.isFinite(cell.value)) return "n/a";
  const spread = cell.spread ? ` (${displayFor(id, cell.spread.min)}-${displayFor(id, cell.spread.max)})` : "";
  return `${displayFor(id, cell.value)}${spread} ${cell.verdict}`;
}

/** Den PRIVATE fil (balance-internals/, gitignoreret): alle tal. */
export function renderPrivateReport(result) {
  const { meta, anchors, tailGate, rates, perf } = result;
  const lines = [];
  lines.push(`# v4 flip-klar-rapport: tal (PRIVAT, hard rule 17) — ${meta.generated_at}`);
  lines.push("");
  lines.push("Gitignoreret. Offentlig udgave: `docs/audits/2026-09-23-v4-flip-klar-rapport.md`. Regenereres med samme kommando.");
  lines.push("");
  lines.push(`Motor-sha ${meta.engine_sha} · ${meta.population_file} · ${meta.stages_file} · felt ${meta.field_size} · orders=none.`);
  lines.push("");
  lines.push(`## 1. Ankre (${meta.seeds.join(", ")}): middel (min-max) dom · seeds bestaaet`);
  lines.push("");
  lines.push("| Anker | Baand | v3 | v3 seeds | v4 | v4 seeds |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of anchors.rows) {
    lines.push(
      `| ${r.label} | ${r.bandLabel} | ${anchorCell(r.id, r.v3)} | ${seedsCell(r.v3, anchors.seedCount)} | ${anchorCell(r.id, r.v4)} | ${seedsCell(r.v4, anchors.seedCount)} |`,
    );
  }
  lines.push("");
  lines.push(`## 2. Hale-gate (${meta.tail_seeds.join(", ")}): ren p90 pooled, middel og spaend pr. seed`);
  lines.push("");
  lines.push("| Etapetype | n | ren p90 % | baand | dom | middel pr. seed % | spaend pr. seed % |");
  lines.push("|---|---|---|---|---|---|---|");
  const f = (v) => (v == null ? "n/a" : v.toFixed(2));
  for (const r of tailGate.rows) {
    lines.push(
      `| ${r.profileType} | ${r.n} | ${f(r.value)} | ${r.band ? `${r.band[0]}-${r.band[1]}` : "-"} | ${r.status} | ${f(r.meanPerSeed)} | ${f(r.minPerSeed)}-${f(r.maxPerSeed)} |`,
    );
  }
  lines.push("");
  lines.push("## 3. Uheld og tidsgraense pr. etapetype (v4)");
  lines.push("");
  lines.push("| Etapetype | etaper | rytter-starter | uheld % | let/haard/alvorlig/mek | alvorlige af styrt % | udgaaet % | OTL % | etaper m. OTL | reddet % | etaper m. redning |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of [...rates.rows, ...(rates.total ? [rates.total] : [])]) {
    lines.push(
      `| ${r.key} | ${r.stages} | ${r.riderStarts} | ${fmtPct(r.incidentRate)} | ${r.light}/${r.hard}/${r.serious}/${r.mechanical} | ${fmtPct(r.seriousShareOfCrashes, 1)} | ${fmtPct(r.abandonRate, 3)} | ${fmtPct(r.otlRate, 3)} | ${r.stagesWithOtl} | ${fmtPct(r.rescueRate, 3)} | ${r.stagesWithRescue} |`,
    );
  }
  lines.push("");
  lines.push(`Uheldsrate samlet mod ejer-maalet ${fmtPct(OWNER_INCIDENT_TARGET.min, 0)}-${fmtPct(OWNER_INCIDENT_TARGET.max, 0)}: ${rates.incidentVerdict}.`);
  lines.push("");
  lines.push("## 4. Ydelse");
  lines.push("");
  for (const p of perf) {
    const s = p.summary;
    lines.push(
      `- Felt ${p.fieldSize}: n=${s.n}, middel ${fmtMs(s.meanMs)}, p50 ${fmtMs(s.p50Ms)}, p95 ${fmtMs(s.p95Ms)}, maks ${fmtMs(s.maxMs)} ` +
        `(etape ${s.worst?.stageNumber}, ${s.worst?.profileType}), luft til gaten x${s.headroomFactor?.toFixed(0) ?? "n/a"} — ${s.verdict}.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function replaceBlock(existingText, block) {
  const start = existingText.indexOf(START_MARKER);
  const end = existingText.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end < start) return null;
  return `${existingText.slice(0, start)}${block}${existingText.slice(end + END_MARKER.length)}`;
}

// ---------------------------------------------------------------------------
// Orkestrering
// ---------------------------------------------------------------------------

/**
 * Koerer (1)+(3) i ét pas pr. seed og kaster de raa etape-outputs vaek efter
 * hvert seed (5 x 141 etaper med fulde tidslinjer holdes ikke i hukommelsen).
 */
export function measureHeadToHead({ population, stages, seeds = HEAD_TO_HEAD_SEEDS, fieldSize = FIELD_SIZE }) {
  const teamByRider = new Map(population.riders.map((r) => [r.id, r.team_id ?? null]));
  const abilitiesByRider = new Map(population.riders.map((r) => [r.id, r.abilities]));
  // Samme opslag som headToHeadV4.main() bygger over HELE populationen (bruges
  // af holddominans-ankeret til hold-id).
  const v4EntrantsById = Object.fromEntries(v4Entrants(population.riders).map((e) => [e.rider_id, e]));
  const scorecards = [];
  const rateAcc = new Map();
  for (const seed of seeds) {
    const rows = runHeadToHead({ population, stages, seedInput: seed, fieldSize, orderMode: "none" });
    scorecards.push(buildScorecard(rows, { teamByRider, abilitiesByRider, v4EntrantsById }));
    for (const row of rows) accumulateStageRates(rateAcc, row.profileType, row.raw?.v4Output);
  }
  const aggregated = aggregateScorecards(scorecards);
  return {
    anchors: summarizeAnchorGate(aggregated, countSeedVerdicts(scorecards), seeds.length),
    rates: summarizeRates(rateAcc),
  };
}

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function listArg(name, fallback) {
  const raw = argValue(name);
  if (!raw) return [...fallback];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function abs(p) {
  return isAbsolute(p) ? p : join(REPO_ROOT, p);
}

function engineSha() {
  try {
    return execFileSync("git", ["-C", REPO_ROOT, "log", "-1", "--format=%h", "--", "backend/lib/engine/v4"], { encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function hostLabel() {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || "ukendt maskine";
}

async function main() {
  const seeds = listArg("seeds", HEAD_TO_HEAD_SEEDS);
  const tailSeeds = listArg("tail-seeds", TAIL_GATE_SEEDS);
  const perfSizes = listArg("perf-sizes", PERF_FIELD_SIZES.map(String)).map(Number);
  const reportPath = argValue("write-report");
  const privatePath = argValue("private-out", "balance-internals/5515-v4-flip-klar/v4-flip-klar-tal.md");
  const jsonPath = argValue("json");
  const skipTests = process.argv.includes("--skip-tests");

  const population = JSON.parse(readFileSync(abs(POPULATION_FILE), "utf8"));
  const stagesFile = JSON.parse(readFileSync(abs(STAGES_FILE), "utf8"));
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;

  const t0 = performance.now();
  console.log(`[5515] head-to-head ${seeds.join(",")} x ${stages.length} etaper, felt ${FIELD_SIZE} ...`);
  const { anchors, rates } = measureHeadToHead({ population, stages, seeds });
  console.log(`[5515] hale-gate ${tailSeeds.join(",")} ...`);
  const tailGate = evaluateTailGate(runTailSpread({ population, stages, seeds: tailSeeds, fieldSize: FIELD_SIZE }));
  console.log(`[5515] ydelse ${perfSizes.join(",")} ...`);
  const perf = runPerf({ population, stages, fieldSizes: perfSizes });
  let infraTests = null;
  if (!skipTests) {
    console.log(`[5515] flip-infra/kill-switch-tests (${FLIP_INFRA_TEST_FILES.length} filer) ...`);
    infraTests = runFlipInfraTests();
  }
  console.log(`[5515] faerdig paa ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  const result = {
    meta: {
      generated_at: new Date().toISOString(),
      engine_sha: engineSha(),
      population_file: POPULATION_FILE,
      population_riders: population.riders.length,
      stages_file: STAGES_FILE,
      stage_count: stages.length,
      seeds,
      tail_seeds: tailSeeds,
      field_size: FIELD_SIZE,
      host: hostLabel(),
      node: process.version,
    },
    anchors,
    tailGate,
    rates,
    perf: perf.map((p) => ({ fieldSize: p.fieldSize, summary: p.summary })),
    infraTests,
  };

  const privateAbs = abs(privatePath);
  mkdirSync(dirname(privateAbs), { recursive: true });
  writeFileSync(privateAbs, renderPrivateReport(result));
  console.log(`[5515] privat tal-fil: ${privateAbs}`);

  if (jsonPath) {
    const jsonAbs = abs(jsonPath);
    mkdirSync(dirname(jsonAbs), { recursive: true });
    writeFileSync(jsonAbs, JSON.stringify(result, null, 2));
    console.log(`[5515] raa JSON: ${jsonAbs}`);
  }

  const block = renderPublicBlock(result);
  if (reportPath) {
    const reportAbs = abs(reportPath);
    const replaced = replaceBlock(readFileSync(reportAbs, "utf8"), block);
    if (replaced === null) throw new Error(`fandt ikke ${START_MARKER}/${END_MARKER} i ${reportPath}`);
    writeFileSync(reportAbs, replaced);
    console.log(`[5515] offentlig blok skrevet i ${reportPath}`);
  } else {
    console.log("");
    console.log(block);
  }
}

if (process.argv[1]?.endsWith("v4FlipReadiness.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
