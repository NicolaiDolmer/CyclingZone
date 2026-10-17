#!/usr/bin/env node
// backend/scripts/dev/seasonTransitionRehearsal.mjs
// ============================================================================
// #6751 · Generalprøve af et sæsonskifte: kør de eksisterende tørkørsler i fast
// rækkefølge og saml resultatet ét sted.
//
// HVORFOR. Før #6751 lå tørkørslerne spredt (preflight, gylden kalender-diff,
// løbsdags-dry-run, oprykning, kontraktudløb, bestyrelse, parkering, akademi,
// aldring, selve transitions-planen). Hver gang et skifte nærmede sig, skulle
// nogen huske listen, rækkefølgen og hvordan hver enkelt aflæses. Dette script
// er listen, gjort gentagelig. Det tilføjer INGEN ny beregning: hvert trin er et
// eksisterende script, kaldt uændret.
//
// READ-ONLY. Scriptet skriver aldrig til en database:
//   · Ethvert trin valideres af `assertReadOnlyStep` FØR kørsel. Et trin med et
//     skrive-flag (--apply, --execute, --live, --owner-go, --replace-existing,
//     --force) afvises, og hele kørslen stopper før første trin.
//   · Prod-trin kører kun med `--prod`, og kun gennem
//     `infisical run --env=prod --silent --` (samme vej som runbookens egne
//     tørkørsler). Uden `--prod` køres kun offline-trin (ingen credentials).
//   · Trinenes rå output kan indeholde holdnavne og balance-tal. Det skrives
//     KUN til `balance-internals/<issue>/` (gitignoreret, hard rule 17).
//     Konsollen og den offentlige oversigt får kun trin, status og exit-kode.
//
// BRUG (fra repo-roden):
//   node backend/scripts/dev/seasonTransitionRehearsal.mjs --list
//   node backend/scripts/dev/seasonTransitionRehearsal.mjs                 # kun offline-trin
//   node backend/scripts/dev/seasonTransitionRehearsal.mjs --prod          # + read-only prod-trin
//   node backend/scripts/dev/seasonTransitionRehearsal.mjs --prod --only=contract-expiry,parking
//   valgfrit: --from=4 (afsluttende sæson, default 4) · --issue=6751 (mappe i balance-internals)
//
// Exit: 0 = alle kørte trin grønne/gule · 1 = mindst ét rødt trin eller en
// kørselsfejl · 2 = ugyldige argumenter eller et trin der ikke er read-only.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const BACKEND = join(REPO_ROOT, "backend");

export const FORBIDDEN_FLAGS = Object.freeze([
  "--apply",
  "--execute",
  "--live",
  "--owner-go",
  "--replace-existing",
  "--force",
]);

export const PROD_WRAPPER = Object.freeze(["infisical", "run", "--env=prod", "--silent", "--"]);

/**
 * Dommer pr. trin. Returnerer "green" | "yellow" | "red". `ran` betyder at
 * trinnet kørte uden fejl, men at selve aflæsningen er menneskets (tallene står
 * i den private log). Exit ≠ 0 er altid rødt, medmindre trinnet siger andet.
 */
const exitJudge = ({ exitCode }) => (exitCode === 0 ? "ran" : "red");

