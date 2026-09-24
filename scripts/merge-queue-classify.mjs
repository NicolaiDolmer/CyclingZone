#!/usr/bin/env node
// #5508 · Klassifikator for de staaende merge-regler (AGENTS.md hard rule 35,
// ejer 22/9 + 24/9). KUN information: scripts/merge-queue.ps1 printer kategorien
// i oversigten, og merge-adfaerden aendres ikke af den.
//
// Kategorier (maa merges uden ejerens ordrette "merge" naar CI er groen, et
// uafhaengigt read-only diff-tjek er rent og CodeRabbit ikke har blokerende fund):
//   (a) brand-fejlrettelse uden ny spillertekst, hvor fejlen og effekten er
//       maalt i prod foer og efter
//   (b) motor-PR bag slukket race_engine_v4 (kun backend/lib/engine/v4);
//       #5580/#5581 (indsats/realisme-gate med ejerens maaltal) er undtaget
//   (c) Dependabot patch/minor · docs uden spillertekst · CI/hooks/test-only
// Alt andet: "kraever ejer-go" med den foerste grund (UI, spillertekst,
// spillervendte tal, migrationer, flag-flips, prod-skrivninger).
//
// Input er labels + filstier + titel + body (+ author). Alt herunder er rent;
// gh-kaldet ligger kun i main() nederst.
//
//   node scripts/merge-queue-classify.mjs --pr 5654 [--repo owner/name] [--json]
//   node scripts/merge-queue-classify.mjs --input pr.json [--json]   # uden gh
//
// Tests: node --test scripts/merge-queue-classify.test.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "NicolaiDolmer/CyclingZone";

export const CATEGORY = Object.freeze({
  A_BRAND_FIX: "a",
  B_ENGINE_V4: "b",
  C_SAFE: "c",
  OWNER: "ejer-go",
});

export const CATEGORY_LABEL = Object.freeze({
  a: "(a) brand-fejlrettelse uden ny spillertekst",
  b: "(b) motor bag slukket race_engine_v4",
  c: "(c) Dependabot/docs/CI-hooks-test",
  "ejer-go": "kraever ejer-go",
});

/** PR'er hard rule 35 (b) eksplicit undtager: ejerens realisme-maaltal. */
export const ENGINE_EXCEPTION_ISSUES = Object.freeze([5580, 5581]);

// ── Filsti-klasser ─────────────────────────────────────────────────────────

const TEST_FILE_RE = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|(^|\/)tests?\/|\/e2e\//;
const DOCS_RE = /^(docs\/|\.claude\/learnings\/|[^/]+\.md$|superpowers\/)/i;
const CI_HOOKS_RE = /^(\.github\/|scripts\/hooks\/|\.githooks\/|\.coderabbit\.yaml$|\.pre-commit-config\.yaml$)/;
const ENGINE_V4_RE = /^backend\/lib\/engine\/v4\//;
const MIGRATION_RE = /^database\/.*\.sql$/i;
const LOCKFILE_RE = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const FRONTEND_UI_RE = /^frontend\/(src|index\.html|public\/(?!locales\/))/;
const PLAYER_TEXT_RE = /^(frontend\/public\/locales\/|backend\/locales\/|frontend\/src\/data\/patchNotes\.js$|frontend\/src\/pages\/(PatchNotesPage|PrivacyPolicyPage|TermsPage|TermsPageEn)\.jsx$|frontend\/index\.html$|docs\/TONE_OF_VOICE\.md$)/;
const PLAYER_NUMBER_FILE_RE = /^backend\/lib\/(economy|salary|prize|sponsor|training|dailyTraining|raceDayYield|riderProgression|riderCondition|weights\/|balance)/i;
const FLAG_FLIP_RE = /(flip|taend|tænd|slaa .* til|slå .* til|enable|turn(s|ed)? on)\b/i;
const FLAG_FILE_RE = /(app_config|feature[-_ ]?flag|stageFlagCatalog)/i;
const PROD_WRITE_RE = /(^|\s)(--execute|--apply)(\s|$)|\b(OWNER_GO=1|backfill|prod-skrivning|prod write)\b/i;

export const isTestFile = (p) => TEST_FILE_RE.test(p);
export const isDocsFile = (p) => DOCS_RE.test(p);
export const isCiOrHooksFile = (p) => CI_HOOKS_RE.test(p);
export const isEngineV4File = (p) => ENGINE_V4_RE.test(p);
export const isMigrationFile = (p) => MIGRATION_RE.test(p);
export const isPlayerTextFile = (p) => PLAYER_TEXT_RE.test(p);
export const isFrontendUiFile = (p) => FRONTEND_UI_RE.test(p) && !isTestFile(p) && !isPlayerTextFile(p);
export const isLockfile = (p) => LOCKFILE_RE.test(p);
export const isPlayerNumberFile = (p) => PLAYER_NUMBER_FILE_RE.test(p) && !isTestFile(p);

