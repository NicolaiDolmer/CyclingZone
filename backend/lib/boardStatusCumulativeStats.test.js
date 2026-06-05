import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #979 — GET /board/status: cumulative stage_wins/gc_wins skal tælle
// indeværende sæsons in-progress wins med, ikke kun afsluttede sæsoner.
//
// board.cumulative_* persisteres FØRST ved season-end
// (economyEngine.processTeamSeasonEnd ~L1039), så et display der kun læser
// board.cumulative_stage_wins viste 0 midt i sæsonen selvom holdet havde
// vundet etaper. Fixet beregner én delt værdi (afsluttede + currentStanding)
// og genbruger den til både outlook-evaluering og det returnerede display, så
// de to ikke kan drifte fra hinanden (drift var root cause for #979).
// ============================================================

test("#979 cumulative wins beregnes som afsluttede + indeværende sæson", () => {
  assert.match(
    apiSource,
    /const cumulativeStageWins = \(board\.cumulative_stage_wins \|\| 0\) \+ \(currentStanding\?\.stage_wins \|\| 0\);/,
    "cumulativeStageWins skal lægge currentStanding.stage_wins oveni board.cumulative_stage_wins",
  );
  assert.match(
    apiSource,
    /const cumulativeGcWins = \(board\.cumulative_gc_wins \|\| 0\) \+ \(currentStanding\?\.gc_wins \|\| 0\);/,
    "cumulativeGcWins skal lægge currentStanding.gc_wins oveni board.cumulative_gc_wins",
  );
});

test("#979 returneret cumulative_stats bruger den delte beregning", () => {
  assert.match(
    apiSource,
    /cumulative_stats:\s*\{\s*stage_wins:\s*cumulativeStageWins,\s*gc_wins:\s*cumulativeGcWins,\s*\}/,
    "Det returnerede cumulative_stats-display skal bruge cumulativeStageWins/cumulativeGcWins",
  );
});

test("#979 outlook-evaluering bruger SAMME delte beregning (ingen drift)", () => {
  assert.match(
    apiSource,
    /cumulativeStats:\s*\{\s*stageWins:\s*cumulativeStageWins,\s*gcWins:\s*cumulativeGcWins,\s*\}/,
    "outlook-context cumulativeStats skal bruge de samme delte variabler som displayet",
  );
});

test("#979 forward-guard: display må ikke regressere til bart board.cumulative_*", () => {
  assert.doesNotMatch(
    apiSource,
    /stage_wins:\s*board\.cumulative_stage_wins/,
    "cumulative_stats.stage_wins må ikke læses direkte fra board (mister indeværende sæson)",
  );
  assert.doesNotMatch(
    apiSource,
    /gc_wins:\s*board\.cumulative_gc_wins/,
    "cumulative_stats.gc_wins må ikke læses direkte fra board (mister indeværende sæson)",
  );
});
