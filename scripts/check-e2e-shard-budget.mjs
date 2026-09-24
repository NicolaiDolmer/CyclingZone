#!/usr/bin/env node
// scripts/check-e2e-shard-budget.mjs
// ============================================================
// Shard-plan + tidsbudget-gate + samle-dommer for de shardede Playwright-
// koersler (#4647, omlagt #5309).
//
// FEJLKLASSEN den oprindeligt lukkede (#4647): e2e-suiten voksede fra minutter
// til 26-28 min UDEN at noget blev roedt. Der var ingen maaling, saa der var
// heller ingen dag hvor nogen kunne sige "nu er den for langsom".
//
// FEJLKLASSEN #5309 lukker: den foerste udgave var en FAST graense (12 min pr.
// projekt) paa en suite der vokser eksponentielt ved politik — hver bugfix faar
// sin regressionstest. To ting foelger af det, og begge blev maalt 16/9:
//   (a) Gaten koerte paa 95 % udnyttelse (mobile-webkit 685 s median mod 720 s)
//       og faeldede derfor dom over den tilfaeldige PR der lagde de sidste 38 s
//       paa (#5308) i stedet for over vaeksten (207 -> 335 tests paa 14 dage).
//   (b) Paa GitHubs delte runnere har de SAMME 323 tests taget fra 514 s til
//       961 s (33 koersler 15.-16/9). Taet paa graensen er et fast tal et
//       moentkast: gaten var allerede roed 15/9 paa #5284 med uaendret testantal.
//
// Svaret er ikke en smartere statistik, men LUFT + en plan der er data:
//   • frontend/tests/e2e/shard-plan.json bestemmer antal laner pr. projekt og
//     ekspanderes til workflowets matrix af --emit-github-output herunder.
//     Et laneantal aendres med eet tal i en datafil, aldrig med en refaktor.
//   • ceilingSecondsPerShard er sikkerhedsnettet pr. lane, bevidst sat ~2,4x
//     over faktisk forbrug, saa runner-stoej ikke kan udloese det.
//   • targetSecondsPerShard er planlaegnings-tallet: scriptet summerer lanerne
//     pr. projekt og regner ceil(total / target) = det antal laner projektet
//     BURDE have. Tallet staar i job-summary paa hver koersel; kun den natlige
//     main-koersel (--enforce-plan) bliver roed af en underforsynet plan.
//     Vaeksten meldes dermed paa main, hvor den hoerer hjemme — aldrig paa en
//     tilfaeldig PR. CI skalerer ikke sit eget forbrug i tavshed: den regner
//     det rigtige tal ud og forlanger en eentalsrettelse et menneske ratificerer.
//
// Den er samtidig det job der hedder `frontend-smoke` (required check paa main).
// Matrix-jobbene hedder `e2e-shard (<lane>)` og er IKKE required - GitHub
// suffikser matrix-navne med "(<vaerdi>)", saa et required check kan aldrig
// pege paa et matrix-job (se scripts/check-required-ci-jobs.mjs, sag (c)).
// Derfor: laner koerer testene, dette script faelder dommen.
//
// Brug:
//   node scripts/check-e2e-shard-budget.mjs \
//     --dir e2e-shard-metrics \
//     --plan frontend/tests/e2e/shard-plan.json \
//     --shards-result success \
//     [--enforce-plan]
//
//   node scripts/check-e2e-shard-budget.mjs \
//     --plan frontend/tests/e2e/shard-plan.json --emit-github-output
//
// Uden --plan koerer den paa de gamle flag (--budget-minutes/--projects), saa
// en aeldre kaldsform aldrig bliver stille groen.
//
// Hver lane skriver EN fil i --dir:
//   { "project": "mobile-webkit-1of3", "group": "mobile-webkit",
//     "seconds": 241, "exitCode": 0 }
// `project` er lanens UNIKKE identitet (det gaten matcher mod de forventede
// laner); `group` er projektet den hoerer til og bruges kun til plan-regnestykket.
// Mangler `group`, falder den tilbage til `project` — gamle artifacts virker.
//
// Exit 0 = groent samle-job. Exit 1 = roedt.
//
// Refs #4647 #4292 #4548 #4711 #5309.

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
 * Laeser og VALIDERER shard-planen. Kaster ved enhver uklarhed: en plan der
 * ikke kan laeses maa aldrig degradere til en tom matrix (nul laner = nul
 * tests = groent samle-job uden at noget blev koert).
 *
 * @param {string} file sti til shard-plan.json
 * @returns {{targetSeconds: number, ceilingSeconds: number, projects: {project: string, browser: string, shards: number}[]}}
 */
