// Tests for backend/lib/squads.js (#4619, slice 1).
//
// De to ting der SKAL være låst her:
//   1) Aldersgrænserne (junior ≤ 18 · u23 19-22 · senior ≥ 23) — de er ejer-låste
//      strukturregler (YOUTH_RULES §2.1), ikke et implementationsvalg.
//   2) At aldersformlen aldrig duplikeres: squadForSeason SKAL give samme svar som
//      ageForSeason + squadForSeasonAge hver for sig. Det er forward-guarden mod
//      præcis den fejlklasse #3071/#3081 var.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SQUADS, DEFAULT_SQUAD, SQUAD_CAPS, SQUAD_MAX_AGE, SQUAD_TRANSITIONS,
  isSquad, isYouthSquad, squadForSeasonAge, squadForSeason, squadForReferenceYear,
  capForSquad, wouldExceedSquadCap, hasOutgrownSquad, transitionForRider,
} from "./squads.js";
import { ageForSeason, LAUNCH_REFERENCE_YEAR } from "./riderSeasonAge.js";

test("SQUADS + DEFAULT_SQUAD matcher migrationens CHECK-constraint", () => {
  assert.deepEqual([...SQUADS].sort(), ["junior", "senior", "u23"]);
  assert.equal(DEFAULT_SQUAD, "senior");
  assert.ok(Object.isFrozen(SQUADS));
});

test("SQUAD_CAPS: U23 = 12, junior = 10 (ejer 15/9 §10.6 + YOUTH_RULES §2.4)", () => {
  assert.equal(SQUAD_CAPS.u23, 12);
  assert.equal(SQUAD_CAPS.junior, 10);
  assert.equal(capForSquad("u23"), 12);
  assert.equal(capForSquad("junior"), 10);
});

test("senior har INTET eget loft her — divisionens squad_limits.max ejer den cap", () => {
  assert.equal(capForSquad("senior"), null);
  assert.equal("senior" in SQUAD_CAPS, false);
  // Og dermed: senior er aldrig "fuld" efter denne fil.
  assert.equal(wouldExceedSquadCap({ squad: "senior", currentCount: 999 }), false);
});

test("squadForSeasonAge: graenserne 18/19 og 22/23", () => {
  assert.equal(squadForSeasonAge(16), "junior");
  assert.equal(squadForSeasonAge(18), "junior");
  assert.equal(squadForSeasonAge(19), "u23");
  assert.equal(squadForSeasonAge(22), "u23");
  assert.equal(squadForSeasonAge(23), "senior");
  assert.equal(squadForSeasonAge(35), "senior");
});

test("squadForSeasonAge: ukendt alder giver null, ikke et gaet", () => {
  for (const bad of [null, undefined, NaN, "19", {}]) {
    assert.equal(squadForSeasonAge(bad), null, `${String(bad)} skal give null`);
  }
});

test("SQUAD_MAX_AGE spejler graenserne (senior har ingen oevre graense)", () => {
  assert.equal(SQUAD_MAX_AGE.junior, 18);
  assert.equal(SQUAD_MAX_AGE.u23, 22);
  assert.equal(SQUAD_MAX_AGE.senior, null);
});

test("isSquad / isYouthSquad", () => {
  assert.equal(isSquad("u23"), true);
  assert.equal(isSquad("academy"), false);
  assert.equal(isSquad(null), false);
  // isYouthSquad ER praecis det praedikat is_academy bar.
  assert.equal(isYouthSquad("junior"), true);
  assert.equal(isYouthSquad("u23"), true);
  assert.equal(isYouthSquad("senior"), false);
  assert.equal(isYouthSquad("nonsense"), false);
});

test("FORWARD-GUARD: squadForSeason duplikerer ikke aldersformlen", () => {
  // Hvis nogen en dag skriver `LAUNCH_REFERENCE_YEAR + (n-1) - birthYear` inde i
  // squads.js i stedet for at kalde ageForSeason, faelder denne test det kun hvis
  // de to divergerer. Vi tester derfor over et helt spektrum af fodselsaar.
  for (let season = 1; season <= 6; season++) {
    for (let age = 14; age <= 40; age++) {
      const birthYear = LAUNCH_REFERENCE_YEAR + (season - 1) - age;
      const birthdate = `${birthYear}-06-15`;
      assert.equal(ageForSeason(birthdate, season), age, "testens egen aldersantagelse");
      assert.equal(
        squadForSeason(birthdate, season),
        squadForSeasonAge(ageForSeason(birthdate, season)),
        `sæson ${season}, alder ${age}`,
      );
    }
  }
});

