#!/usr/bin/env node
// scripts/generate-status-board.mjs
// ============================================================
// Genererer docs/STATUS_BOARD.md — én tavle for "hvad er naeste" (#5674).
//
// FEJLKLASSEN: statustavlen ("Cycling Zone - Masterplan") blev skrevet i
// haanden ved close-out. Den drev, fordi ingen kilde tvang den i sync med
// GitHub - en lukket PR eller et flippet issue efterlod tavlen som loegn i
// timer/dage, ligesom FEATURE_STATUS.md gjorde det foer #4921.
//
// Loesningen er samme moenster: state AFLEDES af GitHub (aabne PR'er, labels)
// + FEATURE_REGISTRY.yml, aldrig FORTALT. Ingen ny dependency: parseren for
// registrets flade skema genbruges fra generate-feature-status.mjs, og
// GitHub-kald ligger bag et io-parameter (samme moenster som
// scripts/wave-policy.mjs's `readPrs = getOpenPrs`), saa hele renderingen er
// testbar uden netvaerk.
//
// Brug:
//   node scripts/generate-status-board.mjs           # skriv docs/STATUS_BOARD.md
//   node scripts/generate-status-board.mjs --check    # exit 1 hvis committet != genereret
//
// Refs #5674.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { STATES, REGISTRY_PATH, parseRegistry, validate } from "./generate-feature-status.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const OUTPUT_PATH = join(ROOT, "docs", "STATUS_BOARD.md");
export const REPO = "NicolaiDolmer/CyclingZone";

// Samme approksimation som generate-feature-status.mjs / check-agent-token-hygiene.ps1:
// CRLF normaliseres til LF foer optaelling, tokens ~= tegn / 4 rundet op.
export const TOKEN_BUDGET_WARN = 2200;
export const TOKEN_BUDGET_FAIL = 2500;

export function approxTokens(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  return Math.ceil(normalized.length / 4);
}

const LABELS_FOR_ISSUES = ["claude:todo", "claude:done", "needs-decision", "needs-design"];

// ---------------------------------------------------------------- io (GitHub calls)
// Alt netvaerk bag disse to funktioner, saa render()/generate() kan testes med
// fixtures. body er MED (udover brief'ets liste for pr list), fordi sektion 2
// eksplicit kraever at laese "ejer-go" i PR-body - én ekstra felt i samme kald,
// ingen ekstra roundtrip.
export function getOpenPrs() {
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        REPO,
        "--state",
        "open",
        "--json",
        "number,title,isDraft,labels,mergeStateStatus,statusCheckRollup,headRefName,updatedAt,body",
        "--limit",
        "500",
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    ),
  );
}

export function getIssuesByLabel(label) {
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--repo",
        REPO,
        "--state",
        "open",
        "--label",
        label,
        "--json",
        "number,title,labels,createdAt,updatedAt",
        "--limit",
        "1000",
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    ),
  );
}

export const defaultIo = { getOpenPrs, getIssuesByLabel };

// ---------------------------------------------------------------- rene helpers

/**
 * @param {string} iso
 * @param {number} now epoch ms
 * @returns {number|null} heltal dage, aldrig negativ; null hvis dato er ugyldig
 */
export function ageDays(iso, now) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / 86400000));
}

/**
 * @param {string} title
 * @param {number} max
 * @returns {string} titel afkortet til maks `max` tegn (ellipse taeller med)
 */
