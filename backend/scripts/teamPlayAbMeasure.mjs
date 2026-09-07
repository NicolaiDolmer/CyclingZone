#!/usr/bin/env node
// backend/scripts/teamPlayAbMeasure.mjs
// #4914 (kalibreringspakke punkt 3): A/B-MAALING af holdspils-niveauet (M16).
//
// HVAD DEN GOER — og hvad den IKKE goer: den MAALER. Den vaelger ikke, og den
// aendrer ikke en eneste tuning-konstant. Holdspils-niveauet er ejer-gated
// (docs/RACE_ENGINE_RULES.md §2e's advarselsblok: "at loefte den til fuld
// v3-paritet er en kalibrering med ejer-go ... ikke en wiring-aendring"), saa
// dette script producerer praecis det ejeren skal vaelge ud fra: to
// maalinger af den SAMME motor med to forskellige niveauer, paa den PINNEDE
// population + de PINNEDE proxy-etaper, over 5 seeds.
//
// TO TRIN, fordi niveauet ligger i motorens egen tuning (deep-frosset ved
// import og derfor ikke overstyrbar udefra):
//
//   1. MAAL (én gang pr. variant, med den tuning der ligger paa disken):
//        node backend/scripts/teamPlayAbMeasure.mjs --label=A --out=<fil>.json
//      Scriptet skriver de maalte TEAM_PLAY_EXTRA_TUNING-vaerdier med i
//      JSON'en, saa en maaling altid baerer sit eget niveau — man kan ikke
//      komme til at sammenligne to filer og gaette hvad B var.
//
//   2. RENDER (naar begge JSON'er findes):
//        node backend/scripts/teamPlayAbMeasure.mjs --render --a=<A>.json --b=<B>.json --out=<rapport>.md
//
// 100% READ-ONLY mod DB og git. Skriver kun til --out. Starter kun de to
// eksisterende harness-scripts som subprocesser og laeser deres output.
//
// ── HVORFOR --orders=ai ──────────────────────────────────────────────────────
// Holdspillet kraever roller OG hold-id (mechanics/teamPlay.ts's hoved). Med
// harnessens default `--orders=none` faar alle `free_role`, og M16 er en
// eksakt no-op — maalingen ville vaere tom. Ankertabellen i §7b er derimod
// koert med `orders=none`, saa ANKER-TALLENE HERUNDER ER IKKE DIREKTE
// SAMMENLIGNELIGE MED §7b. Det er A mod B under identiske betingelser der er
// pointen, ikke A mod ankertabellen.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TEAM_PLAY_EXTRA_TUNING } from "../lib/engine/v4/tuning.ts";
import { displayFor } from "./renderV4AnchorTable.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

// Samme to PINNEDE filer som ankertabellen (#4911/§7b). 5 seeds, ikke 3:
// ejer-anbefalingen for kalibreringspakken (issue #4914's 7/9-kommentar).
const POPULATION_FILE = "backend/scripts/baselines/population-snapshot-2026-09-07.json";
const STAGES_FILE = "backend/scripts/baselines/v4-proxy-stages-2026-09-06.json";
const SEEDS = ["s1", "s2", "s3", "s4", "s5"];
// Hale-gaten er ejer-laast paa 3 seeds (§9 raekke 13, #4885) — den koeres
// praecis som gaten er defineret, ikke paa 5.
const TAIL_GATE_SEEDS = ["s1", "s2", "s3"];
const FIELD_SIZE = "180";

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function runHarness(args) {
  return execFileSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ---------------------------------------------------------------------------
// Parsere. Harnessens tekst-output er kontrakten her; hver parser fejler HAARDT
// hvis formen skifter, i stedet for at returnere tomme tal der ville se ud som
// "holdspillet virker ikke".
// ---------------------------------------------------------------------------

const NUM = (s) => (s === "n/a" ? null : Number(s));

/** Parser formatTeamPlay()-blokken fra lib/headToHeadTeamPlay.js. */
export function parseTeamPlay(stdout) {
  const gapLine = stdout.split("\n").find((l) => l.startsWith("Beskyttelses-gab"));
  if (!gapLine) throw new Error("fandt ikke 'Beskyttelses-gab'-linjen i harness-output (--orders=ai glemt?)");
  const m = gapLine.match(/v3\s+(-?[\d.]+|n\/a)\s+·\s+v4\s+(-?[\d.]+|n\/a)/u);
  if (!m) throw new Error(`kunne ikke laese beskyttelses-gab af: ${gapLine}`);

  const roles = {};
  for (const line of stdout.split("\n")) {
    const r = line.match(/^(captain|sprint_captain|helper|hunter|free_role)\s+(-?[\d.]+|n\/a)\s+(-?[\d.]+|n\/a)\s+(-?[\d.]+|n\/a)\s+(-?[\d.]+|n\/a)\s*$/u);
    if (r) roles[r[1]] = { v3MeanRank: NUM(r[2]), v3Delta: NUM(r[3]), v4MeanRank: NUM(r[4]), v4Delta: NUM(r[5]) };
  }
  if (Object.keys(roles).length === 0) throw new Error("fandt ingen rolle-raekker i holdspils-blokken");
  return { v3Gap: NUM(m[1]), v4Gap: NUM(m[2]), roles };
}

/** Parser formatTailGateTable()-blokken fra v4TailSpread.js. */
export function parseTailGate(stdout) {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => l.startsWith("-- HALE-GATE"));
  if (start < 0) throw new Error("fandt ikke HALE-GATE-tabellen i v4TailSpread-output");
  const rows = [];
  let allPass = null;
  for (const line of lines.slice(start + 2)) {
    if (line.startsWith("Samlet gate-dom:")) {
      allPass = line.includes("PASS");
      break;
    }
    const cols = line.split("\t");
    if (cols.length < 5) continue;
    rows.push({
      profileType: cols[0],
      n: Number(cols[1]),
      cleanP90Pct: NUM(cols[2]),
      band: cols[3],
      status: cols[4],
      meanPerSeedPct: NUM(cols[5] ?? "n/a"),
      spreadPerSeedPct: cols[6] ?? null,
    });
  }
  if (allPass === null) throw new Error("fandt ikke 'Samlet gate-dom'-linjen");
  return { rows, allPass };
}

