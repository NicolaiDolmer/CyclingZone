// Tests for race field integrity guards (#1844 engine-frys, #1845 runtime-binding).
// Rene funktioner — ingen DB. RED-first.
import test from "node:test";
import assert from "node:assert/strict";
import { freezeEntrantsToStartField, excludeBoundRiders, filterEntriesToRaceDivision, filterTeamsBelowMinimumEntries } from "./raceFieldIntegrity.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

// ── #1844: feltet må ikke ændre sig mellem etaper ──────────────────────────────
test("freezeEntrantsToStartField udelukker en rytter der IKKE var med fra start (mid-race-intruder)", () => {
  // C kom ind midt i løbet (ikke i etape-1-snapshot) → må ikke simuleres i GC.
  const entrants = [
    { rider_id: "A", team_id: "t1" },
    { rider_id: "B", team_id: "t1" },
    { rider_id: "C", team_id: "t2" }, // intruder
  ];
  const { frozen, added, missing } = freezeEntrantsToStartField(entrants, ["A", "B"]);
  assert.deepEqual(frozen.map((e) => e.rider_id), ["A", "B"], "kun start-feltet simuleres");
  assert.deepEqual(added, ["C"], "intruderen rapporteres som tilføjet");
  assert.deepEqual(missing, [], "ingen mangler");
});

test("freezeEntrantsToStartField rapporterer en rytter fra start-feltet der er forsvundet", () => {
  // D var med fra start men er væk nu (fjernet/slettet) → skal surfaces, ikke skjules.
  const entrants = [
    { rider_id: "A", team_id: "t1" },
    { rider_id: "B", team_id: "t1" },
  ];
  const { frozen, added, missing } = freezeEntrantsToStartField(entrants, ["A", "B", "D"]);
  assert.deepEqual(frozen.map((e) => e.rider_id).sort(), ["A", "B"]);
  assert.deepEqual(added, [], "ingen tilføjede");
  assert.deepEqual(missing, ["D"], "den forsvundne start-rytter rapporteres");
});

test("freezeEntrantsToStartField uden snapshot (null/tom) lader feltet uændret", () => {
  const entrants = [{ rider_id: "A" }, { rider_id: "B" }];
  const r1 = freezeEntrantsToStartField(entrants, null);
  const r2 = freezeEntrantsToStartField(entrants, []);
  assert.equal(r1.frozen.length, 2, "null-snapshot = ingen frysning (etape 1 / legacy)");
  assert.equal(r2.frozen.length, 2, "tom snapshot = ingen frysning");
});

// ── #1845: runtime auto-fill må ikke dobbeltbooke ──────────────────────────────
test("excludeBoundRiders fjerner ryttere bundet til et OVERLAPPENDE løb", () => {
  const riders = [{ rider_id: "r1" }, { rider_id: "r2" }, { rider_id: "r3" }];
  // r1 er bundet i et løb hvis dag-vindue overlapper dette løbs vindue (samme dag).
  const thisWindow = { start: 100, end: 100 };
  const otherRaces = [
    { window: { start: 100, end: 100 }, riderIds: ["r1"] }, // overlapper → r1 ekskluderes
    { window: { start: 200, end: 200 }, riderIds: ["r2"] }, // overlapper IKKE → r2 beholdes
  ];
  const available = excludeBoundRiders({ riders, thisWindow, otherRaces });
  assert.deepEqual(available.map((r) => r.rider_id), ["r2", "r3"], "kun r1 (samme-dags-bundet) fjernes");
});

test("excludeBoundRiders uden vindue/binding lader feltet uændret", () => {
  const riders = [{ rider_id: "r1" }, { rider_id: "r2" }];
  assert.equal(excludeBoundRiders({ riders, thisWindow: null, otherRaces: [] }).length, 2);
  assert.equal(excludeBoundRiders({ riders, thisWindow: { start: 1, end: 1 }, otherRaces: [] }).length, 2);
});

