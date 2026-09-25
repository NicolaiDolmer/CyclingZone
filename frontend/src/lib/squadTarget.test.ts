// #5748: pinner flyt-dialogens trup-regel mod YOUTH_RULES.md §2 (ejer 2/9, LÅST):
// "opad altid tilladt, nedad kun inden for aldersloftet", og mod backend
// moveRider()/squads.js (samme grænser, samme retningsbegreb).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  U23_MAX_SEASON_AGE, MOVE_SQUAD_ORDER, squadForSeasonAge, currentSquadOf, squadMoveDirection,
  fitsSquadAge, isAgeAllowedMove, hasMoveTarget, moveSquadRows, defaultMoveTarget,
  type SquadPlaces, type Squad,
} from "./squadTarget.ts";
import { JUNIOR_MAX_SEASON_AGE, SQUAD_CAPS } from "./squadCaps.ts";

const ROOM: Record<Squad, SquadPlaces> = {
  senior: { used: 21, max: 30 },
  u23: { used: 0, max: SQUAD_CAPS.u23 },
  junior: { used: 1, max: SQUAD_CAPS.junior },
};

function states(rows: ReturnType<typeof moveSquadRows>) {
  return Object.fromEntries(rows.map((r) => [r.squad, `${r.state}/${r.hint}`]));
}

test("squadForSeasonAge: junior <= 18, U23 19-22, senior 23+, null ved ukendt alder", () => {
  assert.equal(squadForSeasonAge(16), "junior");
  assert.equal(squadForSeasonAge(JUNIOR_MAX_SEASON_AGE), "junior");
  assert.equal(squadForSeasonAge(JUNIOR_MAX_SEASON_AGE + 1), "u23");
  assert.equal(squadForSeasonAge(U23_MAX_SEASON_AGE), "u23");
  assert.equal(squadForSeasonAge(U23_MAX_SEASON_AGE + 1), "senior");
  assert.equal(squadForSeasonAge(null), null);
  assert.equal(squadForSeasonAge(Number.NaN), null);
});

test("currentSquadOf: riders.squad ejer sandheden; akademirytter uden trup falder på alderen", () => {
  assert.equal(currentSquadOf({ squad: "u23", is_academy: true }, 17), "u23", "17-årig på U23 (opad) forbliver U23");
  assert.equal(currentSquadOf({ squad: "senior", is_academy: false }, 17), "senior");
  assert.equal(currentSquadOf({ squad: null, is_academy: true }, 17), "junior");
  assert.equal(currentSquadOf({ squad: null, is_academy: true }, 20), "u23");
  assert.equal(currentSquadOf({ squad: null, is_academy: true }, 25), "u23", "ældre akademirytter står i U23 som backend");
  assert.equal(currentSquadOf({ squad: null, is_academy: true }, null), "junior");
  assert.equal(currentSquadOf({ squad: null, is_academy: false }, 17), "senior");
  assert.equal(currentSquadOf(null, 17), "senior");
});

test("retning og aldersloft: opad frit, nedad kun inden for loftet", () => {
  assert.equal(squadMoveDirection("junior", "u23"), "up");
  assert.equal(squadMoveDirection("senior", "junior"), "down");
  assert.equal(squadMoveDirection("u23", "u23"), "none");
  assert.equal(fitsSquadAge("senior", null), true);
  assert.equal(fitsSquadAge("junior", 19), false);
  assert.equal(fitsSquadAge("u23", null), false);

  assert.equal(isAgeAllowedMove("junior", "senior", 16), true);
  assert.equal(isAgeAllowedMove("junior", "u23", 16), true);
  assert.equal(isAgeAllowedMove("u23", "junior", 17), true);
  assert.equal(isAgeAllowedMove("u23", "junior", 19), false);
  assert.equal(isAgeAllowedMove("senior", "u23", 23), false);
  assert.equal(isAgeAllowedMove("senior", "senior", 20), false);
});

