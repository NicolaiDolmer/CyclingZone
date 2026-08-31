#!/usr/bin/env node
// scripts/check-required-ci-jobs.mjs
// ============================================================
// Required-check forward-guard — #4330.
//
// FEJLKLASSEN: en workflow-refaktor fjerner eller omdøber et job hvis navn
// står som required status check på main. GitHub venter så i al evighed på et
// check der aldrig rapporterer — merge-køen er død, og INTET kan merges. Det
// er ikke en teoretisk risiko: #4330's oprindelige forslag (saml de 15
// statiske guards i én matrix) ville have slettet NI required check-navne på
// én gang. Ingen test i repoet ville have fanget det; symptomet dukker først
// op på den næste PR, som en evigt "Expected"-check.
//
// Denne guard opløser hvert navn i scripts/ci-required-checks.json mod de
// jobs .github/workflows/*.yml faktisk producerer, og fejler hvis
//   (a) navnet ikke længere produceres af noget job,
//   (b) det producerende job har fået en `name:`-override der ikke matcher
//       (check-navnet er jobbets DISPLAY-navn, ikke dets nøgle),
//   (c) det producerende job har fået en `strategy:` (en matrix suffikser
//       check-navnet med "(<værdi>)" og bryder dermed referencen),
//   (d) navnet er dynamisk (`${{ ... }}`) og altså ikke længere stabilt, eller
//   (e) INGEN af de workflows der producerer navnet kører på `pull_request`.
//       Et required job der flyttes til en push-/schedule-only workflow ser
//       fint ud i YAML'en, men rapporterer aldrig et check på en PR — præcis
//       samme dødvande som et slettet job. Derfor læses `on:`-triggeren, ikke
//       kun `jobs:`.
//
// Statisk: læser kun committede filer, ingen GitHub-API-kald i CI (se
// --verify-against-github nedenfor for den manuelle, netværksbaserede
// kontrol). Sandheden om required checks er stadig branch protection;
// scripts/ci-required-checks.json er et MANUELT spejl — intet i CI opdager
// at ejeren har ændret listen i repo-indstillingerne. Derfor står der en
// `capturedAt` i filen, og derfor findes --verify-against-github.
//
// Brug:
//   node scripts/check-required-ci-jobs.mjs
//   node scripts/check-required-ci-jobs.mjs --verify-against-github   (manuel)
//
// Refs #4330.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");
const CONTRACT_FILE = join(ROOT, "scripts", "ci-required-checks.json");

// Kun aktive workflow-filer. `.disabled` og `.example` producerer ingen checks.
const WORKFLOW_FILE_RE = /\.ya?ml$/;

/**
 * Parser et workflow-YAML til de check-navne dets jobs producerer.
 * Bevidst regex-baseret (samme idiom som repoets øvrige statiske guards) —
 * roden har ingen YAML-parser som dependency, og formen vi skal kende er
 * flad: top-level `jobs:` → 2-space job-nøgler → 4-space job-felter.
 *
 * @param {string} source rå YAML
 * @returns {Array<{key: string, checkName: string, hasStrategy: boolean, dynamicName: boolean}>}
 */
export function parseJobs(source) {
  const lines = source.split(/\r?\n/);
  const jobs = [];
  let inJobs = false;
  let current = null;

  const flush = () => {
    if (current) jobs.push(current);
    current = null;
  };

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;

    // Et nyt top-level nøgle (kolonne 0, ikke en kommentar) afslutter jobs-blokken.
    if (/^[A-Za-z_]/.test(line)) {
      flush();
      inJobs = false;
      continue;
    }

    const jobKey = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobKey) {
      flush();
      current = { key: jobKey[1], checkName: jobKey[1], hasStrategy: false, dynamicName: false };
      continue;
    }
    if (!current) continue;

    const nameOverride = line.match(/^ {4}name:\s*(.+?)\s*$/);
    if (nameOverride) {
      const raw = nameOverride[1].replace(/^["'](.*)["']$/, "$1");
      current.checkName = raw;
      current.dynamicName = raw.includes("${{");
      continue;
    }
    if (/^ {4}strategy:\s*$/.test(line)) {
      current.hasStrategy = true;
    }
  }
  flush();

  return jobs;
}

/**
 * Parser et workflow-YAML til navnene på dets `on:`-triggers.
 * Understøtter begge former GitHub tillader:
 *   `on: [push, pull_request]`  og  blok-formen med 2-space nøgler.
 * Navnene matches EKSAKT — `pull_request_target` og
 * `pull_request_review_comment` er ANDRE events og tæller ikke som
 * `pull_request`.
 *
 * @param {string} source rå YAML
 * @returns {string[]} trigger-navne
 */
