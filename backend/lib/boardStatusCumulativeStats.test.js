import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");
const goalContextSource = readFileSync(join(__dirname, "./boardGoalContext.js"), "utf8");

// ============================================================
// #979 — GET /board/status: cumulative stage_wins/gc_wins skal tælle
// indeværende sæsons in-progress wins med, ikke kun afsluttede sæsoner.
//
// board.cumulative_* persisteres FØRST ved season-end
// (economyEngine.processTeamSeasonEnd), så et display der kun læser
// board.cumulative_stage_wins viste 0 midt i sæsonen selvom holdet havde
// vundet etaper. Fixet beregner én delt værdi (afsluttede + currentStanding)
// og genbruger den til både outlook-evaluering og det returnerede display, så
// de to ikke kan drifte fra hinanden (drift var root cause for #979).
//
// #2469 · Beregningen bor nu i buildBoardEvalContext (boardGoalContext.js) —
// den delte context-bygger for ALLE motor-stier — og displayet læser direkte
// fra den byggede kontekst. Invarianten er den samme, håndhævelsen strukturel.
// ============================================================

test("#979 cumulative wins beregnes som afsluttede + indeværende sæson (i den delte bygger)", () => {
  assert.match(
    goalContextSource,
    /stageWins:\s*\(board\.cumulative_stage_wins \|\| 0\) \+ \(standing\?\.stage_wins \|\| 0\)/,
    "buildBoardEvalContext skal lægge standing.stage_wins oveni board.cumulative_stage_wins",
  );
  assert.match(
    goalContextSource,
    /gcWins:\s*\(board\.cumulative_gc_wins \|\| 0\) \+ \(standing\?\.gc_wins \|\| 0\)/,
    "buildBoardEvalContext skal lægge standing.gc_wins oveni board.cumulative_gc_wins",
  );
});

test("#979 returneret cumulative_stats læser fra den delte eval-kontekst", () => {
  assert.match(
    apiSource,
    /cumulative_stats:\s*\{\s*stage_wins:\s*weekendEvalContext\.cumulativeStats\.stageWins,\s*gc_wins:\s*weekendEvalContext\.cumulativeStats\.gcWins,\s*\}/,
    "Det returnerede cumulative_stats-display skal læse fra weekendEvalContext.cumulativeStats",
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

// ============================================================
// #2308 — GET /board/status: outlook-context skal sende isFinalSeason, som
// weekend-finalization + season-end allerede gør. Uden den scorer
// no_outstanding_debt 1.0 i stedet for 1.05, og final-only mål pro-rates
// forkert i det live BoardPage-display.
//
// #2469 · isFinalSeason beregnes nu i buildBoardEvalContext, som /board/status
// (og alle øvrige stier) kalder — se boardEvalContext.test.js for sti-guards.
// ============================================================

test("#2308 isFinalSeason beregnes kanonisk i den delte bygger", () => {
  assert.match(
    goalContextSource,
    /isFinalSeason:\s*seasonsCompleted\s*>=\s*planDuration,/,
    "buildBoardEvalContext skal sætte isFinalSeason = seasonsCompleted >= planDuration",
  );
});