export function readPlan(file) {
  return parsePlan(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * Validerings-delen af readPlan, skilt ud saa den kan testes uden filsystem.
 *
 * @param {unknown} parsed
 * @returns {{targetSeconds: number, ceilingSeconds: number, projects: {project: string, browser: string, shards: number}[]}}
 */
// Lane-navnet bliver til et FILNAVN (`e2e-shard-metrics/<key>.json`), et
// ARTIFACT-navn og et job-navn, og `browser` gaar ubehandlet videre til
// `npx playwright install <browser>`. Et navn som "mobile/webkit" ville derfor
// pege redirectionen ned i en mappe der ikke findes, og et navn med
// shell-metategn kunne aendre install-kommandoen. Det er ikke en ny
// tillidsgraense - den der kan rette planen kan i forvejen rette workflowet -
// men det flytter fejlen fra en kryptisk doed Windows-lane midt i en koersel
// til en tydelig fejl i det 10-sekunders plan-job. Validering er hele grunden
// til at plan-jobbet findes; saa skal den ogsaa daekke det den lover.
// (CodeRabbit-fund paa #5311.)
const PLAN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parsePlan(parsed) {
  const targetSeconds = Number(parsed?.targetSecondsPerShard);
  const ceilingSeconds = Number(parsed?.ceilingSecondsPerShard);
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new Error(`shard-plan: targetSecondsPerShard skal vaere et positivt tal (fik ${parsed?.targetSecondsPerShard})`);
  }
  if (!Number.isFinite(ceilingSeconds) || ceilingSeconds <= 0) {
    throw new Error(`shard-plan: ceilingSecondsPerShard skal vaere et positivt tal (fik ${parsed?.ceilingSecondsPerShard})`);
  }
  if (ceilingSeconds < targetSeconds) {
    throw new Error("shard-plan: ceilingSecondsPerShard maa ikke vaere mindre end targetSecondsPerShard - loftet er sikkerhedsnettet, target er planlaegnings-tallet");
  }
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    throw new Error("shard-plan: projects skal vaere en ikke-tom liste");
  }
  const seen = new Set();
  const projects = parsed.projects.map((entry) => {
    const project = entry?.project;
    const browser = entry?.browser;
    const shards = Number(entry?.shards);
    if (typeof project !== "string" || !project) throw new Error("shard-plan: hver post skal have et project-navn");
    if (!PLAN_NAME_RE.test(project)) {
      throw new Error(`shard-plan: project "${project}" maa kun indeholde bogstaver, tal, punktum, bindestreg og underscore - navnet bliver til et filnavn og et artifact-navn`);
    }
    if (typeof browser !== "string" || !browser) throw new Error(`shard-plan: ${project} mangler browser`);
    if (!PLAN_NAME_RE.test(browser)) {
      throw new Error(`shard-plan: ${project}.browser "${browser}" maa kun indeholde bogstaver, tal, punktum, bindestreg og underscore - vaerdien gaar videre til "npx playwright install"`);
    }
    if (!Number.isInteger(shards) || shards < 1) throw new Error(`shard-plan: ${project}.shards skal vaere et helt tal >= 1 (fik ${entry?.shards})`);
    if (seen.has(project)) throw new Error(`shard-plan: ${project} staar to gange`);
    seen.add(project);
    return { project, browser, shards };
  });
  return { targetSeconds, ceilingSeconds, projects };
}

/**
 * Ekspanderer planen til workflowets matrix. `key` er lanens identitet og
 * bruges baade som job-navn, metrics-filnavn og artifact-navn - derfor er den
 * fri for tegn der ikke maa staa i et artifact-navn (ingen "/").
 *
 * @param {{projects: {project: string, browser: string, shards: number}[]}} plan
 * @returns {{key: string, project: string, browser: string, shard: string}[]}
 */
export function expandPlan(plan) {
  const lanes = [];
  for (const { project, browser, shards } of plan.projects) {
    for (let i = 1; i <= shards; i += 1) {
      lanes.push({ key: `${project}-${i}of${shards}`, project, browser, shard: `${i}/${shards}` });
    }
  }
  return lanes;
}

