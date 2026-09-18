#!/usr/bin/env node
// scripts/check-now-md-sidecar.mjs
// ============================================================
// docs/NOW.md-sidevogns-guard - #5093 (ejer-valg 18/9: A, CI-guard).
//
// FEJLKLASSEN: docs/NOW.md er den eneste kilde til "aktivt issue" +
// "Working agent"-claim (CLAUDE.md-Start-rutinen). Intet forhindrede en
// almindelig feature-/bugfix-PR i at redigere filen som sidevogn til sin egen
// aendring - naar det sker, overskriver PR'en enten close-out-staten fra en
// anden session, eller merges konflikt-loest med et forkert resultat. Ejeren
// pegede paa tre kollisioner 8-10/9 (issuets "Bevis"-afsnit).
//
// REGLEN (ejer-valg 18/9, go-kort: A): en PR der roerer docs/NOW.md skal
// fejle, MEDMINDRE PR-titlen starter med "docs(now)" eller "docs(close-out)"
// (case-insensitivt). Direkte close-out-commits paa main er upaavirkede -
// guarden koerer kun paa `pull_request` (se wiring i ci.yml), aldrig paa
// `push`. Dependabot-PR'er rammes aldrig (de opretter praktisk talt aldrig en
// docs/NOW.md-aendring, men reglen goer det eksplicit for at undgaa falske
// positiver hvis en dependency-opdatering nogensinde skulle beroere den).
//
// Forskel fra en tidligere, revert'et variant (PR #5364, samme issue): den
// version laeste conventional-commit-praefikset paa HVER commit i PR-rangen
// (docs(...)/chore(...)). Ejerens 18/9-valg er smallere og PR-niveau: kun
// PR-TITLEN afgoer det, ikke commit-beskeder - en PR kan have "wip: ..."-
// mellemcommits uden at det tæller som sidevogn, saa laenge selve PR'en
// hedder docs(now)/docs(close-out). Denne fil er derfor en ny implementering,
// ikke en gencommit af #5364-koden.
//
// Hvad guarden laeser:
//   - AENDREDE FILER: `git diff --name-only <base>...HEAD` (default base:
//     origin/main), IKKE gh api'ens PR-filliste og IKKE commit-beskeder.
//   - PR-TITEL: miljoevariablen PR_TITLE, sat af ci.yml fra selve GitHub-
//     eventet (`${{ github.event.pull_request.title }}`) - aldrig gaettet
//     ud fra commit-beskeder.
//   - AKTOER: GITHUB_ACTOR (sat automatisk af GitHub Actions-runneren for
//     enhver step, samme kilde `dependabot-auto-merge.yml` bruger).
//
// Lokalt (preflight, uden en aaben PR endnu) er PR_TITLE typisk usat. Roerer
// arbejdstraeet docs/NOW.md i det tilfaelde, ADVARER scriptet uden at fejle -
// den endelige haandhaevelse sker i CI paa selve PR'en, hvor PR_TITLE altid
// er sat af GitHub. Kan `<base>` ikke opløses lokalt (origin/main ikke
// fetchet), springes tjekket over med samme advarsels-moenster som
// secdef-revoke-lint i scripts/preflight-pr.ps1.
//
// Brug:
//   node scripts/check-now-md-sidecar.mjs                 (mod origin/main)
//   NOW_MD_GUARD_BASE_REF=<ref> node scripts/check-now-md-sidecar.mjs
//
// KOERES AF: ci.yml (jobbet frontend-build, et required check - se
// scripts/ci-required-checks.json), scripts/preflight-pr.ps1.
//
// Refs #5093.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const NOW_MD = "docs/NOW.md";

// docs(now)/docs(close-out) - valgfrit scope-suffiks er IKKE tilladt her, i
// modsaetning til almindelige conventional-commit-praefikser: en PR-titel som
// "docs(now-audit): ..." er ikke en close-out, den er en dokumentations-PR om
// NOW.md, og skal stadig kunne rammes hvis den bagbinder en anden aendring.
const ALLOWED_TITLE_RE = /^docs\((now|close-out)\)/i;

/**
 * @param {string|undefined|null} title
 * @returns {boolean} true hvis PR-titlen markerer en close-out.
 */
export function isAllowedCloseOutTitle(title) {
  return ALLOWED_TITLE_RE.test(String(title ?? "").trim());
}

