#!/usr/bin/env node
// lint-action-pinning.mjs (#4467)
//
// Baggrund: en fremmed bot aabnede PR #4467 mod repoet 30/8. Selve PR'en var harmloes
// (to tekstfiler, hallucineret PHP mod et Node-repo), men den afsloerede en aegte
// haerdnings-mangel: add-to-project.yml koerer paa `pull_request_target` med
// secrets.PROJECTS_PAT, og den kunne trigges af enhver fremmed. Actionen var pinnet til
// det FLYTBARE tag v2.0.0, ikke til en SHA. Bliver et saadant tag kompromitteret upstream,
// koerer angriberens kode i et job der har vores PAT i haanden.
//
// Reglen denne guard haandhaever:
//   1. Enhver action fra en IKKE-GitHub-ejet org skal vaere pinnet til en fuld 40-tegns SHA.
//   2. Enhver action - ogsaa GitHubs egne - skal vaere SHA-pinnet hvis den bruges i en
//      workflow hvis trigger koerer fra default-branchen MED secrets og kan udloeses af
//      folk uden skriveadgang: pull_request_target, issue_comment, issues,
//      pull_request_review_comment, pull_request_review.
//
// GitHub-ejede orgs er undtaget for regel 1, fordi de er en anden tillidsklasse end en
// tilfaeldig tredjepart. De er IKKE undtaget for regel 2.
//
// Brug:
//   node scripts/lint-action-pinning.mjs          # exit 1 ved fund
//   node scripts/lint-action-pinning.mjs --warn   # rapportér, exit 0

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const WORKFLOW_DIR = ".github/workflows";
const GITHUB_OWNED_ORGS = new Set(["actions", "github", "dependabot"]);
// Events der koerer fra default-branchen MED repoets secrets, og som kan udloeses af
// folk uden skriveadgang paa et offentligt repo. Fork-PR'ens egen `pull_request` er
// bevidst IKKE med: den koerer med read-only token og uden secrets.
const SECRET_BEARING_TRIGGERS = [
  "pull_request_target",
  "issue_comment",
  "issues",
  "pull_request_review_comment",
  "pull_request_review",
];
const SHA_RE = /^[0-9a-f]{40}$/;

/** `uses: owner/repo@ref` og `uses: owner/repo/sub/path@ref`. Springer lokale (./) og docker:// over. */
const USES_RE = /^\s*-?\s*uses:\s*["']?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+)@([^\s"'#]+)/;

/**
 * Udtraek KUN `on:`-blokken. Foerste udgave af denne funktion soegte i HELE filen og
 * matchede derfor ogsaa `permissions:`-blokkens `issues: write`. Det gav 56 falske fund
 * paa foerste koersel og ville have gjort guarden til stoej ingen laeser.
 *
 * Blokken gaar fra linjen der starter med `on:` til naeste noegle i kolonne 0.
 */
export function onBlockOf(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^on\s*:/.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z_"']/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Hvilke secret-baerende triggere har filen? Maalt KUN inde i `on:`-blokken. */
function triggersOf(text) {
  const on = onBlockOf(text);
  return SECRET_BEARING_TRIGGERS.filter((t) => new RegExp(`^\\s+${t}\\s*:`, "m").test(on));
}

export function findUnpinnedActions(dir = WORKFLOW_DIR) {
  const findings = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    const risky = triggersOf(text);

    text.split(/\r?\n/).forEach((line, i) => {
      const m = USES_RE.exec(line);
      if (!m) return;
      const [, org, repo, ref] = m;
      if (SHA_RE.test(ref)) return;

      const action = `${org}/${repo}`;
      const githubOwned = GITHUB_OWNED_ORGS.has(org);

      if (!githubOwned) {
        findings.push({
          file, line: i + 1, action, ref,
          rule: "third-party",
          why: `${action} er tredjepart og skal pinnes til en SHA, ikke til det flytbare tag ${ref}`,
        });
      } else if (risky.length > 0) {
        findings.push({
          file, line: i + 1, action, ref,
          rule: "secret-bearing-trigger",
          why: `${file} har trigger(e) ${risky.join(", ")} og koerer derfor med repoets secrets, udloest af folk uden skriveadgang. Alle actions i den fil skal SHA-pinnes, ogsaa GitHubs egne.`,
        });
      }
    });
  }
  return findings;
}

const isMain = process.argv[1] && process.argv[1].endsWith("lint-action-pinning.mjs");
if (isMain) {
  const warnOnly = process.argv.includes("--warn");
  const findings = findUnpinnedActions();

  if (findings.length === 0) {
    console.log("action-pinning: alle tredjeparts-actions og alle actions i secret-baerende workflows er SHA-pinnet");
    process.exit(0);
  }

  console.error(`action-pinning: ${findings.length} action(s) er ikke SHA-pinnet\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.action}@${f.ref}  [${f.rule}]`);
    console.error(`    ${f.why}`);
    console.error(`    Ret med: gh api repos/${f.action}/git/ref/tags/${f.ref} --jq '.object.sha'`);
    console.error("    (er svaret et annotated tag, saa slaa commit-SHA'en op med repos/<action>/git/tags/<sha>)\n");
  }
  console.error("Behold tag-navnet som kommentar efter SHA'en, saa mennesker kan se hvilken version der er pinnet:");
  console.error("  uses: owner/repo@<40-tegns-sha> # v1.2.3\n");
  process.exit(warnOnly ? 0 : 1);
}
