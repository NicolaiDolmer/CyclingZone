// #5742: pinner trup-navngivningen for demote-flowet (rytterprofil + My Team)
// mod YOUTH_RULES.md §2 (ejer 2/9, LÅST) — "opad altid tilladt, nedad kun
// inden for aldersloftet" — og mod backend/lib/squads.js' aldersgrænser.
import { test } from "node:test";
import assert from "node:assert/strict";

import { demoteNaturalTargetSquad, demoteSquadOptions, U23_MAX_SEASON_AGE } from "./squadTarget.ts";
import { JUNIOR_MAX_SEASON_AGE } from "./squadCaps.ts";

test("demoteNaturalTargetSquad: junior <= 18, u23 19-22, ellers null", () => {
  assert.equal(demoteNaturalTargetSquad(16), "junior");
  assert.equal(demoteNaturalTargetSquad(JUNIOR_MAX_SEASON_AGE), "junior"); // 18
  assert.equal(demoteNaturalTargetSquad(JUNIOR_MAX_SEASON_AGE + 1), "u23"); // 19
  assert.equal(demoteNaturalTargetSquad(U23_MAX_SEASON_AGE), "u23"); // 22
  assert.equal(demoteNaturalTargetSquad(U23_MAX_SEASON_AGE + 1), null); // 23 - ikke berettiget
  assert.equal(demoteNaturalTargetSquad(35), null);
});

test("demoteNaturalTargetSquad: ukendt/ugyldig alder giver null, aldrig et gæt", () => {
  assert.equal(demoteNaturalTargetSquad(null), null);
  assert.equal(demoteNaturalTargetSquad(undefined), null);
  assert.equal(demoteNaturalTargetSquad(NaN), null);
});

test("demoteSquadOptions: junior-alder viser BEGGE valg, junior som default (opad tilladt, #5742)", () => {
  const options = demoteSquadOptions(17);
  assert.deepEqual(options, [
    { squad: "junior", isDefault: true },
    { squad: "u23", isDefault: false },
  ]);
});

test("demoteSquadOptions: U23-alder viser kun U23 (nedad i junior ville bryde aldersloftet)", () => {
  assert.deepEqual(demoteSquadOptions(20), [{ squad: "u23", isDefault: true }]);
  assert.deepEqual(demoteSquadOptions(U23_MAX_SEASON_AGE), [{ squad: "u23", isDefault: true }]);
});

test("demoteSquadOptions: 23+ eller ukendt alder giver ingen valg (ikke berettiget)", () => {
  assert.deepEqual(demoteSquadOptions(23), []);
  assert.deepEqual(demoteSquadOptions(null), []);
});
