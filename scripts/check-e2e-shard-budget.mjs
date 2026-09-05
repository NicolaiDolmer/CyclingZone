#!/usr/bin/env node
// scripts/check-e2e-shard-budget.mjs
// ============================================================
// Tidsbudget-gate + samle-dommer for de shardede Playwright-koersler (#4647).
//
// FEJLKLASSEN den lukker: e2e-suiten voksede fra minutter til 26-28 min UDEN
// at noget blev roedt. Der var ingen maaling, saa der var heller ingen dag hvor
// nogen kunne sige "nu er den for langsom". Denne gate goer graensen eksplicit:
// tager EN shard laengere end budgettet, fejler samle-jobbet med et tal.
//
// Den er samtidig det job der hedder `frontend-smoke` (required check paa main).
// Matrix-jobbene hedder `e2e-shard (<projekt>)` og er IKKE required - GitHub
// suffikser matrix-navne med "(<vaerdi>)", saa et required check kan aldrig
// pege paa et matrix-job (se scripts/check-required-ci-jobs.mjs, sag (c)).
// Derfor: shards koerer testene, dette script faelder dommen.
//
// Brug:
//   node scripts/check-e2e-shard-budget.mjs \
//     --dir e2e-shard-metrics \
//     --budget-minutes 12 \
//     --shards-result success \
//     --projects desktop-chromium,mobile-chromium,mobile-webkit
//
// Hver shard skriver EN fil i --dir:
//   { "project": "desktop-chromium", "seconds": 312, "exitCode": 0 }
//
// Exit 0 = groent samle-job. Exit 1 = roedt.
//
// Refs #4647 #4292 #4548.

import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Parser argv til et fladt options-objekt. Bevidst minimal (samme idiom som
 * repoets oevrige scripts) - ingen dependency for fem flag.
 *
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

/**
 * Tvinger en raa JSON-vaerdi til et sekund-tal - eller til NaN hvis den ikke
 * ENTYDIGT er et tal. `Number(null)` er 0 i JavaScript, saa en shard der
 * skriver `"seconds":null` (delvis/afbrudt maaling) blev foer tolket som "0
 * sekunder" og passerede tidsbudgettet STILLE (CodeRabbit-fund paa #4665,
 * #4711). `Number(undefined)` er allerede NaN, saa kun `null` var det
 * utaette hul - men tjekket her er bevidst strengt (kun `number`/`string`
 * accepteres) saa ingen anden JS-til-tal-coercion (bool, array, object) kan
 * genintroducere samme klasse.
 *
 * @param {unknown} raw
 * @returns {number} et endeligt sekund-tal, eller NaN hvis maalingen mangler/er ugyldig
 */
export function coerceSeconds(raw) {
  if (typeof raw !== "number" && typeof raw !== "string") return Number.NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Laeser shard-maalingerne fra en mappe. Ugyldig JSON og filer uden `project`
 * ignoreres IKKE stille - de bliver til en fejl i evaluateShards via den
 * manglende projekt-maaling, saa gaten aldrig kan blive groen ved at tabe sin
 * egen maaling.
 *
 * @param {string} dir
 * @returns {{project: string, seconds: number, exitCode: number}[]}
 */
export function readShardMetrics(dir) {
  if (!existsSync(dir)) return [];
  const metrics = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json") || file.startsWith("flakes-")) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.project !== "string") continue;
    metrics.push({
      project: parsed.project,
      seconds: coerceSeconds(parsed.seconds),
      exitCode: Number(parsed.exitCode ?? 0),
    });
  }
  return metrics;
}

/**
 * Faelder dommen over en hel matrix-koersel.
 *
 * @param {object} input
 * @param {{project: string, seconds: number, exitCode: number}[]} input.shards
 * @param {number} input.budgetMinutes
 * @param {string} input.shardsResult GitHub's `needs.<job>.result` for matrixen
 * @param {string[]} input.projects forventede projekter
 * @returns {{ok: boolean, lines: string[], rows: {project: string, seconds: number, over: boolean}[]}}
 */
