// backend/scripts/lib/repoRoot.mjs
//
// #4274: et dev-script (s3CalendarPackageScorecard.js) skrev sin rapport ind i
// et HELT ANDET worktree end det den blev kørt fra — outPath var bygget som
// `join(__dirname, "../../docs/audits/...")`, som normalt ANKRER korrekt inde i
// scriptets egen worktree-checkout. Rodårsagen blev IKKE fuldt verificeret
// (ingen kontrolleret reproduktion lykkedes på denne maskine — __dirname/
// import.meta.url/realpath var identiske og korrekte i alle test, se PR-body
// for #4274). Denne helper er alligevel en billig forward-guard: den ankrer på
// hvad GIT SELV mener er top'en af den arbejdstræ-checkout processen kører i
// (`git rev-parse --show-toplevel` for `cwd`), i stedet for at stole
// udelukkende på __dirname. Et worktree er sit eget top-level for git, så dette
// kan aldrig pege ind i et ANDET worktree, uanset hvordan __dirname skulle
// resolve forkert (delt node_modules-cache, symlinks, andre fremtidige
// mekanismer).
import { execFileSync } from "node:child_process";

/**
 * @param {string} [cwd] — mappen at spørge git fra (default: process.cwd()).
 * @returns {string} absolut sti til roden af DET arbejdstræ `cwd` ligger i.
 */
export function repoRoot(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
}
