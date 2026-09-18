#!/usr/bin/env node
// scripts/check-now-md-sidecar.mjs
// ============================================================
// docs/NOW.md-sidevogns-guard — #5093.
//
// FEJLKLASSEN: docs/NOW.md er den eneste kilde til "aktivt issue" +
// "Working agent"-claim (CLAUDE.md-Start-rutinen). Intet forhindrede en
// almindelig feature-/bugfix-PR i at redigere filen som sidevogn til sin egen
// ændring — når det sker, overskriver PR'en enten close-out-staten fra en
// anden session, eller merges konflikt-løst med et forkert resultat. Ejeren
// pegede på tre kollisioner 8-10/9 (issuets "Bevis"-afsnit).
//
// REGLEN: enhver commit i PR'ens range mod main der rører docs/NOW.md skal
// have et conventional-commit-præfiks af typen "docs" eller "chore" (samme
// disciplin git-historikken allerede viser: docs(now):/docs(audit):-commits).
// En commit af enhver anden type (feat/fix/refactor/test/wip/...) der rører
// docs/NOW.md er per definition en sidevogns-ændring: NOW.md-opdateringen
// bør stå i sin egen docs(now)-commit, ikke bagt ind i feature-arbejdet.
//
// Merge-commits udelades (--no-merges): en merge af main ind i en
// feature-branch rører ofte docs/NOW.md via mange forudgående close-out-
// commits på main, uden at det er DENNE branch der "sidevogner" noget.
//
// Brug:
//   node scripts/check-now-md-sidecar.mjs                  (mod origin/main)
//   node scripts/check-now-md-sidecar.mjs --base <ref>      (mod en anden ref)
//
// Kræver at <base> findes lokalt (`git fetch origin main:refs/remotes/origin/main`
// eller tilsvarende) — findes den ikke, springes tjekket over med en advarsel i
// stedet for at fejle på git-infrastruktur (samme mønster som
// secdef-revoke-lint i scripts/preflight-pr.ps1).
//
// Refs #5093.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const NOW_MD = "docs/NOW.md";
const ALLOWED_TYPES = new Set(["docs", "chore"]);

/**
 * Udtrækker conventional-commit-typen af en commit-subject-linje, fx
 * "docs(now): ..." -> "docs", "feat(auction): ..." -> "feat".
 * Ingen match (intet ": "-conventional-praefiks, fx "wip: lane start" har et,
 * men "Merge branch 'main'" har ikke) -> null.
 *
 * @param {string} subject
 * @returns {string|null}
 */
export function commitTypeOf(subject) {
  const m = /^([a-z]+)(?:\([^)]*\))?!?:/.exec(String(subject ?? "").trim());
  return m ? m[1] : null;
}

/**
 * @param {string} subject
 * @returns {boolean} true hvis denne commit-type IKKE må røre docs/NOW.md alene.
 */
export function isNowMdSidecarCommit(subject) {
  const type = commitTypeOf(subject);
  return !ALLOWED_TYPES.has(type);
}

/**
 * @param {Array<{sha: string, subject: string, files: string[]}>} commits
 * @returns {Array<{sha: string, subject: string, type: string}>} sidevogns-fund, tomt = intet fund
 */
export function findNowMdSidecarViolations(commits) {
  return commits
    .filter((c) => Array.isArray(c.files) && c.files.includes(NOW_MD) && isNowMdSidecarCommit(c.subject))
    .map((c) => ({ sha: c.sha, subject: c.subject, type: commitTypeOf(c.subject) ?? "(intet conventional-commit praefiks)" }));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function resolveBase(base) {
  try {
    git(["rev-parse", "--verify", base]);
    return base;
  } catch {
    return null;
  }
}

function loadCommits(base) {
  const range = `${base}..HEAD`;
  const shas = git(["rev-list", "--no-merges", range]).split("\n").filter(Boolean);
  return shas.map((sha) => {
    const subject = git(["log", "-1", "--format=%s", sha]);
    const files = git(["show", "--name-only", "--format=", sha]).split("\n").filter(Boolean);
    return { sha, subject, files };
  });
}

function main() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf("--base");
  const requestedBase = baseIdx !== -1 ? args[baseIdx + 1] : "origin/main";

  const base = resolveBase(requestedBase);
  if (!base) {
    console.warn(`⚠️  now-md-sidecar-guard: kan ikke opløse "${requestedBase}" lokalt - springer over (kør \`git fetch origin main:refs/remotes/origin/main\` foerst).`);
    process.exit(0);
  }

  let commits;
  try {
    commits = loadCommits(base);
  } catch (err) {
    console.warn(`⚠️  now-md-sidecar-guard: git-kald fejlede (${err.message.trim()}) - springer over.`);
    process.exit(0);
  }

  const violations = findNowMdSidecarViolations(commits);
  if (violations.length === 0) {
    console.log(`✅ now-md-sidecar-guard: ingen commit mod ${base} rører ${NOW_MD} uden docs(...)/chore(...)-praefiks (${commits.length} commit(s) tjekket).`);
    return;
  }

  console.error(`\n❌ ${violations.length} commit(s) rører ${NOW_MD} som sidevogn til ikke-docs/chore-arbejde:`);
  for (const v of violations) {
    console.error(`   - ${v.sha.slice(0, 9)} (${v.type}): ${v.subject}`);
  }
  console.error(`
${NOW_MD} er den eneste kilde til "aktivt issue" + "Working agent"-claim
(CLAUDE.md-Start-rutinen). En commit der samtidig laver feature-/bugfix-arbejde
OG rører NOW.md kan overskrive close-out-staten fra en anden session, eller
merge konflikt-løst med et forkert resultat (tre kollisioner 8-10/9, #5093).

Fix: flyt NOW.md-ændringen til sin egen commit med et docs(now): eller
chore(...)-præfiks, ADSKILT fra feature-/bugfix-commit'en. Refs #5093.`);
  process.exit(1);
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) main();
