#!/usr/bin/env node
// Mutation-audit for launch-gates (#1198, jf. #1144): beviser at hver gate
// faktisk KAN fange en ødelagt spiltilstand — et orakel der aldrig fejler er
// kun et dashboard.
//
// Princip: hver mutant konstruerer en spiltilstand ejeren ville afvise
// (inverteret motor, kollapset pyramide, U-formet værdikurve, ...), kører den
// RIGTIGE gate mod den, og registrerer fanget (exit ≠ 0 / guard kaster) vs
// sluppet-igennem. Kill-raten committes i docs/GATE_MUTATION_AUDIT.md.
//
// Sikkerhed: ALT er in-memory/worktree — fil-mutationer patches midlertidigt og
// restaureres i finally (verificér evt. med `git status` bagefter). INGEN DB,
// INGEN env-krav, INGEN prod. Kun gates der er 100% DB-frie mutation-testes her;
// DB-bundne gates er dokumenteret som ikke-dækkede i rapporten.
//
//   node scripts/gateMutationAudit.js [--gate=race|population|fit|cutover|relaunch] [--json]
//
// Mutant-katalog/recon: issue #1198. Rapport: docs/GATE_MUTATION_AUDIT.md.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fitValuationModel, checkAnchorOrdering, evaluateFitGuards } from "../lib/riderValuationFit.js";
import { auditValuationRows } from "../lib/valuationCutoverAudit.js";
import { generateLaunchPopulation, LAUNCH_VALUE_BANDS } from "../lib/fictionalLaunchPopulation.js";
import { foldNameNordic } from "../lib/pcmRiderMatcher.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";

// relaunchOrchestrator's import-kæde rammer discordNotifier, som laver en
// Supabase-klient ved module-load. Harnesset skal kunne køre HELT uden env
// (ingen DB røres nogensinde) — så vi sætter CI's dummy-værdier (jf.
// .github/workflows/ci.yml) før en dynamisk import. Ingen netværkskald sker.
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "mutation-audit-dummy";
const { isProdSupabaseUrl, assertRelaunchProdGuard } = await import("../lib/relaunchOrchestrator.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, "..");

const ONLY_GATE = (process.argv.find((a) => a.startsWith("--gate=")) || "").split("=")[1] || null;
const AS_JSON = process.argv.includes("--json");

const committedModel = JSON.parse(readFileSync(join(BACKEND, "lib/riderValuationModel.json"), "utf8"));
const typesBaseline = JSON.parse(readFileSync(join(BACKEND, "lib/riderTypesBaseline.json"), "utf8"));

// ── Patch-maskineri (midlertidige fil-mutationer, altid restaureret) ──────────
function applyPatches(patches) {
  const originals = new Map();
  try {
    for (const { file, find, replace } of patches) {
      const abs = join(BACKEND, file);
      const raw = originals.has(abs) ? readFileSync(abs, "utf8") : readFileSync(abs, "utf8");
      if (!originals.has(abs)) originals.set(abs, raw);
      const current = readFileSync(abs, "utf8");
      const eol = current.includes("\r\n") ? "\r\n" : "\n";
      const f = find.split("\n").join(eol);
      const r = replace.split("\n").join(eol);
      const count = current.split(f).length - 1;
      if (count !== 1) throw new Error(`patch-anker fundet ${count}× (kræver 1) i ${file}: ${JSON.stringify(find.slice(0, 70))}`);
      writeFileSync(abs, current.replace(f, r));
    }
  } catch (e) {
    for (const [abs, raw] of originals) writeFileSync(abs, raw);
    throw e;
  }
  return () => {
    for (const [abs, raw] of originals) writeFileSync(abs, raw);
  };
}

function runGateScript(script, args = []) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function failureEvidence({ stdout, stderr, status }) {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  const hits = lines.filter((l) => l.includes("❌") || /^\s+- /.test(l)).slice(0, 4);
  return `exit ${status}${hits.length ? " · " + hits.map((l) => l.trim()).join(" · ") : ""}`;
}

function parsePyramidBands(stdout) {
  // Kun FØRSTE match pr. bånd-nøgle: bånd-tabellen kommer før tier×bånd-
  // krydstabellen, hvis "solid"-tier-række ellers ville overskrive tallet.
  const counts = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s{2}(superstjerne|stjerne|solid|domestik)\s+(\d+)/.exec(line);
    if (m && counts[m[1]] === undefined) counts[m[1]] = Number(m[2]);
  }
  return counts;
}