export function truncateTitle(title, max = 90) {
  const t = String(title ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Issue-numre en PR refererer: "#N" i titel/body, plus det foerste tal i
 * branch-navnet (repoets konvention er "<type>/<issue>-<slug>", jf.
 * scripts/wave-policy.mjs's slug-haandtering).
 *
 * @param {{title?: string, body?: string, headRefName?: string}} pr
 * @returns {Set<number>}
 */
export function extractIssueRefs(pr) {
  const refs = new Set();
  const hashRe = /#(\d+)/g;
  for (const text of [pr?.title, pr?.body]) {
    if (!text) continue;
    let m;
    while ((m = hashRe.exec(text)) !== null) refs.add(Number(m[1]));
  }
  const branchMatch = /(\d{3,6})/.exec(pr?.headRefName ?? "");
  if (branchMatch) refs.add(Number(branchMatch[1]));
  return refs;
}

/**
 * Klassificerer en PR til de tre tilstande brief'et beder om ("groen/roed
 * CI"). `mergeStateStatus` bruges KUN til at fange en aegte merge-konflikt
 * (DIRTY) - feltet er ELLERS ubrugeligt til groen/roed her, fordi dette repo
 * kraever review + merger med --admin (#4919): BLOCKED er derfor
 * NORMALTILSTANDEN for en ikke-draft PR uanset CI (jf.
 * docs/audits/night-wave-2026-08-06.md #5 og scripts/weekly-steering-report.mjs's
 * classifyPr()), saa "mergeStateStatus === CLEAN" alene gjorde ALLE reelle
 * PR'er roede her - ogsaa dem med 0 fejlede checks. Groen/roed afgoeres i
 * stedet af `statusCheckRollup` (samme felt som `gh pr checks`).
 *
 * @param {{mergeStateStatus?: string, statusCheckRollup?: Array<{conclusion?: string, state?: string}>}} pr
 * @returns {"green"|"dirty"|"red"}
 */
export function classifyMergeState(pr) {
  if (String(pr?.mergeStateStatus ?? "").toUpperCase() === "DIRTY") return "dirty";
  const checks = Array.isArray(pr?.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failing = checks.some((c) => {
    const conclusion = String(c?.conclusion ?? "").toUpperCase();
    const state = String(c?.state ?? "").toUpperCase();
    return conclusion === "FAILURE" || conclusion === "ERROR" || state === "FAILURE" || state === "ERROR";
  });
  return failing ? "red" : "green";
}

const stateLabel = { green: "groen", dirty: "DIRTY", red: "roed" };

/**
 * Matcher literal "ejer-go" (label eller body) med ordgraense i begge ender,
 * saa fx "ejer-godkendelse"/"ejer-godkendt" ikke taeller med (bidt: gav
 * falske positiver i sektion 2's "venter paa ejer-go"-liste).
 *
 * @param {{labels?: Array<{name?: string}|string>, body?: string}} pr
 * @returns {boolean}
 */
export function hasOwnerGoSignal(pr) {
  const needle = /\bejer-go\b/i;
  const names = (pr?.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name ?? ""));
  if (names.some((n) => needle.test(n))) return true;
  return needle.test(pr?.body ?? "");
}

const PRIORITY_ORDER = ["priority:high", "priority:med", "priority:low"];

/**
 * @param {Array<{name?: string}|string>|undefined} labels
 * @returns {number} 0 (high) .. 3 (ingen priority-label)
 */
export function priorityRank(labels) {
  const names = new Set((labels ?? []).map((l) => (typeof l === "string" ? l : l?.name ?? "")));
  const idx = PRIORITY_ORDER.findIndex((p) => names.has(p));
  return idx === -1 ? PRIORITY_ORDER.length : idx;
}

/**
 * Klipper en liste af faerdige raekker til `max` og tilfoejer "...og N mere"
 * hvis der er flere. Token-budgettet haandhaeves ved at kalde denne funktion
 * med en gradvist mindre `max` (se `renderWithinBudget`), ikke ved at gaette
 * et fast tal en gang for alle.
 *
 * @param {string[]} rows
 * @param {number} max
 * @returns {string[]}
 */
export function capList(rows, max) {
  if (rows.length <= max) return rows;
  const shown = rows.slice(0, Math.max(0, max));
  const more = rows.length - shown.length;
  shown.push(`- …og ${more} mere`);
  return shown;
}

function bulletOrNone(rows) {
  return rows.length > 0 ? rows : ["- ingen"];
}

// ---------------------------------------------------------------- sektioner

function prRow(pr, now) {
  const age = ageDays(pr.updatedAt, now);
  const ageText = age === null ? "?" : `${age}d`;
  const state = stateLabel[classifyMergeState(pr)];
  return `- #${pr.number} ${truncateTitle(pr.title)} (${ageText}) — ${state}`;
}

function issueRow(issue, now) {
  const age = ageDays(issue.createdAt, now);
  const ageText = age === null ? "?" : `${age}d`;
  return `- #${issue.number} ${truncateTitle(issue.title)} (${ageText})`;
}

/**
 * Bygger de fem sektioners raekker (ukappede), plus registret-summary-linjen.
 * Ren funktion: ingen IO, kun data ind.
 *
 * @param {object} data
 * @param {Array<Record<string,string>>} data.registryEntries valideret registret (kan vaere tom)
 * @param {Array} data.prs aabne PR'er
 * @param {Record<string, Array>} data.issuesByLabel {label: issues[]}
 * @param {number} data.now epoch ms
 */
export function buildSections({ registryEntries, prs, issuesByLabel, now }) {
  const nonDraftPrs = prs.filter((p) => !p.isDraft);
  const draftPrs = prs.filter((p) => p.isDraft);

  // Sektion 1: hele koeen, aeldste aktivitet foerst (mest stale foerst).
  const queueRows = [...nonDraftPrs]
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .map((p) => prRow(p, now));

  // Sektion 2: needs-decision/needs-design issues + PR'er der venter paa "ejer-go".
  const decisionIssuesMap = new Map();
  for (const label of ["needs-decision", "needs-design"]) {
    for (const issue of issuesByLabel[label] ?? []) decisionIssuesMap.set(issue.number, issue);
  }
  const decisionIssueRows = [...decisionIssuesMap.values()]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((i) => issueRow(i, now));
  const ownerGoPrRows = prs
    .filter((p) => hasOwnerGoSignal(p))
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .map((p) => prRow(p, now));

  // Sektion 3: draft-PR'er + PR'er (ikke-draft) med "roed" tilstand.
  const draftRows = [...draftPrs]
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .map((p) => prRow(p, now));
  const redRows = nonDraftPrs
    .filter((p) => classifyMergeState(p) === "red")
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .map((p) => prRow(p, now));

  // Sektion 4: claude:todo issues UDEN en aaben PR, sorteret efter priority-label saa alder.
  const referencedIssueNumbers = new Set();
  for (const pr of prs) for (const n of extractIssueRefs(pr)) referencedIssueNumbers.add(n);
  const notBuiltRows = (issuesByLabel["claude:todo"] ?? [])
    .filter((issue) => !referencedIssueNumbers.has(issue.number))
    .sort((a, b) => {
      const rankDiff = priorityRank(a.labels) - priorityRank(b.labels);
      if (rankDiff !== 0) return rankDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
    .map((i) => issueRow(i, now));

  // Sektion 5: claude:done issues der stadig staar aabne (skal lukkes).
  const doneRows = [...(issuesByLabel["claude:done"] ?? [])]
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .map((i) => issueRow(i, now));

  const validEntries = Array.isArray(registryEntries) ? registryEntries : [];
  const byState = new Map(STATES.map((s) => [s, 0]));
  for (const e of validEntries) if (byState.has(e.state)) byState.set(e.state, byState.get(e.state) + 1);
  const registrySummary =
    validEntries.length > 0
      ? `${validEntries.length} features i FEATURE_REGISTRY.yml: ${STATES.filter((s) => byState.get(s) > 0)
          .map((s) => `${s} ${byState.get(s)}`)
          .join(" · ")}.`
      : "FEATURE_REGISTRY.yml kunne ikke laeses — se advarsel ovenfor.";

  return {
    registrySummary,
    queueRows,
    decisionIssueRows,
    ownerGoPrRows,
    draftRows,
    redRows,
    notBuiltRows,
    doneRows,
  };
}

const HEADER = [
  "# STATUS BOARD",
  "",
  "> **GENERERET FIL - rediger den ALDRIG i haanden.**",
  "> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)",
  "> Regenerér: `node scripts/generate-status-board.mjs`",
  "",
];

/**
 * @param {ReturnType<typeof buildSections>} sections
 * @param {number} cap maks synlige raekker pr. sektion foer "...og N mere"
 * @returns {string} markdown
 */
export function render(sections, cap) {
  const out = [...HEADER];
  out.push(sections.registrySummary);
  out.push("");

  out.push("## 1) Lige nu (merge-koe)");
  out.push("Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - \"roed\" er en fejlet check. \"DIRTY\" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).");
  out.push("");
  out.push(...capList(bulletOrNone(sections.queueRows), cap));
  out.push("");

  out.push("## 2) Ejerens beslutninger");
  out.push("**Issues (`needs-decision` / `needs-design`):**");
  out.push("");
  out.push(...capList(bulletOrNone(sections.decisionIssueRows), cap));
  out.push("");
  out.push("**PR'er der venter paa \"ejer-go\" (label eller PR-body):**");
  out.push("");
  out.push(...capList(bulletOrNone(sections.ownerGoPrRows), cap));
  out.push("");

  out.push("## 3) Bygget men ikke merget");
  out.push("**Draft-PR'er:**");
  out.push("");
  out.push(...capList(bulletOrNone(sections.draftRows), cap));
  out.push("");
  out.push("**Ikke-draft med roed tilstand:**");
  out.push("");
  out.push(...capList(bulletOrNone(sections.redRows), cap));
  out.push("");

  out.push("## 4) Ikke bygget");
  out.push("`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.");
  out.push("");
  out.push(...capList(bulletOrNone(sections.notBuiltRows), cap));
  out.push("");

  out.push("## 5) Faerdigt");
  out.push("`claude:done` men stadig aabne — skal lukkes.");
  out.push("");
  out.push(...capList(bulletOrNone(sections.doneRows), cap));
  out.push("");

  return `${out.join("\n").trimEnd()}\n`;
}

// Starter generoest og skruer ned indtil filen er inden for budgettet, eller
// loftet ikke kan skrumpe mere (bunden er stadig valid markdown - en meget
// lang bagkatalog-liste kan da stadig overskride budgettet, hvilket meldes
// tydeligt i stedet for at blive skjult).
const CAP_START = 15;
const CAP_FLOOR = 3;
const CAP_STEP = 3;

export function renderWithinBudget(sections) {
  let cap = CAP_START;
  let markdown = render(sections, cap);
  while (approxTokens(markdown) > TOKEN_BUDGET_FAIL && cap > CAP_FLOOR) {
    cap = Math.max(CAP_FLOOR, cap - CAP_STEP);
    markdown = render(sections, cap);
  }
  return markdown;
}

function readRegistryEntries() {
  try {
    const source = readFileSync(REGISTRY_PATH, "utf8");
    const entries = parseRegistry(source);
    const errors = validate(entries);
    if (errors.length > 0) {
      console.error(`ADVARSEL: FEATURE_REGISTRY.yml er ugyldig (${errors.length} fejl) - registry-summary udelades.`);
      return [];
    }
    return entries;
  } catch (err) {
    console.error(`ADVARSEL: kunne ikke laese FEATURE_REGISTRY.yml (${err.message}) - registry-summary udelades.`);
    return [];
  }
}

export async function generate(io = defaultIo, now = Date.now()) {
  const registryEntries = readRegistryEntries();
  const prs = await io.getOpenPrs();
  if (!Array.isArray(prs)) throw new Error("gh pr list gav ikke en liste - status-board blokeret");

  const issuesByLabel = {};
  for (const label of LABELS_FOR_ISSUES) {
    const issues = await io.getIssuesByLabel(label);
    if (!Array.isArray(issues)) throw new Error(`gh issue list --label ${label} gav ikke en liste - status-board blokeret`);
    issuesByLabel[label] = issues;
  }

  const sections = buildSections({ registryEntries, prs, issuesByLabel, now });
  return renderWithinBudget(sections);
}

async function main() {
  const check = process.argv.includes("--check");
  let markdown;
  try {
    markdown = await generate();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const tokens = approxTokens(markdown);
  const budgetNote =
    tokens > TOKEN_BUDGET_WARN
      ? ` (WARN: ${tokens}/${TOKEN_BUDGET_FAIL} approx tokens - naermer sig loftet)`
      : ` (${tokens}/${TOKEN_BUDGET_FAIL} approx tokens)`;

  if (!check) {
    writeFileSync(OUTPUT_PATH, markdown, "utf8");
    console.log(`Skrev ${OUTPUT_PATH.replace(ROOT, "").replace(/^[\\/]/, "")}${budgetNote}`);
    return;
  }

  let committed;
  try {
    committed = readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    console.error("docs/STATUS_BOARD.md findes ikke. Koer: node scripts/generate-status-board.mjs");
    process.exit(1);
  }
  if (committed.replace(/\r\n/g, "\n") !== markdown.replace(/\r\n/g, "\n")) {
    console.error("docs/STATUS_BOARD.md er IKKE i sync med GitHub/registret lige nu (forventet - den er live-afledt).");
    console.error("Fix: node scripts/generate-status-board.mjs && git add docs/STATUS_BOARD.md");
    process.exit(1);
  }
  console.log("docs/STATUS_BOARD.md er i sync.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
