// scripts/ci/workflow-paths-match.mjs
// ============================================================
// #6724: preflight-pr.ps1 skal kun koere de vagter, som CI faktisk ville koere
// for denne branch. Workflows med et `paths:`-filter paa `pull_request` koerer
// kun, naar en aendret fil matcher. I stedet for at kopiere moenstrene ind i
// preflight (og lade dem glide fra workflowet) laeser denne fil filteret
// direkte fra workflow-YAML'en.
//
// Aendrede filer = diff mod merge-basen med origin/main + arbejdstraeet +
// nye, ikke-trackede filer (samme som en PR ville indeholde efter commit).
//
// CLI:
//   node scripts/ci/workflow-paths-match.mjs .github/workflows/table-grants.yml
//     exit 0 = koer vagten (match, intet paths-filter, eller git fejlede)
//     exit 3 = spring over (ingen aendret fil matcher filteret)
//   node scripts/ci/workflow-paths-match.mjs --changed
//     printer de aendrede filer, en pr. linje
//
// Refs #6724 #6616.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKIP_EXIT = 3;

/**
 * GitHub Actions' paths-glob -> RegExp. `**` matcher paa tvaers af mapper,
 * `*` og `?` inden for et segment. `dir/**` matcher alt under dir.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Udtraek `paths:`-listen under `on.pull_request` fra en workflow-YAML.
 * Returnerer null, naar pull_request ikke har et paths-filter (= koerer altid).
 * @param {string} yml
 * @returns {string[] | null}
 */
export function pullRequestPaths(yml) {
  const lines = yml.split(/\r?\n/);
  const onIdx = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (onIdx < 0) return null;
  let inPr = false;
  let prIndent = -1;
  let inPaths = false;
  let pathsIndent = -1;
  const out = [];
  for (let i = onIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // naeste top-level noegle (fx permissions:, jobs:)
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (inPaths) {
      const item = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
      if (item && indent >= pathsIndent) {
        out.push(item[1].trim());
        continue;
      }
      inPaths = false;
    }
    if (inPr && indent <= prIndent) inPr = false;
    const key = line.match(/^(\s*)([A-Za-z_-]+):/);
    if (!key) continue;
    if (!inPr && key[2] === "pull_request") {
      inPr = true;
      prIndent = indent;
    } else if (inPr && key[2] === "paths") {
      inPaths = true;
      pathsIndent = indent;
    }
  }
  return out.length ? out : null;
}

/**
 * Matcher en af filerne filteret? Negerede moenstre (`!x`) tages i
 * raekkefoelge, som GitHub goer: sidste matchende moenster vinder.
 * @param {string[]} patterns
 * @param {string[]} files
 */
export function anyFileMatches(patterns, files) {
  const compiled = patterns.map((p) => ({ neg: p.startsWith("!"), re: globToRegExp(p.replace(/^!/, "")) }));
  return files.some((f) => {
    let hit = false;
    for (const { neg, re } of compiled) if (re.test(f)) hit = !neg;
    return hit;
  });
}

function git(args) {
  return execFileSync("git", ["--no-pager", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @returns {string[] | null} null hvis git ikke kan svare (fx origin/main mangler) */
export function changedFiles() {
  try {
    const base = git(["merge-base", "HEAD", "origin/main"])[0];
    const files = new Set([
      ...git(["diff", "--name-only", `${base}...HEAD`]),
      ...git(["diff", "--name-only", "HEAD"]),
      ...git(["ls-files", "--others", "--exclude-standard"]),
    ]);
    return [...files].map((f) => f.replace(/\\/g, "/"));
  } catch {
    return null;
  }
}

function main(argv) {
  if (argv[0] === "--changed") {
    const files = changedFiles();
    if (files) process.stdout.write(files.map((f) => `${f}\n`).join(""));
    return files ? 0 : 1;
  }
  const wf = argv[0];
  if (!wf) {
    process.stderr.write("brug: workflow-paths-match.mjs <workflow.yml> | --changed\n");
    return 2;
  }
  const patterns = pullRequestPaths(readFileSync(wf, "utf8"));
  if (!patterns) {
    process.stdout.write(`  (${path.basename(wf)}: intet paths-filter - koeres altid)\n`);
    return 0;
  }
  const files = changedFiles();
  if (!files) {
    process.stdout.write(`  (${path.basename(wf)}: kunne ikke laese aendrede filer mod origin/main - koeres for en sikkerheds skyld)\n`);
    return 0;
  }
  if (anyFileMatches(patterns, files)) return 0;
  process.stdout.write(`  sprunget over: ingen aendret fil matcher ${path.basename(wf)}'s paths (${patterns.join(", ")})\n`);
  return SKIP_EXIT;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