// ── #1846: cross-division stale entries (efter op/nedrykning) ───────────────────
test("filterEntriesToRaceDivision dropper entries fra hold i en ANDEN division", () => {
  // Hold tA er i løbets division (6); tB flyttede til division 4 → stale entry skal væk.
  const entries = [
    { rider_id: "r1", team_id: "tA" },
    { rider_id: "r2", team_id: "tB" }, // stale: tB er nu i div 4
  ];
  const teamDivisionById = new Map([["tA", 6], ["tB", 4]]);
  const kept = filterEntriesToRaceDivision({ entries, teamDivisionById, raceDivisionId: 6 });
  assert.deepEqual(kept.map((e) => e.team_id), ["tA"], "kun hold i løbets egen division beholdes");
});

test("filterEntriesToRaceDivision uden løbs-division (null) lader alt stå", () => {
  const entries = [{ rider_id: "r1", team_id: "tA" }, { rider_id: "r2", team_id: "tB" }];
  const teamDivisionById = new Map([["tA", 6], ["tB", 4]]);
  assert.equal(filterEntriesToRaceDivision({ entries, teamDivisionById, raceDivisionId: null }).length, 2);
});

test("filterEntriesToRaceDivision beholder entries med ukendt holds-division (konservativt)", () => {
  // Manglende division-data → drop IKKE (undgå at fjerne legit entries pga. fejlet opslag).
  const entries = [{ rider_id: "r1", team_id: "tA" }, { rider_id: "r2", team_id: "tUnknown" }];
  const teamDivisionById = new Map([["tA", 6]]);
  const kept = filterEntriesToRaceDivision({ entries, teamDivisionById, raceDivisionId: 6 });
  assert.deepEqual(kept.map((e) => e.team_id).sort(), ["tA", "tUnknown"]);
});

// ── #4295: gulvet — mindst 6 udtagne for at stille op (ejer-beslutning 27/8) ────
function team(teamId, n) {
  return Array.from({ length: n }, (_, i) => ({ rider_id: `${teamId}-r${i}`, team_id: teamId }));
}

test("filterTeamsBelowMinimumEntries: hold under gulvet ryger HELT ud, hold på gulvet bliver", () => {
  const entries = [...team("tFull", MIN_RACE_ENTRIES), ...team("tShort", MIN_RACE_ENTRIES - 1)];
  const { kept, droppedTeamIds } = filterTeamsBelowMinimumEntries({ entries });
  assert.deepEqual(droppedTeamIds, ["tShort"], "kun holdet under gulvet droppes");
  assert.deepEqual([...new Set(kept.map((e) => e.team_id))], ["tFull"]);
  assert.equal(kept.length, MIN_RACE_ENTRIES, "det korte holds ryttere er VÆK, ikke bare talt ned");
});

test("filterTeamsBelowMinimumEntries: gulvet er fladt — 6 er nok selv når feltet er 8", () => {
  // GT-feltet er 8 (SELECTION_SIZE.TourFrance), men gulvet er og bliver 6.
  const entries = team("tSix", 6);
  const { kept, droppedTeamIds } = filterTeamsBelowMinimumEntries({ entries });
  assert.deepEqual(droppedTeamIds, []);
  assert.equal(kept.length, 6);
});

test("filterTeamsBelowMinimumEntries: en dublet-række løfter ikke et hold over gulvet", () => {
  const entries = [...team("tDup", MIN_RACE_ENTRIES - 1), { rider_id: "tDup-r0", team_id: "tDup" }];
  const { droppedTeamIds } = filterTeamsBelowMinimumEntries({ entries });
  assert.deepEqual(droppedTeamIds, ["tDup"], "unikke ryttere tæller, ikke rækker");
});

test("filterTeamsBelowMinimumEntries: tomt felt og tom input er stabile", () => {
  assert.deepEqual(filterTeamsBelowMinimumEntries({ entries: [] }), { kept: [], droppedTeamIds: [] });
  const all = [...team("tA", 2), ...team("tB", 3)];
  const { kept, droppedTeamIds } = filterTeamsBelowMinimumEntries({ entries: all });
  assert.deepEqual(kept, [], "er ALLE hold under gulvet, står der ingen på startlisten");
  assert.deepEqual(droppedTeamIds.sort(), ["tA", "tB"]);
});
