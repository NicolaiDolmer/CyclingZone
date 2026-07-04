import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { raceBindingWindow, windowsOverlap } from "./raceBinding.js";

// Forward-guard for "No start list"-regressionen (CYCLINGZONE-23, 2026-07-04):
// loadFieldBindingContext (runtime auto-fill-stien i raceRunner.js) MÅ selecte game_day
// i sine race_stage_schedule-queries. raceBindingWindow nøgler kun på in-game-dagen når
// hver row har et endeligt game_day (raceBinding.js:56) — udelades kolonnen, falder den
// tavst tilbage til real-kalenderdag-ordinalen, og efter kalender-rebuilden (#1945)
// overlapper alle løb da → excludeBoundRiders tømmer feltet → simulateStageByIndex kaster
// "No start list". Søster-stien loadTeamBindingContext selecter allerede game_day; denne
// test sikrer at auto-fill-stien ikke igen driver bagud (commit 40079c50 glemte den).

const src = readFileSync(resolve(import.meta.dirname, "raceRunner.js"), "utf8");

function loadFieldBindingContextBody() {
  const start = src.indexOf("async function loadFieldBindingContext");
  assert.notEqual(start, -1, "loadFieldBindingContext findes i raceRunner.js");
  // Slut ved starten af næste top-level funktion.
  const after = src.slice(start + 1);
  const nextFn = after.search(/\n(?:async function|function|export )/);
  return after.slice(0, nextFn === -1 ? undefined : nextFn);
}

test("loadFieldBindingContext selecter game_day i alle race_stage_schedule-queries", () => {
  const body = loadFieldBindingContextBody();
  const selects = [...body.matchAll(/\.from\(\s*["']race_stage_schedule["']\s*\)\s*\.select\(\s*["']([^"']*)["']/g)]
    .map((m) => m[1]);
  assert.ok(
    selects.length >= 2,
    `forventede mindst 2 race_stage_schedule-selects i loadFieldBindingContext, fandt ${selects.length}`,
  );
  const missing = selects.filter((cols) => !/\bgame_day\b/.test(cols));
  assert.deepEqual(
    missing,
    [],
    `race_stage_schedule-selects uden game_day i loadFieldBindingContext: [${missing.join(" | ")}]. `
      + `game_day er obligatorisk, ellers nøgler raceBindingWindow på real-kalenderdag → falsk `
      + `all-løb-overlap → tomt startfelt (CYCLINGZONE-23).`,
  );
});

test("raceBindingWindow: game_day-nøgling adskiller løb der ellers ville overlappe i kalenderdag-rummet", () => {
  // To løb komprimeret til samme real-eftermiddag (2026-07-03) men forskellige in-game-dage.
  const raceA = [
    { scheduled_at: "2026-07-03T15:00:00Z", game_day: 7 },
    { scheduled_at: "2026-07-03T16:00:00Z", game_day: 8 },
  ];
  const raceB = [
    { scheduled_at: "2026-07-03T17:00:00Z", game_day: 20 },
    { scheduled_at: "2026-07-03T18:00:00Z", game_day: 21 },
  ];
  // Med game_day: forskellige in-game-dage → intet overlap → ryttere bindes ikke på tværs.
  assert.equal(windowsOverlap(raceBindingWindow(raceA), raceBindingWindow(raceB)), false);

  // Uden game_day (bug-tilstanden): begge kollapser til samme kalenderdag → falsk overlap.
  const stripA = raceA.map((r) => ({ scheduled_at: r.scheduled_at }));
  const stripB = raceB.map((r) => ({ scheduled_at: r.scheduled_at }));
  assert.equal(
    windowsOverlap(raceBindingWindow(stripA), raceBindingWindow(stripB)),
    true,
    "uden game_day kollapser begge løb til samme kalenderdag og overlapper falsk (dokumenterer bug-stien)",
  );
});
