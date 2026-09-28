import { test } from "node:test";
import assert from "node:assert/strict";
import { buildYouthRaceItems, youthPoolIdFor, youthSelectionOpen } from "./youthRaceCalendar.ts";

const races = [
  { id: "b", name: "Beta U23", race_type: "single", stages: 1, stages_completed: 0, status: "scheduled" },
  { id: "a", name: "Alpha Junior Tour", race_type: "stage_race", stages: 3, stages_completed: 1, status: "active" },
  { id: "c", name: "Gamma", race_type: "single", stages: 1, stages_completed: 1, status: "completed" },
  { id: "d", name: "Delta", race_type: "single", stages: 1, stages_completed: 1, status: "completed" },
];
const schedule = [
  { race_id: "b", stage_number: 1, scheduled_at: "2026-09-29T17:30:00Z" },
  { race_id: "a", stage_number: 2, scheduled_at: "2026-09-29T17:30:00Z" },
  { race_id: "a", stage_number: 1, scheduled_at: "2026-09-28T17:30:00Z" },
  { race_id: "c", stage_number: 1, scheduled_at: "2026-09-20T17:30:00Z" },
  { race_id: "d", stage_number: 1, scheduled_at: "2026-09-21T17:30:00Z" },
];

test("#5843: kalender = ikke afsluttede løb efter start, resultater = afsluttede nyeste først", () => {
  const { calendar, results } = buildYouthRaceItems(races, schedule, []);
  assert.deepEqual(calendar.map((r) => r.id), ["a", "b"]);
  assert.equal(calendar[0].startsAt, "2026-09-28T17:30:00Z");
  assert.equal(calendar[0].endsAt, "2026-09-29T17:30:00Z");
  assert.deepEqual(results.map((r) => r.id), ["d", "c"]);
});

test("#5843: holdets udtagelse er manuel, auto eller ingen", () => {
  const { calendar } = buildYouthRaceItems(races, schedule, [
    { race_id: "b", is_auto_filled: true },
    { race_id: "b", is_auto_filled: true },
    { race_id: "a", is_auto_filled: false },
    { race_id: "a", is_auto_filled: true },
  ]);
  const byId = Object.fromEntries(calendar.map((r) => [r.id, r]));
  assert.equal(byId.b.selection, "auto");
  assert.equal(byId.b.riders, 2);
  assert.equal(byId.a.selection, "manual");
});

test("#5843: udtagelsen er åben til første etape er kørt, som senior", () => {
  const { calendar } = buildYouthRaceItems(races, schedule, []);
  const byId = Object.fromEntries(calendar.map((r) => [r.id, r]));
  assert.equal(youthSelectionOpen(byId.b), true);
  assert.equal(youthSelectionOpen(byId.a), false);
});

test("#5843: truppens pulje, aldrig seniorpuljen (ejerens hold: senior 1, U23 24, junior 30)", () => {
  const team = { league_division_id: 1, u23_league_division_id: 24, junior_league_division_id: 30 };
  assert.equal(youthPoolIdFor(team, "u23"), 24);
  assert.equal(youthPoolIdFor(team, "junior"), 30);
  assert.equal(youthPoolIdFor({ league_division_id: 1, u23_league_division_id: null }, "u23"), null);
  assert.equal(youthPoolIdFor(null, "u23"), null);
});