export function parseTriggers(source) {
  const lines = source.split(/\r?\n/);
  const triggers = new Set();
  let inOn = false;

  for (const line of lines) {
    // Inline-form: `on: [push, pull_request]` eller `on: push`.
    const inline = line.match(/^on:\s*(\S.*?)\s*$/);
    if (inline) {
      const raw = inline[1].replace(/^\[(.*)\]$/, "$1");
      for (const part of raw.split(",")) {
        const name = part.trim().replace(/^["'](.*)["']$/, "$1");
        if (/^[a-z_]+$/.test(name)) triggers.add(name);
      }
      continue;
    }
    if (/^on:\s*$/.test(line)) {
      inOn = true;
      continue;
    }
    if (!inOn) continue;

    // Kommentar-/tomme linjer bryder ikke blokken.
    if (/^\s*(#.*)?$/.test(line)) continue;
    // Et nyt top-level nøgle (kolonne 0) afslutter on-blokken.
    if (/^[A-Za-z_]/.test(line)) {
      inOn = false;
      continue;
    }

    const key = line.match(/^ {2}([a-z_]+):/);
    if (key) triggers.add(key[1]);
  }

  return [...triggers];
}

/**
 * Opløser hvert required check-navn mod de jobs workflow-filerne producerer.
 *
 * `triggers` er valgfri pr. workflow: er den udeladt (kun i unit-tests der
 * isolerer job-opløsningen), springes pull_request-kontrollen over.
 * loadWorkflows() sætter den altid.
 *
 * @param {string[]} contexts required status check contexts
 * @param {Array<{file: string, jobs: ReturnType<typeof parseJobs>, triggers?: string[]}>} workflows
 * @returns {{context: string, reason: string}[]} tomt array = alt opløst
 */
export function findBrokenContexts(contexts, workflows) {
  const broken = [];

  for (const context of contexts) {
    const producers = [];
    for (const { file, jobs, triggers } of workflows) {
      for (const job of jobs) {
        if (job.checkName === context) producers.push({ file, job, triggers });
      }
    }

    if (producers.length === 0) {
      // Findes jobbet stadig under sin nøgle, men med et andet display-navn?
      const renamed = workflows
        .flatMap(({ file, jobs }) => jobs.map((job) => ({ file, job })))
        .find(({ job }) => job.key === context && job.checkName !== context);
      broken.push({
        context,
        reason: renamed
          ? `jobbet findes stadig i ${renamed.file}, men rapporterer nu som "${renamed.job.checkName}" (name:-override)`
          : "intet job i .github/workflows/ producerer dette check-navn længere",
      });
      continue;
    }

    // Et required check skal kunne rapportere PÅ EN PR. Har vi triggere for
    // mindst én producent, og kører INGEN af dem på `pull_request`, er
    // resultatet det samme dødvande som et slettet job: branch protection
    // venter for evigt. Nok at ÉN producent kører på pull_request — det er
    // netop mønstret bag perf-gate (lighthouse-ci.yml er paths-filtreret,
    // lighthouse-ci-skip-stub.yml dækker resten med samme job-navn).
    const withTriggers = producers.filter((p) => Array.isArray(p.triggers));
    if (withTriggers.length && !withTriggers.some((p) => p.triggers.includes("pull_request"))) {
      broken.push({
        context,
        reason: `ingen af de producerende workflows kører på pull_request (${withTriggers
          .map((p) => `${p.file}: on: ${p.triggers.join(", ") || "<ingen>"}`)
          .join("; ")}) — checket rapporterer aldrig på en PR`,
      });
    }

    for (const { file, job } of producers) {
      if (job.hasStrategy) {
        broken.push({
          context,
          reason: `${file}: jobbet har en strategy/matrix — GitHub suffikser check-navnet med "(<matrix-værdi>)", så "${context}" rapporterer aldrig`,
        });
      }
      if (job.dynamicName) {
        broken.push({
          context,
          reason: `${file}: jobbets name: er dynamisk (\${{ ... }}) og dermed ikke et stabilt check-navn`,
        });
      }
    }
  }

  return broken;
}

export function loadWorkflows(dir = WORKFLOW_DIR) {
  return readdirSync(dir)
    .filter((f) => WORKFLOW_FILE_RE.test(f))
    .sort()
    .map((f) => {
      const source = readFileSync(join(dir, f), "utf8");
      return { file: `.github/workflows/${f}`, jobs: parseJobs(source), triggers: parseTriggers(source) };
    });
}

/**
 * ADVISORY, ikke en gate: required checks skal også rapportere på
 * merge-group-SHA'en, ellers timer merge-køen ud. Det er en anden fejlklasse
 * end (e) — køen bruges ikke på hver PR, så vi advarer i stedet for at fejle.
 *
 * @param {string[]} contexts
 * @param {ReturnType<typeof loadWorkflows>} workflows
 * @returns {{context: string, files: string[]}[]}
 */
export function findMergeGroupGaps(contexts, workflows) {
  const gaps = [];
  for (const context of contexts) {
    const producers = workflows.filter((w) => w.jobs.some((j) => j.checkName === context));
    if (!producers.length) continue;
    if (producers.some((w) => w.triggers.includes("merge_group"))) continue;
    gaps.push({ context, files: producers.map((w) => w.file) });
  }
  return gaps;
}

/**
 * MANUEL drift-kontrol (kræver netværk + `gh` med repo-admin-scope, og kører
 * derfor ALDRIG i CI): henter main's faktiske required contexts fra branch
 * protection og diff'er dem mod kontrakt-filen. Uden den er spejlet
 * selvbekræftende — den statiske guard holder to lister op mod hinanden der
 * begge stammer fra den committede JSON, så en ændring ejeren laver i
 * repo-indstillingerne er usynlig for CI.
 *
 * @param {string[]} contexts contexts fra kontrakt-filen
 * @returns {number} exit-kode
 */
function verifyAgainstGitHub(contexts) {
  let live;
  try {
    const raw = execFileSync(
      "gh",
      [
        "api",
        "repos/NicolaiDolmer/CyclingZone/branches/main/protection",
        "--jq",
        ".required_status_checks.contexts",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    live = JSON.parse(raw);
  } catch (err) {
    console.error(`\n❌ Kunne ikke hente branch protection fra GitHub: ${err.message.trim()}`);
    console.error("   Kræver `gh auth login` med admin-adgang til repoet. Tilstanden er manuel og kører aldrig i CI.");
    return 1;
  }

  const missing = live.filter((c) => !contexts.includes(c));
  const extra = contexts.filter((c) => !live.includes(c));
  if (!missing.length && !extra.length) {
    console.log(`\n✅ ci-required-checks.json er i sync med main's branch protection (${live.length} contexts).`);
    console.log('   Husk at sætte "capturedAt" til dagens dato hvis du opdaterer filen.');
    return 0;
  }

  console.error("\n❌ ci-required-checks.json er DRIFTET fra main's branch protection:");
  for (const c of missing) console.error(`   - "${c}" er required på GitHub, men mangler i kontrakt-filen`);
  for (const c of extra) console.error(`   - "${c}" står i kontrakt-filen, men er IKKE required på GitHub`);
  console.error("\nRet listen i scripts/ci-required-checks.json og opdatér capturedAt. Refs #4330.");
  return 1;
}

function main() {
  const contract = JSON.parse(readFileSync(CONTRACT_FILE, "utf8"));
  const contexts = contract.contexts ?? [];

  if (process.argv.includes("--verify-against-github")) {
    process.exit(verifyAgainstGitHub(contexts));
  }

  const workflows = loadWorkflows();
  const broken = findBrokenContexts(contexts, workflows);

  if (broken.length) {
    console.error(`\n❌ ${broken.length} required status check(s) produceres ikke længere af .github/workflows/:`);
    for (const { context, reason } of broken) console.error(`   - ${context}: ${reason}`);
    console.error(`
Konsekvens hvis dette merges: branch protection venter på et check der aldrig
rapporterer. Merge-køen på main dør, og intet kan merges før ejeren retter
required-listen manuelt i repo-indstillingerne.

Fix (vælg én):
  - Behold jobbets navn præcis som før (billigst, ingen ejer-handling).
  - Eller: skriv TYDELIGT øverst i PR-body hvilket navn der skifter, og få
    ejeren til at opdatere required checks i branch protection i SAMME
    tidsrum som merge. Opdatér derefter scripts/ci-required-checks.json.
Refresh af spejlet:
  gh api repos/NicolaiDolmer/CyclingZone/branches/main/protection --jq '.required_status_checks.contexts'
Refs #4330.`);
    process.exit(1);
  }

  const gaps = findMergeGroupGaps(contexts, workflows);
  if (gaps.length) {
    console.warn(`\n⚠️  ${gaps.length} required check(s) har ingen merge_group-trigger (advisory, blokerer ikke):`);
    for (const { context, files } of gaps) console.warn(`   - ${context} (${files.join(", ")})`);
    console.warn("   Konsekvens: bruges GitHubs merge queue, timer køen ud på disse checks.");
  }

  console.log(`\n✅ required-ci-jobs: alle ${contexts.length} required check-navne opløses til et job i .github/workflows/ der kører på pull_request (${workflows.length} workflow-filer scannet).`);
  console.log(
    `   Spejlet er MANUELT (capturedAt: ${contract.capturedAt ?? "<ukendt>"}). Drift mod GitHub fanges kun af: node scripts/check-required-ci-jobs.mjs --verify-against-github`,
  );
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