test("squadForSeason: 1. januar-rytteren rammer samme trup uanset tidszone-faelde", () => {
  // riderSeasonAge's DATE_ONLY-sti. En 19-aarig foedt 1. januar skal vaere u23,
  // ikke junior (den fejl #3071-klassen ville give vest for UTC).
  const birthdate = `${LAUNCH_REFERENCE_YEAR + 2 - 19}-01-01`;
  assert.equal(squadForSeason(birthdate, 3), "u23");
});

test("squadForReferenceYear: aarstal-indgangen giver samme svar som saesonnummeret", () => {
  const birthdate = "2005-03-02";
  assert.equal(
    squadForReferenceYear(birthdate, LAUNCH_REFERENCE_YEAR + 2),
    squadForSeason(birthdate, 3),
  );
});

test("squadForSeason/squadForReferenceYear: manglende input giver null", () => {
  assert.equal(squadForSeason(null, 3), null);
  assert.equal(squadForSeason("2005-03-02", null), null);
  assert.equal(squadForReferenceYear(null, 2028), null);
  assert.equal(squadForReferenceYear("2005-03-02", null), null);
});

test("wouldExceedSquadCap: loftet er inklusivt (12. rytter er tilladt, 13. ikke)", () => {
  assert.equal(wouldExceedSquadCap({ squad: "u23", currentCount: 11 }), false);
  assert.equal(wouldExceedSquadCap({ squad: "u23", currentCount: 12 }), true);
  assert.equal(wouldExceedSquadCap({ squad: "junior", currentCount: 9 }), false);
  assert.equal(wouldExceedSquadCap({ squad: "junior", currentCount: 10 }), true);
  // adding > 1
  assert.equal(wouldExceedSquadCap({ squad: "junior", currentCount: 8, adding: 2 }), false);
  assert.equal(wouldExceedSquadCap({ squad: "junior", currentCount: 8, adding: 3 }), true);
});

test("wouldExceedSquadCap: ukendt trup blokerer ikke (cap haandhaeves et andet sted)", () => {
  assert.equal(wouldExceedSquadCap({ squad: "nonsense", currentCount: 500 }), false);
  assert.equal(wouldExceedSquadCap({}), false);
});

// ── De to overgange ──────────────────────────────────────────────────────────

test("SQUAD_TRANSITIONS: junior->u23 ved 19, u23->senior ved 23", () => {
  assert.deepEqual(
    SQUAD_TRANSITIONS.map((t) => [t.from, t.to, t.atSeasonAge]),
    [["junior", "u23", 19], ["u23", "senior", 23]],
  );
});

test("hasOutgrownSquad: junior vokser ud ved 19", () => {
  assert.equal(hasOutgrownSquad({ squad: "junior", seasonAge: 18 }), false);
  assert.equal(hasOutgrownSquad({ squad: "junior", seasonAge: 19 }), true);
});

test("hasOutgrownSquad: u23 vokser ud ved 23, IKKE ved 22 (regelaendring, YOUTH_RULES §2.2)", () => {
  assert.equal(hasOutgrownSquad({ squad: "u23", seasonAge: 22 }), false);
  assert.equal(hasOutgrownSquad({ squad: "u23", seasonAge: 23 }), true);
});

test("hasOutgrownSquad: senior vokser aldrig ud, ukendt alder giver false", () => {
  assert.equal(hasOutgrownSquad({ squad: "senior", seasonAge: 44 }), false);
  assert.equal(hasOutgrownSquad({ squad: "u23", seasonAge: null }), false);
  assert.equal(hasOutgrownSquad({ squad: "u23", seasonAge: undefined }), false);
});

test("transitionForRider: giver praecis den ene overgang rytteren staar foran", () => {
  assert.deepEqual(transitionForRider({ squad: "junior", seasonAge: 19 }), { from: "junior", to: "u23", atSeasonAge: 19 });
  assert.deepEqual(transitionForRider({ squad: "u23", seasonAge: 23 }), { from: "u23", to: "senior", atSeasonAge: 23 });
  assert.equal(transitionForRider({ squad: "u23", seasonAge: 22 }), null);
  assert.equal(transitionForRider({ squad: "senior", seasonAge: 99 }), null);
});

test("transitionForRider: en OVER-aldrende junior rykker ET trin, ikke to", () => {
  // Kun muligt via en fejl eller et manuelt flyt, men default-kaeden skal
  // behandle ham som en almindelig overgang i stedet for at springe u23 over.
  assert.deepEqual(transitionForRider({ squad: "junior", seasonAge: 25 }), { from: "junior", to: "u23", atSeasonAge: 19 });
});