test("hasMoveTarget: senior 23+ har intet mål; alle ungdomsryttere kan altid op i senior", () => {
  assert.equal(hasMoveTarget("senior", 23), false);
  assert.equal(hasMoveTarget("senior", null), false);
  assert.equal(hasMoveTarget("senior", 22), true);
  assert.equal(hasMoveTarget("u23", 22), true);
  assert.equal(hasMoveTarget("junior", 16), true);
});

test("moveSquadRows: senior-rytter i junior-alder ser alle tre rækker (mockup-sag 1)", () => {
  const rows = moveSquadRows({ currentSquad: "senior", seasonAge: 17, places: ROOM });
  assert.deepEqual(rows.map((r) => r.squad), [...MOVE_SQUAD_ORDER]);
  assert.deepEqual(states(rows), { senior: "current/current", u23: "open/upward", junior: "open/natural" });
  assert.deepEqual(rows[1], { squad: "u23", state: "open", hint: "upward", used: 0, max: SQUAD_CAPS.u23, maxAge: U23_MAX_SEASON_AGE });
  assert.equal(defaultMoveTarget(rows, "senior", 17), "junior", "forvalget er hans naturlige ungdomstrup");
});

test("moveSquadRows: juniorrytter (16) kan gå til U23 og senior; forvalget er U23 (mockup-sag 2)", () => {
  const rows = moveSquadRows({ currentSquad: "junior", seasonAge: 16, places: ROOM });
  assert.deepEqual(states(rows), { senior: "open/seniorPlace", u23: "open/upward", junior: "current/current" });
  assert.equal(defaultMoveTarget(rows, "junior", 16), "u23");
});

test("moveSquadRows: 19-årig senior ser Junior i gråt med grunden (mockup-sag 3)", () => {
  const rows = moveSquadRows({ currentSquad: "senior", seasonAge: 19, places: ROOM });
  assert.deepEqual(states(rows), { senior: "current/current", u23: "open/natural", junior: "tooOld/tooOld" });
  assert.equal(rows[2].maxAge, JUNIOR_MAX_SEASON_AGE);
  assert.equal(defaultMoveTarget(rows, "senior", 19), "u23");
});

test("moveSquadRows: fuld trup er grå med grunden; forvalget springer den over", () => {
  const full = { ...ROOM, junior: { used: SQUAD_CAPS.junior, max: SQUAD_CAPS.junior } };
  const rows = moveSquadRows({ currentSquad: "senior", seasonAge: 17, places: full });
  assert.equal(states(rows).junior, "full/full");
  assert.equal(defaultMoveTarget(rows, "senior", 17), "u23", "naturlig trup fuld: den anden åbne ungdomstrup");

  const allFull = moveSquadRows({
    currentSquad: "senior", seasonAge: 17,
    places: { ...full, u23: { used: SQUAD_CAPS.u23, max: SQUAD_CAPS.u23 } },
  });
  assert.equal(defaultMoveTarget(allFull, "senior", 17), null, "intet åbent mål: intet forvalg");
});

test("moveSquadRows: ukendt pladstal er aldrig fuld (backend er den autoritative gate)", () => {
  const rows = moveSquadRows({ currentSquad: "junior", seasonAge: 16, places: { u23: { used: null, max: null } } });
  assert.equal(states(rows).u23, "open/upward");
  assert.equal(rows[1].used, null);
});

test("defaultMoveTarget: U23-rytter der er for gammel til junior får senior som forvalg", () => {
  const rows = moveSquadRows({ currentSquad: "u23", seasonAge: 21, places: ROOM });
  assert.deepEqual(states(rows), { senior: "open/seniorPlace", u23: "current/current", junior: "tooOld/tooOld" });
  assert.equal(defaultMoveTarget(rows, "u23", 21), "senior");
});

test("24-årig senior: kun senior, begge ungdomsrækker grå (og ingen knap, jf. hasMoveTarget)", () => {
  const rows = moveSquadRows({ currentSquad: "senior", seasonAge: 24, places: ROOM });
  assert.deepEqual(states(rows), { senior: "current/current", u23: "tooOld/tooOld", junior: "tooOld/tooOld" });
  assert.equal(defaultMoveTarget(rows, "senior", 24), null);
});