// ── Hjaelpere ──────────────────────────────────────────────────────────────

function labelNames(labels) {
  return (labels ?? []).map((l) => (typeof l === "string" ? l : l?.name ?? "")).map((s) => s.toLowerCase()).filter(Boolean);
}

function filePaths(files) {
  return (files ?? []).map((f) => (typeof f === "string" ? f : f?.path ?? f?.filename ?? "")).filter(Boolean);
}

function authorLogin(author) {
  if (!author) return "";
  return String(typeof author === "string" ? author : author.login ?? "").toLowerCase();
}

function issueRefs(text) {
  return [...String(text ?? "").matchAll(/#(\d{3,5})\b/g)].map((m) => Number(m[1]));
}

/** Dependabot-titel: "chore(deps): bump x from 1.2.3 to 1.3.0" -> patch/minor/major/null. */
export function semverBumpKind(title) {
  const m = /from\s+v?(\d+)\.(\d+)\.(\d+)[^\s]*\s+to\s+v?(\d+)\.(\d+)\.(\d+)/i.exec(String(title ?? ""));
  if (!m) return null;
  const [fromMajor, fromMinor] = [Number(m[1]), Number(m[2])];
  const [toMajor, toMinor] = [Number(m[4]), Number(m[5])];
  if (toMajor !== fromMajor) return "major";
  if (toMinor !== fromMinor) return "minor";
  return "patch";
}

/** "maalt i prod foer og efter": body naevner en prod-maaling (hard rule 35 (a)). */
export function hasProdMeasurement(body) {
  return /(m(aa|å|a)lt i prod|measured in prod|prod-tal|prod-m(aa|å|a)ling|f(oe|ø|o)r\/efter i prod|before\/after in prod)/i.test(String(body ?? ""));
}

// ── Klassifikationen ───────────────────────────────────────────────────────

/**
 * @param {object} pr
 * @param {string} pr.title
 * @param {string} [pr.body]
 * @param {Array<string|{name:string}>} [pr.labels]
 * @param {Array<string|{path:string}|{filename:string}>} [pr.files]
 * @param {string|{login:string}} [pr.author]
 * @param {number} [pr.number]
 * @returns {{category: 'a'|'b'|'c'|'ejer-go', label: string, reason: string, ownerGo: boolean}}
 */
export function classifyPr(pr) {
  const title = String(pr?.title ?? "");
  const body = String(pr?.body ?? "");
  const labels = labelNames(pr?.labels);
  const files = filePaths(pr?.files);
  const author = authorLogin(pr?.author);
  const text = `${title}\n${body}`;
  const refs = new Set([...issueRefs(text), ...(pr?.number ? [Number(pr.number)] : [])]);

  const done = (category, reason) => ({
    category,
    label: CATEGORY_LABEL[category],
    reason,
    ownerGo: category === CATEGORY.OWNER,
  });

  if (!files.length) return done(CATEGORY.OWNER, "ingen filliste (kan ikke klassificere)");

  // 1) Ejerens roede linjer FOERST: findes en af dem, er intet andet relevant.
  const migrations = files.filter(isMigrationFile);
  if (migrations.length) return done(CATEGORY.OWNER, `migration: ${migrations[0]}`);
  if (labels.includes("flag-flip")) return done(CATEGORY.OWNER, "label flag-flip");
  const flagFiles = files.filter((f) => FLAG_FILE_RE.test(f) && !isTestFile(f) && !isDocsFile(f));
  if (flagFiles.length && FLAG_FLIP_RE.test(title)) return done(CATEGORY.OWNER, `flag-flip: ${flagFiles[0]}`);
  if (labels.includes("risk:high")) return done(CATEGORY.OWNER, "label risk:high");
  if (PROD_WRITE_RE.test(title)) return done(CATEGORY.OWNER, "prod-skrivning i titlen");
  const playerText = files.filter(isPlayerTextFile);
  if (playerText.length) return done(CATEGORY.OWNER, `spillertekst: ${playerText[0]}`);
  const ui = files.filter(isFrontendUiFile);
  if (ui.length) return done(CATEGORY.OWNER, `UI: ${ui[0]}`);

  // 2) (c) Dependabot patch/minor.
  const isDependabot = author.startsWith("dependabot") || labels.includes("dependencies");
  if (isDependabot) {
    const kind = semverBumpKind(title);
    const onlyPackageFiles = files.every(isLockfile);
    if (onlyPackageFiles && (kind === "patch" || kind === "minor")) {
      return done(CATEGORY.C_SAFE, `Dependabot ${kind}`);
    }
    return done(CATEGORY.OWNER, kind === "major" ? "Dependabot major" : "Dependabot: ukendt bump eller filer ud over package*.json");
  }

  // 3) (c) docs uden spillertekst · CI/hooks/test-only (kombinationer taeller ogsaa).
  const nonDocsCiTest = files.filter((f) => !isDocsFile(f) && !isCiOrHooksFile(f) && !isTestFile(f));
  if (!nonDocsCiTest.length) {
    const kinds = [];
    if (files.some(isDocsFile)) kinds.push("docs uden spillertekst");
    if (files.some(isCiOrHooksFile)) kinds.push("CI/hooks");
    if (files.some(isTestFile)) kinds.push("test-only");
    return done(CATEGORY.C_SAFE, kinds.join(" + "));
  }

  // 4) (b) motor bag slukket race_engine_v4: alle kode-filer under engine/v4.
  const codeFiles = files.filter((f) => !isDocsFile(f) && !isCiOrHooksFile(f) && !isTestFile(f));
  if (codeFiles.length && codeFiles.every(isEngineV4File)) {
    const excepted = ENGINE_EXCEPTION_ISSUES.filter((n) => refs.has(n));
    if (excepted.length) return done(CATEGORY.OWNER, `motor-PR undtaget af hard rule 35 (b): #${excepted[0]} (ejerens maaltal)`);
    return done(CATEGORY.B_ENGINE_V4, `kun backend/lib/engine/v4 (${codeFiles.length} filer)`);
  }

  // 5) (a) brand-fejlrettelse uden ny spillertekst, maalt i prod foer og efter.
  const looksLikeFix = /^(fix|hotfix)(\(|:|!)/i.test(title) || labels.includes("type:bug") || labels.includes("brand");
  if (looksLikeFix) {
    const numberFiles = codeFiles.filter(isPlayerNumberFile);
    if (numberFiles.length) return done(CATEGORY.OWNER, `spillervendte tal: ${numberFiles[0]}`);
    if (!hasProdMeasurement(body)) return done(CATEGORY.OWNER, "fejlrettelse uden prod-maaling foer/efter i body");
    return done(CATEGORY.A_BRAND_FIX, "fix uden spillertekst, prod-maaling i body");
  }

  const first = codeFiles[0] ?? files[0];
  return done(CATEGORY.OWNER, `kode uden for kategorierne: ${first}`);
}

/** Én linje til merge-queue.ps1's oversigt. */
export function formatClassification(result) {
  const tag = result.ownerGo ? "EJER-GO" : `KATEGORI ${result.category}`;
  return `${tag}: ${result.label} [${result.reason}]`;
}

// ── CLI ────────────────────────────────────────────────────────────────────

export function parseCliArgs(argv) {
  const out = { pr: null, repo: DEFAULT_REPO, input: null, json: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === "--pr") out.pr = Number(args.shift());
    else if (a === "--repo") out.repo = args.shift();
    else if (a === "--input") out.input = args.shift();
    else if (a === "--json") out.json = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  if (out.pr === null && !out.input) throw new Error("Angiv --pr <N> eller --input <fil.json>.");
  if (out.pr !== null && (!Number.isInteger(out.pr) || out.pr <= 0)) throw new Error("--pr skal vaere et positivt tal.");
  return out;
}

export function fetchPrFromGh(pr, repo, runGh = defaultRunGh) {
  const json = runGh(["pr", "view", String(pr), "--repo", repo, "--json", "number,title,body,labels,files,author"]);
  return JSON.parse(json);
}

function defaultRunGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
}

export function main(argv = process.argv.slice(2)) {
  const cli = parseCliArgs(argv);
  const pr = cli.input ? JSON.parse(readFileSync(cli.input, "utf8")) : fetchPrFromGh(cli.pr, cli.repo);
  const result = classifyPr(pr);
  process.stdout.write(cli.json ? `${JSON.stringify({ number: pr.number ?? cli.pr, ...result })}\n` : `${formatClassification(result)}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`merge-queue-classify: ${err.message}\n`);
    process.exitCode = 1;
  }
}