/**
 * Laeser shard-maalingerne fra en mappe. Ugyldig JSON og filer uden `project`
 * ignoreres IKKE stille - de bliver til en fejl i evaluateShards via den
 * manglende lane-maaling, saa gaten aldrig kan blive groen ved at tabe sin
 * egen maaling.
 *
 * @param {string} dir
 * @returns {{project: string, group: string, seconds: number, exitCode: number}[]}
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
      // Gamle artifacts (foer #5309) har ingen `group` - saa ER lanen projektet.
      group: typeof parsed.group === "string" && parsed.group ? parsed.group : parsed.project,
      seconds: coerceSeconds(parsed.seconds),
      exitCode: Number(parsed.exitCode ?? 0),
    });
  }
  return metrics;
}

/**
 * Regner det antal laner hvert projekt BURDE have ud fra maalt tid.
 * Overforsyning (recommended < planned) er tavs og tilladt: en lane for meget
 * koster ingenting paa et public repo, en lane for lidt koster ventetid.
 *
 * En maaling der mangler eller ikke er et tal giver INGEN anbefaling for det
 * projekt - et halvt regnestykke maa ikke kunne saenke et laneantal. Selve den
 * manglende maaling er allerede roed i evaluateShards.
 *
 * @param {object} input
 * @param {{project: string, group: string, seconds: number}[]} input.shards
 * @param {{targetSeconds: number, projects: {project: string, shards: number}[]}} input.plan
 * @returns {{project: string, seconds: number, planned: number, recommended: number, under: boolean}[]}
 */
export function planRecommendations({ shards, plan }) {
  return plan.projects.map(({ project, shards: planned }) => {
    const own = shards.filter((s) => s.group === project);
    const measured = own.filter((s) => Number.isFinite(s.seconds));
    if (own.length === 0 || measured.length !== own.length) {
      return { project, seconds: Number.NaN, planned, recommended: planned, under: false };
    }
    const seconds = measured.reduce((sum, s) => sum + s.seconds, 0);
    const recommended = Math.max(1, Math.ceil(seconds / plan.targetSeconds));
    return { project, seconds, planned, recommended, under: recommended > planned };
  });
}

/**
 * Faelder dommen over en hel matrix-koersel.
 *
 * @param {object} input
 * @param {{project: string, group?: string, seconds: number, exitCode: number}[]} input.shards
 * @param {number} input.budgetMinutes loft pr. LANE
 * @param {string} input.shardsResult GitHub's `needs.<job>.result` for matrixen
 * @param {string[]} input.projects forventede laner
 * @param {object} [input.plan] shard-planen, hvis kaldt med --plan
 * @param {boolean} [input.enforcePlan] goer en underforsynet plan roed (kun natligt)
 * @returns {{ok: boolean, lines: string[], rows: {project: string, seconds: number, over: boolean}[], groups: object[]}}
 */