export const judges = Object.freeze({
  preflight: ({ exitCode, output }) => {
    if (exitCode !== 0 || /\[NO-GO\]/.test(output)) return "red";
    return /\[warn\]/.test(output) ? "yellow" : "green";
  },
  // Exit 0 betyder kun "ingen hård invariant brudt". En ændret kalender uden
  // hårde brud er også exit 0 (CALENDAR_RULES.md), men skal undersøges: gul.
  goldenDiff: ({ exitCode, output }) => {
    // Kun dommens slutlinjer tæller. "❌" står også i den målte, IKKE dømte
    // S5-benchmark-sektion (#6367) og må ikke farve trinnet rødt.
    if (exitCode !== 0 || /❌ (HÅRDE INVARIANTER BRUDT|S5 BENCHMARK-GATEN ER RØD)/.test(output)) return "red";
    return /Kalenderen er identisk med den gyldne snapshot/.test(output) ? "green" : "yellow";
  },
  loadtest: ({ exitCode, output }) => {
    if (exitCode === 0 && !/: FAIL/.test(output)) return "green";
    return "red";
  },
  promotionPending: ({ exitCode, output }) => {
    if (exitCode !== 0) return "red";
    const pending = [...output.matchAll(/AFVENTER (\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
    return pending > 0 ? "yellow" : "green";
  },
  transitionPlan: ({ exitCode, output }) => {
    if (exitCode !== 0) return "red";
    return /cron vil IKKE fyre/.test(output) ? "yellow" : "green";
  },
  exit: exitJudge,
});

/**
 * Den faste rækkefølge. Offline-trin først (ingen credentials), derefter
 * prod-trin i den rækkefølge sæsonskiftet selv rører områderne.
 *
 * @param {{fromSeason:number}} opts
 */
export function buildPlan({ fromSeason = 4 } = {}) {
  const toSeason = fromSeason + 1;
  return [
    {
      id: "preflight",
      area: "Kode, tests og kendte risici",
      kind: "offline",
      cwd: REPO_ROOT,
      cmd: ["pwsh", "-NoProfile", "-File", "scripts/preflight-season-cutover.ps1",
        "-FromSeasonNumber", String(fromSeason), "-ToSeasonNumber", String(toSeason)],
      judge: "preflight",
    },
    {
      id: "calendar-golden-diff",
      area: "Kalender: gylden diff + hårde invarianter",
      kind: "offline",
      cwd: BACKEND,
      cmd: ["node", "scripts/dev/calendarGoldenDiff.mjs"],
      judge: "goldenDiff",
    },
    {
      id: "loadtest-race-day",
      area: "Løbsdags-dry-run (#5904)",
      kind: "offline",
      cwd: REPO_ROOT,
      cmd: ["node", "backend/scripts/loadtestRaceDay.mjs"],
      judge: "loadtest",
    },
    {
      // Første prod-trin og VAGTEN: dets "Aktiv sæson: #N" skal være --from.
      // Flere af de øvrige prod-scripts vælger selv den aktive sæson, så en
      // forkert --from ville ellers blande to skift under én overskrift.
      id: "transition-plan",
      area: "Transitionsplan, sponsor, carry-over, vindue-markører",
      kind: "prod",
      guard: true,
      cwd: BACKEND,
      cmd: ["node", "scripts/simulateSeasonTransitionDryRun.js"],
      judge: "transitionPlan",
    },
    {
      id: "promotion-pending",
      area: "Oprykning/graduering (#6710)",
      kind: "prod",
      cwd: BACKEND,
      cmd: ["node", "scripts/dryrun-6710-promotion-pending.js", "--season", String(toSeason)],
      judge: "promotionPending",
    },
    {
      id: "missed-graduates",
      area: "Akademi: ryttere uden graduerings-række (#5133)",
      kind: "prod",
      cwd: REPO_ROOT,
      cmd: ["node", "backend/scripts/detect-missed-graduates.js"],
      judge: "exit",
    },
    {
      id: "contract-expiry",
      area: "Kontraktudløb (senior)",
      kind: "prod",
      cwd: BACKEND,
      cmd: ["node", "scripts/dryRunContractExpirySeasonEnd.js"],
      judge: "exit",
    },
    {
      id: "transition-risk-notice",
      area: "Varsel om kontrakt-/pensionsrisiko (dry-run, sender intet)",
      kind: "prod",
      cwd: BACKEND,
      cmd: ["node", "scripts/notifySeasonTransitionRisk.js"],
      judge: "exit",
    },
    {
      id: "aging-v2",
      area: "Aldring/tilbagegang (#6110/#5833)",
      kind: "prod",
      cwd: BACKEND,
      cmd: ["node", "scripts/dev/agingV2DryRun6110.mjs"],
      judge: "exit",
    },
    {
      id: "next-mandate",
      area: "Bestyrelse: årsmødets nye mandater",
      kind: "prod",
      cwd: BACKEND,
      cmd: ["node", "scripts/proposeNextMandateDryRun.js"],
      judge: "exit",
    },
    {
      id: "parking",
      area: "Parkering af inaktive hold (#4592)",
      kind: "prod",
      cwd: BACKEND,
      cmd: ["node", "scripts/parkingDryRun.js"],
      judge: "exit",
    },
    {
      id: "academy-intake-health",
      area: "Akademi-intake-køen",
      kind: "prod",
      cwd: REPO_ROOT,
      cmd: ["node", "backend/scripts/dev/academyIntakeQueueHealth.mjs"],
      judge: "exit",
    },
    {
      id: "league-size",
      area: "Liga: 24 hold pr. aktiv pulje",
      kind: "prod",
      cwd: BACKEND,
      cmd: ["node", "scripts/audit-league-size-invariant.js"],
      judge: "exit",
    },
  ];
}

/** Kaster hvis trinnet bærer et skrive-flag. Ren, testbar. */
export function assertReadOnlyStep(step) {
  for (const part of step.cmd) {
    const flag = String(part).split("=")[0].toLowerCase();
    if (FORBIDDEN_FLAGS.includes(flag)) {
      throw new Error(`Trin '${step.id}' er ikke read-only: ${part}`);
    }
  }
  if (step.kind !== "offline" && step.kind !== "prod") {
    throw new Error(`Trin '${step.id}' har ukendt kind '${step.kind}'`);
  }
  return true;
}

/** Fortolker CLI-argumenter. Ren, testbar. */
export function parseArgs(argv) {
  const opts = { prod: false, list: false, only: null, fromSeason: 4, issue: "6751" };
  for (const a of argv) {
    if (a === "--prod") opts.prod = true;
    else if (a === "--list") opts.list = true;
    else if (a.startsWith("--only=")) opts.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--from=")) opts.fromSeason = Number(a.slice(7));
    else if (a.startsWith("--issue=")) opts.issue = a.slice(8);
    else throw new Error(`Ukendt argument: ${a}`);
  }
  if (!Number.isInteger(opts.fromSeason) || opts.fromSeason < 1) {
    throw new Error("--from skal være et positivt heltal");
  }
  if (!/^[0-9]+$/.test(opts.issue)) throw new Error("--issue skal være et issue-nummer");
  return opts;
}

/**
 * Vælger trinene der skal køre. Prod-trin springes over (status `skipped`)
 * uden --prod; et ukendt --only-id er en fejl, ikke en stille udeladelse.
 */
export function selectSteps(plan, { prod, only }) {
  if (only) {
    const known = new Set(plan.map((s) => s.id));
    const unknown = only.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`Ukendte trin i --only: ${unknown.join(", ")}`);
  }
  const wanted = (s) => !only || only.includes(s.id);
  // Vagt-trinnet følger altid med, når mindst ét prod-trin er valgt.
  const anyProd = plan.some((s) => s.kind === "prod" && wanted(s));
  return plan
    .filter((s) => wanted(s) || (s.guard && anyProd))
    .map((s) => ({ ...s, skip: s.kind === "prod" && !prod ? "kræver --prod" : null }));
}

/** Læser "Aktiv sæson: #N" fra transitions-dry-run'en. null hvis linjen mangler. */
export function activeSeasonFromOutput(output) {
  const m = /Aktiv sæson: #(\d+)/.exec(output ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Vagt: prod-trinene må kun køre, når prods aktive sæson er den sæson
 * rapporten hedder (--from). Returnerer en fejltekst eller null.
 */
export function seasonGuardError(output, fromSeason) {
  const active = activeSeasonFromOutput(output);
  if (active == null) return "kunne ikke læse aktiv sæson";
  return active === fromSeason ? null : `aktiv sæson er S${active}, ikke S${fromSeason}`;
}

/** Bygger den faktiske kommandolinje (prod-trin pakkes i infisical-wrapperen). */
export function commandFor(step) {
  return step.kind === "prod" ? [...PROD_WRAPPER, ...step.cmd] : [...step.cmd];
}

export function judgeStep(step, { exitCode, output }) {
  const fn = judges[step.judge] ?? judges.exit;
  return fn({ exitCode, output: output ?? "" });
}

/** Offentlig oversigt: kun trin, område, status og exit. Ingen tal fra output. */
export function renderSummary(results, { fromSeason, startedAt }) {
  const icon = { green: "grøn", yellow: "gul", red: "RØD", ran: "kørt (aflæs log)", skipped: "sprunget over" };
  const lines = [
    `# Generalprøve S${fromSeason} -> S${fromSeason + 1} (${startedAt})`,
    "",
    "| Trin | Område | Status | Exit |",
    "|---|---|---|---|",
  ];
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.area} | ${icon[r.status] ?? r.status}${r.note ? ` (${r.note})` : ""} | ${r.exitCode ?? "-"} |`);
  }
  const red = results.filter((r) => r.status === "red").length;
  lines.push("", red ? `${red} rødt/røde trin. Læs den private log pr. trin.` : "Ingen røde trin.");
  return lines.join("\n") + "\n";
}

export function overallExit(results) {
  return results.some((r) => r.status === "red") ? 1 : 0;
}

function runStep(step) {
  const [bin, ...args] = commandFor(step);
  const res = spawnSync(bin, args, {
    cwd: step.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Ingen shell: argumenterne sendes uescapede videre med shell=true (DEP0190).
    // node, pwsh og infisical er alle rigtige .exe-filer på Windows.
    shell: false,
    env: process.env,
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const exitCode = res.error ? 2 : res.status ?? 2;
  return { exitCode, output: res.error ? `${output}\n${res.error.message}` : output };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const plan = buildPlan({ fromSeason: opts.fromSeason });
  try {
    plan.forEach(assertReadOnlyStep);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  let steps;
  try {
    steps = selectSteps(plan, opts);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (opts.list) {
    for (const s of steps) console.log(`${s.id.padEnd(24)} ${s.kind.padEnd(8)} ${commandFor(s).join(" ")}`);
    return;
  }

  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const privDir = join(REPO_ROOT, "balance-internals", opts.issue, `rehearsal-${stamp}`);
  mkdirSync(privDir, { recursive: true });

  const results = [];
  let prodBlocked = null;
  for (const step of steps) {
    const skip = step.skip ?? (step.kind === "prod" && prodBlocked ? `vagt: ${prodBlocked}` : null);
    if (skip) {
      results.push({ id: step.id, area: step.area, status: "skipped", note: skip, exitCode: null });
      console.log(`- ${step.id}: sprunget over (${skip})`);
      continue;
    }
    console.log(`> ${step.id} ...`);
    const { exitCode, output } = runStep(step);
    writeFileSync(join(privDir, `${step.id}.txt`), output);
    let status = judgeStep(step, { exitCode, output });
    let note = null;
    if (step.guard) {
      prodBlocked = seasonGuardError(output, opts.fromSeason);
      if (prodBlocked) {
        status = "red";
        note = prodBlocked;
      }
    }
    results.push({ id: step.id, area: step.area, status, exitCode, note });
    console.log(`  ${step.id}: ${status} (exit ${exitCode})${note ? ` - ${note}` : ""}`);
  }

  const summary = renderSummary(results, { fromSeason: opts.fromSeason, startedAt });
  writeFileSync(join(privDir, "SUMMARY.md"), summary);
  console.log(`\n${summary}`);
  console.log(`Privat log (gitignoreret): ${privDir}`);
  process.exitCode = overallExit(results);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
