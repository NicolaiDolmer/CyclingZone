import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRaceSearch,
  matchesRaceSearch,
  raceFamilyKey,
  summariseRace,
  filterLibrary,
} from "./model.ts";

const raw = {
  id: "race-a",
  name: "Vuelta Ibérica",
  race_type: "stage_race",
  stages: 3,
  stages_completed: 0,
  status: "scheduled",
  season_id: "s4",
  league_division_id: 10,
  pool_race_id: "catalog-new",
  edition_year: 2026,
  squad: "senior",
};
const season = { id: "s4", number: 4, status: "active" };
const schedule = [
  { race_id: "race-a", stage_number: 1, scheduled_at: "2026-10-14T10:00:00Z", game_day: 91 },
  { race_id: "race-a", stage_number: 2, scheduled_at: "2026-10-14T12:00:00Z", game_day: 92 },
  { race_id: "race-a", stage_number: 3, scheduled_at: "2026-10-15T10:00:00Z", game_day: 93 },
];
test("search normalises accents, apostrophes, article variants and compact input", () => {
  assert.equal(normalizeRaceSearch(" Vuelta  Ibérica "), "vueltaiberica");
  assert.ok(matchesRaceSearch("Vuelta Ibérica", "vueltaiberica"));
  assert.ok(matchesRaceSearch("Tour de l'Hexagone", "Tour d’Hexagone"));
  assert.ok(matchesRaceSearch("Giro della Penisola", "giro"));
  assert.ok(matchesRaceSearch("L'Enfer du Nord", ""));
  assert.equal(matchesRaceSearch("L'Enfer du Nord", "Vuelta"), false);
});
test("family identity survives replaced catalog IDs but preserves exact names and race type", () => {
  assert.equal(raceFamilyKey(raw), raceFamilyKey({ ...raw, pool_race_id: "old" }));
  assert.notEqual(raceFamilyKey(raw), raceFamilyKey({ ...raw, name: "Vuelta Iberica" }));
  assert.notEqual(raceFamilyKey(raw), raceFamilyKey({ ...raw, race_type: "single" }));
});
test("date and game day are separate axes; incomplete distance stays unknown", () => {
  const row = summariseRace(raw, season, schedule, [{ stage_number: 1, distance_km: 170 }], []);
  assert.equal(row.startAt, "2026-10-14T10:00:00Z");
  assert.equal(row.endAt, "2026-10-15T10:00:00Z");
  assert.equal(row.firstGameDay, 91);
  assert.equal(row.distanceKm, null);
  assert.equal(row.id, "race-a");
});
test("scheduled stage race with completed stages is live and never has a final winner", () => {
  const row = summariseRace(
    { ...raw, stages_completed: 2 },
    season,
    schedule,
    [],
    [
      {
        race_id: "race-a",
        stage_number: 2,
        result_type: "gc",
        rank: 1,
        rider_name: "Synthetic rider",
      },
    ]
  );
  assert.equal(row.status, "live");
  assert.equal(row.winner, null);
  const unknown = summariseRace({ ...raw, status: "cancelled" }, season, [], [], []);
  assert.equal(unknown.status, "unknown");
});
test("completed winner comes from highest GC stage, never a stage winner", () => {
  const row = summariseRace(
    { ...raw, status: "completed" },
    season,
    schedule,
    [
      { stage_number: 1, distance_km: 170 },
      { stage_number: 2, distance_km: 180 },
      { stage_number: 3, distance_km: 160 },
    ],
    [
      { race_id: "race-a", stage_number: 1, result_type: "gc", rank: 1, rider_name: "Old" },
      { race_id: "race-a", stage_number: 3, result_type: "stage", rank: 1, rider_name: "Stage" },
      { race_id: "race-a", stage_number: 3, result_type: "gc", rank: 1, rider_name: "Final" },
    ]
  );
  assert.equal(row.winner?.name, "Final");
  assert.equal(row.distanceKm, 510);
});
test("library preserves editions sharing year/name and puts live first; history contains completed only", () => {
  const live = summariseRace({ ...raw, stages_completed: 1 }, season, schedule, [], []);
  const upcoming = summariseRace({ ...raw, id: "race-b" }, season, schedule, [], []);
  const completed = summariseRace(
    { ...raw, id: "race-c", status: "completed" },
    season,
    schedule,
    [],
    []
  );
  const cancelled = summariseRace(
    { ...raw, id: "race-d", status: "cancelled" },
    season,
    [],
    [],
    []
  );
  assert.deepEqual(
    filterLibrary([upcoming, completed, cancelled, live], {
      tab: "upcoming",
      search: "",
      raceType: "all",
      raceClass: "all",
    }).map((r) => r.id),
    ["race-a", "race-b"]
  );
  assert.deepEqual(
    filterLibrary([live, completed], {
      tab: "history",
      search: "",
      raceType: "all",
      raceClass: "all",
    }).map((r) => r.id),
    ["race-c"]
  );
});

test("missing stage count is unknown, not an invented one-day race", () => {
  const row = summariseRace({ ...raw, stages: null }, season, [], [], []);
  assert.equal(row.stages, null);
  assert.equal(row.distanceKm, null);
});

test("compact search keeps a literal full name as well as article-free variants", () => {
  assert.ok(matchesRaceSearch("Tour de l'Hexagone", "tourdelhexagone"));
  assert.ok(matchesRaceSearch("Giro della Penisola", "girodellapenisola"));
});