// ── In-process hjælpere ───────────────────────────────────────────────────────
// Replay af fit-gatens guard-sekvens (fitRiderValuationModel.js) på et anchor-sæt
// — DB-resolution kan ikke køres her, så mutanterne opererer på committed
// anchors_fit (samme shape som gatens resolved anchors).
function runFitGateReplay(anchors) {
  const failures = [];
  if (anchors.length < 5) {
    failures.push(`for få anchors (${anchors.length}) — gaten afbryder`);
    return { failures };
  }
  const fit = fitValuationModel(anchors, { quadratic: true });
  failures.push(...evaluateFitGuards(anchors, fit));
  const predict = (an) => Math.exp(fit.predictLn(an));
  const { hard } = checkAnchorOrdering(anchors, predict);
  if (hard.length) failures.push(`${hard.length} hårde ordensbrud`);
  return { failures, fit };
}

// Kør hele værdi-kæden på en genereret population → pyramide-bånd-counts.
function chainBandCounts(existingFoldedNames = new Set()) {
  const { riders } = generateLaunchPopulation(existingFoldedNames);
  const counts = Object.fromEntries(LAUNCH_VALUE_BANDS.map((b) => [b.key, 0]));
  riders.forEach((r, i) => {
    const riderRow = { ...r, id: `mut-${i}` };
    const abilities = deriveAbilities({}, riderRow, { asOfYear: 2026 });
    const { primary } = computeRiderTypes(abilities, typesBaseline);
    const bv = predictBaseValue({ ...riderRow, primary_type: primary.key }, abilities, committedModel);
    const band = LAUNCH_VALUE_BANDS.find((b) => bv >= b.lo && bv < b.hi)?.key ?? "domestik";
    counts[band]++;
  });
  return counts;
}

const cutoverRow = (over = {}) => {
  const base_value = over.base_value !== undefined ? over.base_value : 45_000;
  const prize_earnings_bonus = over.prize_earnings_bonus ?? 0;
  const effBase = Number(base_value) > 0 ? Number(base_value) : 1000;
  const market_value = over.market_value !== undefined ? over.market_value : effBase + prize_earnings_bonus;
  return {
    id: "x", firstname: "Fixture", lastname: "Rytter",
    base_value, prize_earnings_bonus, market_value,
    salary: over.salary !== undefined ? over.salary : Math.max(1, Math.round(market_value * 0.10)),
    is_retired: false, pcm_id: null, ...over,
  };
};

// ── Mutant-registret ──────────────────────────────────────────────────────────
const RACE_ARGS = ["--seed=2026", "--no-html"];
const RACE_M2_ARGS = ["--seed=2026", "--count=140", "--field=140", "--races=300", "--no-html"];