export function evaluateShards({ shards, budgetMinutes, shardsResult, projects }) {
  const lines = [];
  const budgetSeconds = Math.round(budgetMinutes * 60);
  const rows = shards
    .map((s) => ({ project: s.project, seconds: s.seconds, over: Number.isFinite(s.seconds) && s.seconds > budgetSeconds }))
    .sort((a, b) => a.project.localeCompare(b.project));

  // Suiten koerte slet ikke (docs-/backend-PR eller merge-koe). `skipped`
  // taeller som groent for branch protection praecis som foer shardingen.
  if (shardsResult === "skipped") {
    lines.push("e2e-shards blev sprunget over (ingen frontend-aendringer). Intet at maale.");
    return { ok: true, lines, rows };
  }

  if (shardsResult === "cancelled") {
    lines.push("e2e-shards blev afbrudt (cancelled). Samle-checket kan ikke give groent lys.");
    return { ok: false, lines, rows };
  }

  let ok = true;

  if (shardsResult !== "success") {
    lines.push(`Mindst en e2e-shard fejlede (matrix-resultat: ${shardsResult}). Se e2e-shard-jobbene og playwright-report-artifacten.`);
    ok = false;
  }

  for (const project of projects) {
    const row = rows.find((r) => r.project === project);
    if (!row) {
      lines.push(`Ingen tidsmaaling for shard "${project}". Gaten maa aldrig tabe sin egen maaling - tjek upload-artifact-steppet i e2e-shard-jobbet.`);
      ok = false;
      continue;
    }
    if (!Number.isFinite(row.seconds)) {
      lines.push(`Tidsmaalingen for shard "${project}" er ikke et tal. Tjek metrics-filen i artifacten.`);
      ok = false;
      continue;
    }
    if (row.over) {
      lines.push(
        `Shard "${project}" tog ${formatDuration(row.seconds)} og er over tidsbudgettet paa ${budgetMinutes} min. ` +
          "Suiten er blevet for langsom: split flere specs ud, fjern ventetid i testene, eller haev budgettet BEVIDST i workflowet (#4647).",
      );
      ok = false;
    }
  }

  const extra = rows.filter((r) => !projects.includes(r.project));
  for (const row of extra) {
    lines.push(`Ukendt shard "${row.project}" i maalingerne. Er matrixen og --projects ude af sync?`);
    ok = false;
  }

  return { ok, lines, rows };
}

/**
 * @param {number} seconds
 * @returns {string} "7 min 12 s"
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "ukendt";
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return mins > 0 ? `${mins} min ${rest} s` : `${rest} s`;
}

/**
 * Bygger den markdown-tabel der lander i job-summary'en.
 *
 * @param {{project: string, seconds: number, over: boolean}[]} rows
 * @param {number} budgetMinutes
 * @returns {string}
 */
export function renderSummary(rows, budgetMinutes) {
  const head = [`### Playwright-shards (budget: ${budgetMinutes} min pr. shard)`, "", "| Shard | Tid | Status |", "|---|---:|---|"];
  const body = rows.length
    ? rows.map((r) => `| ${r.project} | ${formatDuration(r.seconds)} | ${r.over ? "OVER BUDGET" : "ok"} |`)
    : ["| (ingen shards koerte) | - | - |"];
  return [...head, ...body, ""].join("\n");
}

function main(argv) {
  const args = parseArgs(argv);
  const dir = args.dir || "e2e-shard-metrics";
  const budgetMinutes = Number(args["budget-minutes"] || 12);
  const shardsResult = args["shards-result"] || "success";
  const projects = (args.projects || "desktop-chromium,mobile-chromium,mobile-webkit")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const shards = readShardMetrics(dir);
  const { ok, lines, rows } = evaluateShards({ shards, budgetMinutes, shardsResult, projects });

  const summary = renderSummary(rows, budgetMinutes);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    } catch {
      // Summary er kosmetik; den maa aldrig vaelte selve gaten.
    }
  }

  for (const line of lines) {
    if (ok) console.log(`   ${line}`);
    else console.error(`::error::${line}`);
  }

  if (!ok) {
    console.error("\nfrontend-smoke er ROEDT: se linjerne ovenfor.");
    return 1;
  }
  console.log("\nfrontend-smoke er GROENT: alle shards inden for tidsbudgettet.");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}

export const __testables = { main, ROOT: fileURLToPath(new URL(".", import.meta.url)) };
