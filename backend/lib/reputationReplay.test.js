// #5537 (S9, spec 2026-09-15 C3): omdømme-afspilningen er SENIOR-ONLY i v1.
//
// Efter A2 (#5517) bor U23-/juniorløb i samme races-tabel. Afspilningen (delt af
// backfill-scriptet og kalibrerings-harnessen) må ikke give omdømme for et
// ungdomsløb — samme dom som live-krogen (reputationHook.js). Ungdomsresultaterne
// tælles for sig og må IKKE forveksles med "ukendte løb" (unknownRaceIds betyder
// resultater på et løb der ikke er completed).

import test from "node:test";
import assert from "node:assert/strict";

import { loadCompletedRaces, replayEvents, runReplay } from "./reputationReplay.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const race = (id, extra = {}) => ({
  id, season_id: "s1", race_type: "stage_race", race_class: "TourFrance", stages: 21, status: "completed", ...extra,
});
const stageWin = (id, raceId, riderId) => ({
  id, race_id: raceId, stage_number: 5, result_type: "stage", rank: 1, rider_id: riderId, team_id: "t1",
});
const SEASONS = [{ id: "s1", number: 3, status: "active" }];

test("#5537 ungdomsløb afspilles ikke, men tælles for sig (kontrol: seniorløbet giver hændelser)", () => {
  const replay = replayEvents({
    races: [race("r-senior", { squad: "senior" }), race("r-u23", { squad: "u23" }), race("r-junior", { squad: "junior" })],
    results: [
      stageWin(1, "r-senior", "rider-a"),
      stageWin(2, "r-u23", "rider-b"),
      stageWin(3, "r-junior", "rider-c"),
      stageWin(4, "r-junior", null),
      // Løb der ikke er completed → stadig "ukendt", ikke ungdom.
      stageWin(5, "r-unknown", "rider-d"),
    ],
    seasons: SEASONS,
  });

  assert.deepEqual([...new Set(replay.events.map((e) => e.race_id))], ["r-senior"]);
  assert.deepEqual([...replay.byRider.keys()], ["rider-a"]);
  assert.equal(replay.racesWithEvents, 1);

  assert.equal(replay.youthResults, 3);
  assert.deepEqual([...replay.youthRaceIds].sort(), ["r-junior", "r-u23"]);

  assert.equal(replay.skippedResults, 1, "kun det ukendte løb");
  assert.deepEqual([...replay.unknownRaceIds], ["r-unknown"]);

  // Dækningstallet beskriver den afspillede population (+ ukendte løb i "?"-spanden,
  // som før): ungdomsrækkerne — også den uden rytter — indgår ikke.
  assert.deepEqual(replay.coverage, [
    { season_number: null, rows: 1, without_rider: 0 },
    { season_number: 3, rows: 1, without_rider: 0 },
  ]);
});

test("#5537 bit-identisk i dag: løb uden squad-felt giver præcis samme afspilning som 'senior'", () => {
  const results = [stageWin(1, "r1", "rider-a"), stageWin(2, "r2", "rider-b"), stageWin(3, "r-unknown", null)];
  const without = replayEvents({ races: [race("r1"), race("r2", { squad: null })], results, seasons: SEASONS });
  const senior = replayEvents({ races: [race("r1", { squad: "senior" }), race("r2", { squad: "senior" })], results, seasons: SEASONS });

  assert.deepEqual(without.events, senior.events);
  assert.deepEqual(without.coverage, senior.coverage);
  assert.equal(without.events.length, 2);
  assert.equal(without.skippedResults, 1);
  assert.equal(without.youthResults, 0);
  assert.equal(without.youthRaceIds.size, 0);
});

// ── loadCompletedRaces: henter ALLE afsluttede løb med trup ─────────────────

test("#5537 loadCompletedRaces henter også ungdomsløbene, med squad", async () => {
  const supabase = createFakeSupabase({
    races: [
      race("r1", { squad: "senior" }),
      race("r2", { squad: "u23" }),
      race("r3", { squad: "junior", status: "scheduled" }),
    ],
  });

  const races = await loadCompletedRaces(supabase);

  assert.deepEqual(races.map((r) => [r.id, r.squad]), [["r1", "senior"], ["r2", "u23"]]);
});

// Races-tabellen fra før A2: et select der nævner squad svarer 42703 (eller en
// anden fejl), alt andet går til den ægte fake.
function racesSelectFailing(tableRows, error) {
  const base = createFakeSupabase({ races: tableRows });
  const selects = [];
  return {
    selects,
    from(table) {
      const real = base.from(table);
      return {
        select(columns) {
          selects.push(columns);
          if (!String(columns).includes("squad")) return real.select(columns);
          const stub = {
            eq: () => stub, order: () => stub, gt: () => stub, limit: () => stub,
            then: (resolve, reject) => Promise.resolve({ data: null, error }).then(resolve, reject),
          };
          return stub;
        },
      };
    },
  };
}

test("#5537 loadCompletedRaces: 42703 på squad → ét fallback uden, rækkerne dømmes senior", async () => {
  const supabase = racesSelectFailing(
    [race("r1"), race("r2")],
    { code: "42703", message: "column races.squad does not exist" },
  );

  const races = await loadCompletedRaces(supabase);

  assert.deepEqual(races.map((r) => r.id), ["r1", "r2"]);
  assert.ok(races.every((r) => !("squad" in r)));
  assert.equal(supabase.selects.length, 2);
  assert.match(supabase.selects[0], /squad/);
  assert.doesNotMatch(supabase.selects[1], /squad/);

  const replay = replayEvents({ races, results: [stageWin(1, "r1", "rider-a")], seasons: SEASONS });
  assert.equal(replay.events.length, 1);
  assert.equal(replay.youthResults, 0);
});

test("#5537 loadCompletedRaces: en anden fejl end 42703 falder IKKE tilbage", async () => {
  const supabase = racesSelectFailing(
    [race("r1")],
    { code: "PGRST204", message: "Could not find the 'squad' column of 'races' in the schema cache" },
  );

  await assert.rejects(loadCompletedRaces(supabase), /schema cache/);
  assert.equal(supabase.selects.length, 1);
});

// ── runReplay end-to-end (READ-ONLY) ────────────────────────────────────────

test("#5537 runReplay: ungdomsresultater giver ingen hændelser, seniorresultatet gør", async () => {
  const supabase = createFakeSupabase({
    races: [race("r-senior", { squad: "senior" }), race("r-u23", { squad: "u23" })],
    race_results: [
      stageWin("00000001", "r-senior", "rider-a"),
      stageWin("00000002", "r-u23", "rider-b"),
      // Uden for det relevante udsnit (rank > 10) — hentes slet ikke.
      { ...stageWin("00000003", "r-u23", "rider-b"), rank: 40 },
    ],
    seasons: SEASONS,
  });

  const replay = await runReplay(supabase);

  assert.deepEqual(replay.events.map((e) => [e.race_id, e.rider_id]), [["r-senior", "rider-a"]]);
  assert.equal(replay.youthResults, 1);
  assert.deepEqual([...replay.youthRaceIds], ["r-u23"]);
  assert.equal(replay.skippedResults, 0);
  assert.equal(replay.unknownRaceIds.size, 0);
  assert.equal(replay.activeSeason?.number, 3);
});