const GATES = [
  {
    key: "race",
    name: "Race-engine dry-run (#1102) — scripts/simulateSeasonDryRun.js",
    script: "scripts/simulateSeasonDryRun.js",
    baselines: [RACE_ARGS, RACE_M2_ARGS],
    mutants: [
      {
        id: "race-M1-total-inversion",
        title: "Motoren inverteret: dårligste rytter i nøgle-evnen vinder (terrainScore → -s)",
        patches: [{ file: "lib/raceSimulator.js", find: "  return s;", replace: "  return -s;" }],
        args: RACE_ARGS,
      },
      {
        id: "race-M2-monopol-sprinter",
        title: "Én gudelig sprinter vinder samtlige flade løb (distinkt=1/300)",
        patches: [{
          file: "scripts/simulateSeasonDryRun.js",
          find: "const byId = new Map(field.map((r) => [r.id, r]));",
          replace: "const god = field.find((r) => r.bornAs === \"sprinter\");\nif (god) Object.assign(god.abilities, { sprint: 99, acceleration: 99, positioning: 99, endurance: 99, recovery: 99, tactics: 99 });\nconst byId = new Map(field.map((r) => [r.id, r]));",
        }],
        args: RACE_M2_ARGS,
      },
      {
        id: "race-M3-baroudeur-bjerge",
        title: "Baroudeurer fejer bjergene (intra-gruppe-skævhed skjult af gruppe-bånd)",
        patches: [{
          file: "lib/fictionalRiderGenerator.js",
          find: "boost: { stat_ftr: 11, stat_fl: 5, stat_bk: 5,  stat_udh: 6, stat_ned: 5, stat_res: 5 }",
          replace: "boost: { stat_ftr: 11, stat_fl: 5, stat_bk: 5, stat_bj: 25, stat_udh: 15, stat_ned: 5, stat_res: 5 }",
        }],
        args: RACE_ARGS,
      },
      {
        id: "race-M4-rolling-classic-spurter",
        title: "Rolling/classic = rene massespurter (terræner uden bånd)",
        patches: [
          {
            file: "lib/raceStageProfileGenerator.js",
            find: "  rolling:       Object.freeze({ endurance: 0.18, flat: 0.12, punch: 0.12, tempo: 0.08, positioning: 0.08, sprint: 0.08, tactics: 0.06, climbing: 0.04, recovery: 0.04, randomness: 0.20 }),",
            replace: "  rolling:       Object.freeze({ sprint: 0.60, acceleration: 0.20, positioning: 0.12, randomness: 0.08 }),",
          },
          {
            file: "lib/raceStageProfileGenerator.js",
            find: "  classic:       Object.freeze({ endurance: 0.18, punch: 0.16, climbing: 0.12, cobblestone: 0.10, tempo: 0.06, flat: 0.06, positioning: 0.06, tactics: 0.04, sprint: 0.04, randomness: 0.18 }),",
            replace: "  classic:       Object.freeze({ sprint: 0.60, acceleration: 0.20, positioning: 0.12, randomness: 0.08 }),",
          },
        ],
        args: RACE_ARGS,
      },
      {
        id: "race-M5-vaerdiinversion",
        title: "Værdimodellen inverteret: domestique > GC-stjerne (b-fortegn flippet)",
        patches: [
          { file: "lib/riderValuationModel.json", find: "  \"b\": 0.048374,", replace: "  \"b\": -0.048374," },
          { file: "lib/riderValuationModel.json", find: "  \"c\": 0.0009064216,", replace: "  \"c\": 0," },
        ],
        args: RACE_ARGS,
      },
      {
        id: "race-M6-gc-inverteret",
        title: "GC omvendt: lanterne rouge vinder (kumulativ tid desc)",
        patches: [{ file: "lib/raceRunner.js", find: "      a.time - b.time ||", replace: "      b.time - a.time ||" }],
        args: RACE_ARGS,
      },
    ],
  },
  {
    key: "population",
    name: "Fiktiv launch-population preview (#669/#677) — scripts/previewFictionalPopulation.js",
    script: "scripts/previewFictionalPopulation.js",
    baselines: [[]],
    mutants: [
      {
        id: "pop-MUT-1-pyramide-kollaps",
        title: "Superstjerne-tier kollapser (statMean 70.75→66) — bånd langt fra targets",
        patches: [{ file: "lib/fictionalRiderGenerator.js", find: "statMean: 70.75", replace: "statMean: 66" }],
        args: [],
        detect: (res) => {
          const bands = parsePyramidBands(res.stdout);
          return {
            caught: res.status !== 0,
            evidence: `exit ${res.status} · bånd ${bands.superstjerne}/${bands.stjerne}/${bands.solid}/${bands.domestik} vs targets 12/60/230/500 — bånd-tolerance er ejer-beslutning, rapport-only`,
          };
        },
      },
      {
        id: "pop-MUT-2-navnekollision-rng-shift",
        title: "DB-navnekollision forskyder RNG-strømmen — certificeret ≠ shipped population",
        inProcess: () => {
          const clean = chainBandCounts();
          const { riders } = generateLaunchPopulation();
          const collide = new Set([foldNameNordic(`${riders[0].firstname} ${riders[0].lastname}`)]);
          const shifted = chainBandCounts(collide);
          const same = JSON.stringify(clean) === JSON.stringify(shifted);
          return {
            caught: false,
            evidence: `certificeret ${clean.superstjerne}/${clean.stjerne}/${clean.solid}/${clean.domestik} vs 1 kollision ${shifted.superstjerne}/${shifted.stjerne}/${shifted.solid}/${shifted.domestik}${same ? " (identisk denne gang — flere kollisioner forskyder mere)" : ""} — gaten har intet --existing-names-input og kan pr. konstruktion ikke se det`,
          };
        },
      },
      {
        id: "pop-MUT-4-taerskel-drift-8m",
        title: "STAR_RIDER_MARKET_VALUE ændres uden at bånd-definitionen følger med",
        patches: [{ file: "lib/economyConstants.js", find: "export const STAR_RIDER_MARKET_VALUE = 8_000_000;", replace: "export const STAR_RIDER_MARKET_VALUE = 10_000_000;" }],
        args: [],
        detect: (res) => {
          const moved = res.stdout.includes("10.000.000");
          const stale = /superstjerne.*8\.000\.000/.test(res.stdout);
          return {
            caught: moved && !stale,
            evidence: moved
              ? "bånd-grænsen fulgte konstanten til ≥10.000.000 — drift er strukturelt umulig (delt konstant via LAUNCH_VALUE_BANDS)"
              : "bånd-grænsen står stadig på 8.000.000 mens spillet kører 10M — drift muligt",
          };
        },
      },
      {
        id: "pop-MUT-5-type-offset-tabt",
        title: "Model-refit taber sprinter-offsettet (alle sprintere ÷2,9 i værdi) — bånd ser BEDRE ud",
        patches: [{ file: "lib/riderValuationModel.json", find: "    \"sprinter\": 1.059889,\n", replace: "" }],
        args: [],
        detect: (res) => {
          const bands = parsePyramidBands(res.stdout);
          return {
            caught: res.status !== 0,
            evidence: `exit ${res.status} · bånd ${bands.superstjerne}/${bands.stjerne}/${bands.solid}/${bands.domestik} (certificeret 12/68/203/517) — per-type værdi-niveau er ikke båndlagt (#1196)`,
          };
        },
      },
      {
        id: "pop-MUT-6-gc-kollaps",
        title: "GC-typen kvalt i generatoren (gulv + tier-vægte fjernet) — TdF uden GC-ryttere",
        patches: [
          { file: "lib/fictionalRiderGenerator.js", find: "const ENSURE_MIN_TYPES = { gc: 30, sprinter: 40 };", replace: "const ENSURE_MIN_TYPES = { sprinter: 40 };" },
          { file: "lib/fictionalRiderGenerator.js", find: "  superstar:  { gc: 3, climber: 3,", replace: "  superstar:  { climber: 3," },
          { file: "lib/fictionalRiderGenerator.js", find: "  star:       { gc: 3, climber: 4,", replace: "  star:       { climber: 4," },
          { file: "lib/fictionalRiderGenerator.js", find: "  solid:      { gc: 2, climber: 4,", replace: "  solid:      { climber: 4," },
        ],
        args: [],
      },
    ],
  },
  {
    key: "fit",
    name: "Værdimodel-fit med ordens-guard (#1101 v3) — scripts/fitRiderValuationModel.js (unit-replay af guard-kæden)",
    mutants: [
      {
        id: "fit-VM-M1-tomt-hardband",
        title: "Alle ≥15M-anchors droppet ved resolution — ordens-guarden de facto slukket",
        inProcess: () => {
          const anchors = committedModel.anchors_fit.filter((an) => an.target < 15e6);
          const { failures } = runFitGateReplay(anchors);
          return { caught: failures.length > 0, evidence: failures.join(" · ") || "ingen guard fyrede" };
        },
      },
      {
        id: "fit-VM-M2-ukurve",
        title: "Ekstra-nuller-typo i 2 bund-anchors → U-formet ln-kurve (vrag-ryttere dyrest)",
        inProcess: () => {
          const anchors = committedModel.anchors_fit.map((an) => ({
            ...an,
            target: an.name === "Ian Kimpe" ? 6_000_000 : an.name === "D'Arcy Sanders" ? 3_000_000 : an.target,
          }));
          const { failures, fit } = runFitGateReplay(anchors);
          return {
            caught: failures.length > 0,
            evidence: `b=${fit?.b?.toFixed(3)}, c=${fit?.c?.toExponential(2)} · ${failures.join(" · ") || "ingen guard fyrede"}`,
          };
        },
      },
      {
        id: "fit-VM-M5-anchorlos-baroudeur",
        title: "Type uden anchor (baroudeur) får offset 0 → out-pricer Pogacar — LIVE i committed model",
        inProcess: () => {
          const { a, b, c, output_max, offset } = committedModel;
          const baroudeurAt = (o) => Math.exp(a + b * o + Number(c) * o * o + (offset.baroudeur ?? 0));
          const pogacar = committedModel.anchors_fit.find((an) => an.name === "Tadej Pogacar");
          return {
            caught: false,
            evidence: `baroudeur@output ${output_max} ≈ ${(baroudeurAt(output_max) / 1e6).toFixed(0)}M vs Pogacar predicted ${(pogacar.predicted / 1e6).toFixed(0)}M — gaten evaluerer kun anchor-punkter; fix = ejer tilføjer baroudeur-anchor (warning tilføjet i gaten)`,
          };
        },
      },
      {
        id: "fit-baseline-groen",
        title: "(kontrol) committed anchors består alle guards",
        control: true,
        inProcess: () => {
          const { failures } = runFitGateReplay(committedModel.anchors_fit);
          return { caught: failures.length === 0, evidence: failures.length ? `UVENTET: ${failures.join(" · ")}` : "alle guards grønne på committed anchors" };
        },
      },
    ],
  },
  {
    key: "cutover",
    name: "Værdimodel cutover-audit (#1101 slice 2) — lib/valuationCutoverAudit.js (kernen bag scripts/auditValuationCutover.js)",
    mutants: [
      {
        id: "cut-M1-runtime-divergens",
        title: "Runtime-fallback-formlen divergerer fra DB'ens GENERATED-formel (base×3)",
        inProcess: () => {
          const divergent = (r) => (Number(r.base_value) > 0 ? Number(r.base_value) : 1000) * 3 + (Number(r.prize_earnings_bonus) || 0);
          const { failures } = auditValuationRows([cutoverRow()], { marketValueFn: divergent });
          return { caught: failures.length > 0, evidence: failures.join(" · ") || "tautologi — checket kunne ikke fyre" };
        },
      },
      {
        id: "cut-M2-flad-fordeling",
        title: "Backfill skriver konstant 1000 til alle — Pogacar-klassen = neo-pro",
        inProcess: () => {
          const rows = ["a", "b", "c", "d"].map((id) => cutoverRow({ id, base_value: 1000, market_value: 1000, salary: 100 }));
          const { failures } = auditValuationRows(rows);
          return { caught: failures.length > 0, evidence: failures.join(" · ") || "formel-konsistens grøn trods flad skala — fordelings-bånd hører til ejer-scorecardet #1196" };
        },
      },
      {
        id: "cut-M3-negativ-market-value",
        title: "Negativ prize_earnings_bonus giver market_value -50.000 (ingen DB-CHECK)",
        inProcess: () => {
          const r = cutoverRow({ base_value: 1000, prize_earnings_bonus: -51_000, market_value: -50_000, salary: 1 });
          const { failures } = auditValuationRows([r, cutoverRow({ id: "ok" })]);
          return { caught: failures.length > 0, evidence: failures.join(" · ") || "negativ pris passerede" };
        },
      },
      {
        id: "cut-M4-tom-population",
        title: "Halvfejlet swap: 0 aktive ryttere — vacuous truth",
        inProcess: () => {
          const empty = auditValuationRows([]);
          const allRetired = auditValuationRows([cutoverRow({ is_retired: true })]);
          return {
            caught: empty.failures.length > 0 && allRetired.failures.length > 0,
            evidence: `tom: ${empty.failures[0] ?? "grøn!"} · hel-retired: ${allRetired.failures[0] ?? "grøn!"}`,
          };
        },
      },
      {
        id: "cut-M5-pcm-overlever-relaunch",
        title: "3 rigtige PCM-ryttere aktive efter relaunch (--expect-fictional)",
        inProcess: () => {
          const rows = [cutoverRow(), ...[101, 102, 103].map((p) => cutoverRow({ id: `p${p}`, pcm_id: p }))];
          const withFlag = auditValuationRows(rows, { expectFictional: true });
          const withoutFlag = auditValuationRows(rows);
          return {
            caught: withFlag.failures.length > 0,
            evidence: `--expect-fictional: ${withFlag.failures[0] ?? "grøn!"} · uden flag: ${withoutFlag.failures.length === 0 ? "grøn (pre-relaunch-tilstand er legitim)" : withoutFlag.failures[0]}`,
          };
        },
      },
    ],
  },
  {
    key: "relaunch",
    name: "Relaunch-orchestrator prod-guard (#1103) — lib/relaunchOrchestrator.js (DB-frie guard-mutanter)",
    mutants: [
      {
        id: "rel-M2-prod-guard-casing",
        title: "Uppercased SUPABASE_URL omgår prod-detektionen (DNS er case-insensitive)",
        inProcess: () => {
          const url = "https://GHWVKXZHSBBLTZFNUHHZ.supabase.co";
          const detected = isProdSupabaseUrl(url);
          let guardBlocked = false;
          if (detected) {
            try {
              assertRelaunchProdGuard({ apply: true, isProd: detected, targetProd: false });
            } catch {
              guardBlocked = true;
            }
          }
          return {
            caught: detected && guardBlocked,
            evidence: detected
              ? "uppercased prod-URL detekteres som prod → --apply uden --target-prod kaster"
              : "uppercased prod-URL detekteres som non-prod → fuld destruktiv apply ville køre uden guard",
          };
        },
      },
    ],
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────
function runAll() {
  const results = [];
  for (const gate of GATES) {
    if (ONLY_GATE && gate.key !== ONLY_GATE) continue;
    console.error(`\n━━ ${gate.name}`);

    // Baseline-kontrakt: den u-muterede gate SKAL være grøn (exit 0) for hver
    // args-kombination — ellers er "fanget" meningsløst (permanent rød gate).
    if (gate.script) {
      for (const args of gate.baselines || [[]]) {
        const base = runGateScript(gate.script, args);
        if (base.status !== 0) {
          throw new Error(`BASELINE RØD for ${gate.script} ${args.join(" ")} (exit ${base.status}) — fix gaten før mutation-audit.\n${base.stdout.slice(-2000)}\n${base.stderr.slice(-2000)}`);
        }
        console.error(`   baseline ✅ exit 0  (${gate.script} ${args.join(" ") || "(default)"})`);
      }
    }

    for (const m of gate.mutants) {
      let outcome;
      if (m.inProcess) {
        outcome = m.inProcess();
      } else {
        const restore = applyPatches(m.patches);
        try {
          const res = runGateScript(gate.script, m.args || []);
          outcome = m.detect ? m.detect(res) : { caught: res.status !== 0, evidence: failureEvidence(res) };
        } finally {
          restore();
        }
      }
      results.push({ gate: gate.key, gateName: gate.name, id: m.id, title: m.title, control: !!m.control, ...outcome });
      console.error(`   ${outcome.caught ? "🟢 FANGET " : "🔴 SLIPPER "} ${m.id}`);
    }
  }
  return results;
}

function toMarkdown(results) {
  const lines = [];
  lines.push("## Kill-rate pr. gate (genereret af scripts/gateMutationAudit.js)\n");
  lines.push("| Gate | Kill-rate | Mutanter |");
  lines.push("|---|---|---|");
  const byGate = new Map();
  for (const r of results) {
    if (!byGate.has(r.gate)) byGate.set(r.gate, []);
    byGate.get(r.gate).push(r);
  }
  for (const [, rs] of byGate) {
    const real = rs.filter((r) => !r.control);
    const caught = real.filter((r) => r.caught).length;
    lines.push(`| ${rs[0].gateName.split(" — ")[0]} | **${caught}/${real.length}** | ${real.map((r) => `${r.caught ? "🟢" : "🔴"} ${r.id}`).join("<br>")} |`);
  }
  lines.push("\n### Detaljer pr. mutant\n");
  for (const r of results) {
    lines.push(`- ${r.control ? "⚪" : r.caught ? "🟢 FANGET" : "🔴 SLIPPER IGENNEM"} **${r.id}**${r.control ? " (kontrol)" : ""} — ${r.title}`);
    lines.push(`  - ${r.evidence}`);
  }
  return lines.join("\n");
}

const results = runAll();
if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`\n${toMarkdown(results)}`);
}
const real = results.filter((r) => !r.control);
const caught = real.filter((r) => r.caught).length;
const controlsBroken = results.filter((r) => r.control && !r.caught).length;
console.error(`\nSamlet kill-rate: ${caught}/${real.length} mutanter fanget${controlsBroken ? ` · ⚠ ${controlsBroken} kontrol-tjek fejlede` : ""}.`);
// Harnesset selv fejler kun hvis et kontrol-tjek (baseline-grøn) er brudt —
// sluppede mutanter er FUND (dokumenteres), ikke harness-fejl.
if (controlsBroken) process.exitCode = 1;