export function evaluateShards({ shards, budgetMinutes, shardsResult, projects, plan, enforcePlan = false }) {
  const lines = [];
  const budgetSeconds = Math.round(budgetMinutes * 60);
  const rows = shards
    .map((s) => ({ project: s.project, seconds: s.seconds, over: Number.isFinite(s.seconds) && s.seconds > budgetSeconds }))
    .sort((a, b) => a.project.localeCompare(b.project));
  const groups = plan
    ? planRecommendations({ shards: shards.map((s) => ({ ...s, group: s.group ?? s.project })), plan })
    : [];

  // Suiten koerte slet ikke (docs-/backend-PR eller merge-koe). `skipped`
  // taeller som groent for branch protection praecis som foer shardingen.
  if (shardsResult === "skipped") {
    lines.push("e2e-laner blev sprunget over (ingen frontend-aendringer). Intet at maale.");
    return { ok: true, lines, rows, groups: [] };
  }

  if (shardsResult === "cancelled") {
    lines.push("e2e-laner blev afbrudt (cancelled). Samle-checket kan ikke give groent lys.");
    return { ok: false, lines, rows, groups };
  }

  let ok = true;

  if (shardsResult !== "success") {
    lines.push(`Mindst en e2e-lane fejlede (matrix-resultat: ${shardsResult}). Se e2e-shard-jobbene og playwright-report-artifacten.`);
    ok = false;
  }

  for (const project of projects) {
    const row = rows.find((r) => r.project === project);
    if (!row) {
      lines.push(`Ingen tidsmaaling for lane "${project}". Gaten maa aldrig tabe sin egen maaling - tjek upload-artifact-steppet i e2e-shard-jobbet.`);
      ok = false;
      continue;
    }
    if (!Number.isFinite(row.seconds)) {
      lines.push(`Tidsmaalingen for lane "${project}" er ikke et tal. Tjek metrics-filen i artifacten.`);
      ok = false;
      continue;
    }
    if (row.over) {
      lines.push(
        `Lane "${project}" tog ${formatDuration(row.seconds)} og er over loftet paa ${budgetMinutes} min pr. lane. ` +
          "Loftet er sikkerhedsnettet mod EEN loebsk test, ikke vaekst-alarmen: er hele suiten vokset, " +
          "saa hoev laneantallet i frontend/tests/e2e/shard-plan.json (#5309).",
      );
      ok = false;
    }
  }

  const extra = rows.filter((r) => !projects.includes(r.project));
  for (const row of extra) {
    lines.push(`Ukendt lane "${row.project}" i maalingerne. Er shard-plan.json og de koerte laner ude af sync?`);
    ok = false;
  }

  for (const group of groups) {
    if (!group.under) continue;
    const message =
      `Projekt "${group.project}" brugte ${formatDuration(group.seconds)} fordelt paa ${group.planned} lane(r). ` +
      `Planen boer vaere ${group.recommended} laner: ret "shards" for ${group.project} i frontend/tests/e2e/shard-plan.json (#5309).`;
    if (enforcePlan) {
      lines.push(message);
      ok = false;
    } else {
      lines.push(`[info] ${message}`);
    }
  }

  return { ok, lines, rows, groups };
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
 * @param {object[]} [groups] plan-regnestykket pr. projekt
 * @returns {string}
 */
export function renderSummary(rows, budgetMinutes, groups = []) {
  const head = [`### Playwright-laner (loft: ${budgetMinutes} min pr. lane)`, "", "| Lane | Tid | Status |", "|---|---:|---|"];
  const body = rows.length
    ? rows.map((r) => `| ${r.project} | ${formatDuration(r.seconds)} | ${r.over ? "OVER LOFT" : "ok"} |`)
    : ["| (ingen laner koerte) | - | - |"];
  const out = [...head, ...body, ""];
  if (groups.length) {
    out.push(
      "### Shard-plan (frontend/tests/e2e/shard-plan.json)",
      "",
      "| Projekt | Samlet tid | Laner i planen | Anbefalet | Status |",
      "|---|---:|---:|---:|---|",
      ...groups.map(
        (g) => `| ${g.project} | ${formatDuration(g.seconds)} | ${g.planned} | ${g.recommended} | ${g.under ? "UNDERFORSYNET" : "ok"} |`,
      ),
      "",
    );
  }
  return out.join("\n");
}

/**
 * `--emit-github-output`: skriver matrixen paa GITHUB_OUTPUT-form, saa
 * plan-jobbet kan pipe den direkte videre. Holder plan-formatet EET sted.
 *
 * @param {object} plan
 * @returns {string}
 */
export function renderGithubOutput(plan) {
  const lanes = expandPlan(plan);
  return [
    `matrix=${JSON.stringify(lanes)}`,
    `keys=${lanes.map((l) => l.key).join(",")}`,
    `ceiling-minutes=${plan.ceilingSeconds / 60}`,
  ].join("\n");
}

function main(argv) {
  const args = parseArgs(argv);
  const plan = args.plan ? readPlan(args.plan) : null;

  if (args["emit-github-output"]) {
    if (!plan) {
      console.error("--emit-github-output kraever --plan <fil>");
      return 1;
    }
    console.log(renderGithubOutput(plan));
    return 0;
  }

  const dir = args.dir || "e2e-shard-metrics";
  const budgetMinutes = args["budget-minutes"]
    ? Number(args["budget-minutes"])
    : plan
      ? plan.ceilingSeconds / 60
      : 12;
  const shardsResult = args["shards-result"] || "success";
  const projects = args.projects
    ? args.projects.split(",").map((p) => p.trim()).filter(Boolean)
    : plan
      ? expandPlan(plan).map((l) => l.key)
      : ["desktop-chromium", "mobile-chromium", "mobile-webkit"];

  const shards = readShardMetrics(dir);
  const { ok, lines, rows, groups } = evaluateShards({
    shards,
    budgetMinutes,
    shardsResult,
    projects,
    plan,
    enforcePlan: args["enforce-plan"] === "true",
  });

  const summary = renderSummary(rows, budgetMinutes, groups);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    } catch {
      // Summary er kosmetik; den maa aldrig vaelte selve gaten.
    }
  }

  for (const line of lines) {
    if (ok || line.startsWith("[info]")) console.log(`   ${line}`);
    else console.error(`::error::${line}`);
  }

  if (!ok) {
    console.error("\nfrontend-smoke er ROEDT: se linjerne ovenfor.");
    return 1;
  }
  console.log("\nfrontend-smoke er GROENT: alle laner inden for loftet.");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}

export const __testables = { main, ROOT: fileURLToPath(new URL(".", import.meta.url)) };