/**
 * @param {string|undefined|null} actor
 * @returns {boolean} true hvis PR'en er oprettet af Dependabot.
 */
export function isDependabotActor(actor) {
  return String(actor ?? "").toLowerCase() === "dependabot[bot]";
}

/**
 * Ren beslutningsfunktion - ingen git-/env-adgang, saa den er let at
 * unit-teste uafhaengigt af git-tilstand.
 *
 * @param {object} input
 * @param {string[]} input.changedFiles filer aendret mod base (git diff --name-only)
 * @param {string|undefined} input.prTitle PR-titel, eller undefined hvis ukendt
 * @param {string} [input.actor] GITHUB_ACTOR
 * @returns {{verdict: "ok"|"warn"|"fail", message: string}}
 */
export function evaluateNowMdSidecar({ changedFiles, prTitle, actor }) {
  if (isDependabotActor(actor)) {
    return {
      verdict: "ok",
      message: `dependabot[bot]-PR - now-md-sidecar-guarden gaelder ikke automatiserede dependency-PR'er.`,
    };
  }

  if (!changedFiles.includes(NOW_MD)) {
    return { verdict: "ok", message: `${NOW_MD} er ikke roert af denne PR.` };
  }

  if (prTitle === undefined) {
    return {
      verdict: "warn",
      message:
        `${NOW_MD} er aendret, men PR-titlen er ukendt her (lokalt tjek uden aaben PR endnu, ` +
        `eller en CI-kontekst uden pull_request-event) - advarer uden at fejle. ` +
        `CI paa selve PR'en haandhaever ved at laese PR_TITLE fra GitHub-eventet.`,
    };
  }

  if (isAllowedCloseOutTitle(prTitle)) {
    return {
      verdict: "ok",
      message: `PR-titlen ("${prTitle}") er en close-out (docs(now)/docs(close-out)) - ${NOW_MD}-aendring tilladt.`,
    };
  }

  return {
    verdict: "fail",
    message:
      `${NOW_MD} er aendret i denne PR, men PR-titlen ("${prTitle}") starter ikke med ` +
      `"docs(now)" eller "docs(close-out)" (case-insensitivt).\n\n` +
      `${NOW_MD} er den eneste kilde til "aktivt issue" + "Working agent"-claim ` +
      `(CLAUDE.md-Start-rutinen). En feature-/bugfix-PR der samtidig redigerer den som ` +
      `sidevogn kan overskrive close-out-staten fra en anden session, eller merges ` +
      `konflikt-loest med et forkert resultat (tre kollisioner 8-10/9, ejer-valg 18/9, #5093).\n\n` +
      `Fix (vaelg en):\n` +
      `  - Fjern ${NOW_MD}-aendringen fra denne PR (flyt den til en separat docs(now)-PR).\n` +
      `  - Omdoeb denne PR til at starte med "docs(now): ..." eller "docs(close-out): ..." hvis ` +
      `den faktisk ER en close-out.\n` +
      `Refs #5093.`,
  };
}

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryRun(command, args) {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function resolveBase(base) {
  return tryRun("git", ["rev-parse", "--verify", base]) !== null ? base : null;
}

export function changedFiles(baseRef) {
  const diff = tryRun("git", ["diff", "--name-only", `${baseRef}...HEAD`]);
  return diff ? diff.split(/\r?\n/).filter(Boolean) : [];
}

function main() {
  const requestedBase = process.env.NOW_MD_GUARD_BASE_REF || "origin/main";
  const actor = process.env.GITHUB_ACTOR || "";
  const prTitle = process.env.PR_TITLE;

  const base = resolveBase(requestedBase);
  if (!base) {
    console.warn(
      `⚠️  now-md-sidecar-guard: kan ikke opløse "${requestedBase}" lokalt - springer over ` +
        `(kør \`git fetch origin main:refs/remotes/origin/main\` foerst).`,
    );
    process.exit(0);
  }

  const changed = changedFiles(base);
  const result = evaluateNowMdSidecar({ changedFiles: changed, prTitle, actor });

  if (result.verdict === "fail") {
    console.error(`\n❌ now-md-sidecar-guard: ${result.message}`);
    process.exit(1);
  }
  if (result.verdict === "warn") {
    console.warn(`⚠️  now-md-sidecar-guard: ${result.message}`);
    process.exit(0);
  }
  console.log(`✅ now-md-sidecar-guard: ${result.message}`);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