// ---------------------------------------------------------------------------
// Maaling
// ---------------------------------------------------------------------------

function measure(label, note) {
  const tmpDir = mkdtempSync(join(tmpdir(), "teamplay-ab-"));
  try {
    // 1. Pr. seed: giver SPAENDET paa beskyttelses-gabet. Harnessen midler
    //    selv over alle seeds i én koersel, saa uden per-seed-koerslerne ville
    //    vi kun have ét tal uden spaend — og §7-raekke 8's gate-form er
    //    "seed-middel MED spaend".
    const perSeed = SEEDS.map((seed) => {
      const stdout = runHarness([
        join(SCRIPT_DIR, "headToHeadV4.js"),
        `--population=${POPULATION_FILE}`,
        `--stages=${STAGES_FILE}`,
        `--seeds=${seed}`,
        `--field-size=${FIELD_SIZE}`,
        "--orders=ai",
      ]);
      return { seed, ...parseTeamPlay(stdout) };
    });

    // 2. Samlet koersel: ankrene MIDLET over alle 5 seeds med spaend, plus det
    //    poolede holdspils-tal.
    const jsonPath = join(tmpDir, "anchors.json");
    const combinedStdout = runHarness([
      join(SCRIPT_DIR, "headToHeadV4.js"),
      `--population=${POPULATION_FILE}`,
      `--stages=${STAGES_FILE}`,
      `--seeds=${SEEDS.join(",")}`,
      `--field-size=${FIELD_SIZE}`,
      "--orders=ai",
      `--json=${jsonPath}`,
    ]);
    const anchorJson = JSON.parse(readFileSync(jsonPath, "utf8"));

    // 3. Hale-gaten (§9 raekke 13). Egen harness, egen population-default —
    //    koeres eksplicit mod DE SAMME pinnede filer.
    let tailGate;
    let tailGateExitCode = 0;
    try {
      const stdout = runHarness([
        join(SCRIPT_DIR, "v4TailSpread.js"),
        `--population=${POPULATION_FILE}`,
        `--stages=${STAGES_FILE}`,
        `--seeds=${TAIL_GATE_SEEDS.join(",")}`,
        `--field-size=${FIELD_SIZE}`,
        "--gate",
      ]);
      tailGate = parseTailGate(stdout);
    } catch (err) {
      // --gate exit'er 1 ved FAIL; det er en DOM, ikke en fejl i scriptet.
      if (typeof err?.stdout === "string" && err.stdout.includes("-- HALE-GATE")) {
        tailGate = parseTailGate(err.stdout);
        tailGateExitCode = err.status ?? 1;
      } else {
        throw err;
      }
    }

    return {
      schema_version: 1,
      label,
      note: note ?? null,
      generated_at: new Date().toISOString(),
      population_file: POPULATION_FILE,
      stages_file: STAGES_FILE,
      seeds: SEEDS,
      tail_gate_seeds: TAIL_GATE_SEEDS,
      field_size: Number(FIELD_SIZE),
      order_mode: "ai",
      // Niveauet maalingen faktisk blev koert med. Uden dette felt kan to
      // maale-filer ikke skelnes bagefter.
      team_play_tuning: JSON.parse(JSON.stringify(TEAM_PLAY_EXTRA_TUNING)),
      team_play: {
        per_seed: perSeed,
        pooled: parseTeamPlay(combinedStdout),
      },
      anchors: anchorJson.anchors,
      tail_gate: { ...tailGate, exit_code: tailGateExitCode },
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

// Enhederne er IKKE frie: procent-ankrene er lagret som broeker, og en egen
// kopi der glemte x100 ville rapportere "0,3 %" hvor §7b's tabel siger
// "30,3 %". Derfor genbruges ankertabellens egen formatter.
function fmtAnchor(cell, id) {
  if (!cell || cell.verdict === "N/A" || !Number.isFinite(cell.value)) return "n/a";
  const spread = cell.spread ? ` (${displayFor(id, cell.spread.min)}-${displayFor(id, cell.spread.max)})` : "";
  return `${displayFor(id, cell.value)}${spread} ${cell.verdict}`;
}

function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function gapSummary(measurement, engine) {
  const key = engine === "v3" ? "v3Gap" : "v4Gap";
  const values = measurement.team_play.per_seed.map((s) => s[key]).filter((v) => Number.isFinite(v));
  if (values.length === 0) return "n/a";
  return `${mean(values).toFixed(2)} (${Math.min(...values).toFixed(2)}-${Math.max(...values).toFixed(2)})`;
}

// Samme markoer-moenster som ankertabellen i RACE_ENGINE_RULES.md (#4911):
// TALLENE genereres, PROSAEN omkring dem skrives af et menneske og overlever
// en re-render. Uden markoererne ville en genkoersel slette laesningen og
// anbefalingen ejeren faktisk skal bruge.
export const START_MARKER = "<!-- teamplay-ab:start -->";
export const END_MARKER = "<!-- teamplay-ab:end -->";

export function replaceBlock(existingText, block) {
  const start = existingText.indexOf(START_MARKER);
  const end = existingText.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end < start) return null;
  return `${existingText.slice(0, start)}${block}${existingText.slice(end + END_MARKER.length)}`;
}

function render(a, b) {
  const lines = [];
  const bA = new Map(b.anchors.map((x) => [x.id, x]));

  lines.push(START_MARKER);
  lines.push("");
  lines.push("> Alt mellem markoererne er GENERERET af `backend/scripts/teamPlayAbMeasure.mjs --render`. Ret ikke tallene i haanden.");
  lines.push("");
  lines.push(`Maalt ${a.generated_at} (A) og ${b.generated_at} (B).`);
  lines.push("");
  lines.push(
    `Samme motor, samme pinnede population (\`${a.population_file}\`), samme pinnede proxy-etaper (\`${a.stages_file}\`), ` +
      `${a.seeds.length} seeds (${a.seeds.join(", ")}), felt ${a.field_size}, \`--orders=ai\`. ` +
      `Kun holdspils-tuningen (M16) er forskellig mellem A og B.`,
  );
  lines.push("");
  lines.push(`**A** (nuvaerende, paa main): ${a.note ?? "-"}`);
  lines.push("");
  lines.push(`**B**: ${b.note ?? "-"}`);
  lines.push("");

  lines.push("## Beskyttelses-gab (noegletallet)");
  lines.push("");
  lines.push("Pladser den beskyttede rytter staar bedre end sin hjaelper, ud over hvad rytternes egen evne-rang forklarer. 0 = motoren har intet holdspil.");
  lines.push("");
  lines.push("| | v3 (uaendret referencemotor) | v4 A | v4 B |");
  lines.push("|---|---|---|---|");
  lines.push(`| Beskyttelses-gab, middel (spaend over seeds) | ${gapSummary(a, "v3")} | ${gapSummary(a, "v4")} | ${gapSummary(b, "v4")} |`);
  lines.push(
    `| Leder over/under forventet | ${a.team_play.pooled.roles.captain?.v3Delta?.toFixed(2) ?? "n/a"} | ` +
      `${a.team_play.pooled.roles.captain?.v4Delta?.toFixed(2) ?? "n/a"} | ${b.team_play.pooled.roles.captain?.v4Delta?.toFixed(2) ?? "n/a"} |`,
  );
  lines.push(
    `| Hjaelper over/under forventet | ${a.team_play.pooled.roles.helper?.v3Delta?.toFixed(2) ?? "n/a"} | ` +
      `${a.team_play.pooled.roles.helper?.v4Delta?.toFixed(2) ?? "n/a"} | ${b.team_play.pooled.roles.helper?.v4Delta?.toFixed(2) ?? "n/a"} |`,
  );
  lines.push("");

  lines.push("## Ankre: A mod B");
  lines.push("");
  lines.push("Middel over seeds, spaend i parentes. Kun v4-kolonnerne; v3 er den samme motor i begge koersler.");
  lines.push("");
  lines.push("| Anker | Baand | v4 A | v4 B | Skift |");
  lines.push("|---|---|---|---|---|");
  for (const anchor of a.anchors) {
    const bAnchor = bA.get(anchor.id);
    const aCell = anchor.v4;
    const bCell = bAnchor?.v4;
    const aVerdict = aCell?.verdict ?? "N/A";
    const bVerdict = bCell?.verdict ?? "N/A";
    const shift = aVerdict === bVerdict ? "" : `**${aVerdict} -> ${bVerdict}**`;
    lines.push(
      `| ${anchor.label} | ${anchor.band_label} | ${fmtAnchor(aCell, anchor.id)} | ${fmtAnchor(bCell, anchor.id)} | ${shift} |`,
    );
  }
  lines.push("");

  lines.push("## Hale-gate (§9 raekke 13, ejer-laast 7/9)");
  lines.push("");
  lines.push(`Koert med \`v4TailSpread.js --gate\`, ${a.tail_gate_seeds.join(", ")}, felt ${a.field_size}.`);
  lines.push("");
  lines.push("| Etapetype | Baand | A: ren p90 | A | B: ren p90 | B |");
  lines.push("|---|---|---|---|---|---|");
  const bTail = new Map(b.tail_gate.rows.map((r) => [r.profileType, r]));
  for (const row of a.tail_gate.rows) {
    if (row.band === "-") continue;
    const other = bTail.get(row.profileType);
    lines.push(
      `| ${row.profileType} | ${row.band} | ${row.cleanP90Pct?.toFixed(2) ?? "n/a"} % | ${row.status} | ` +
        `${other?.cleanP90Pct?.toFixed(2) ?? "n/a"} % | ${other?.status ?? "n/a"} |`,
    );
  }
  lines.push("");
  lines.push(`Samlet gate-dom: A ${a.tail_gate.allPass ? "PASS" : "FAIL"} · B ${b.tail_gate.allPass ? "PASS" : "FAIL"}.`);
  lines.push("");

  lines.push("## Tuning-vaerdierne bag hver variant");
  lines.push("");
  lines.push("| Knap | A | B |");
  lines.push("|---|---|---|");
  const keys = ["helperCostFractionGc", "helperCostFractionFlat", "helperCostFractionOther", "hunterCostFraction", "captainMaxBonusFraction", "transferEfficiency", "minCpFactor", "supportSaturationWorkers", "minWorkersForProtection"];
  for (const key of keys) {
    lines.push(`| \`${key}\` | ${a.team_play_tuning[key]} | ${b.team_play_tuning[key]} |`);
  }
  lines.push("");
  lines.push(END_MARKER);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------

function main() {
  const outPath = argValue("out");
  if (!outPath) throw new Error("--out=<fil> kraeves");

  if (process.argv.includes("--render")) {
    const aPath = argValue("a");
    const bPath = argValue("b");
    if (!aPath || !bPath) throw new Error("--render kraever --a=<fil>.json og --b=<fil>.json");
    const a = JSON.parse(readFileSync(aPath, "utf8"));
    const b = JSON.parse(readFileSync(bPath, "utf8"));
    const block = render(a, b);
    mkdirSync(dirname(outPath), { recursive: true });
    if (existsSync(outPath)) {
      const existing = readFileSync(outPath, "utf8");
      const next = replaceBlock(existing, block);
      if (next === null) {
        throw new Error(`${outPath} findes men mangler ${START_MARKER}/${END_MARKER} — nagter at overskrive haandskrevet tekst`);
      }
      writeFileSync(outPath, next);
      console.log(`Tal-blokken opdateret i: ${outPath}`);
      return;
    }
    writeFileSync(outPath, `${block}\n`);
    console.log(`Rapport skrevet: ${outPath}`);
    return;
  }

  const label = argValue("label");
  if (!label) throw new Error("--label=<A|B> kraeves");
  const result = measure(label, argValue("note"));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Maaling "${label}" skrevet: ${outPath}`);
  console.log(`  beskyttelses-gab v3 ${gapSummary(result, "v3")} · v4 ${gapSummary(result, "v4")}`);
  console.log(`  hale-gate: ${result.tail_gate.allPass ? "PASS" : "FAIL"}`);
}

if (process.argv[1]?.endsWith("teamPlayAbMeasure.mjs")) main();
