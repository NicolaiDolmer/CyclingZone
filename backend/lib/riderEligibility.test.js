// backend/lib/riderEligibility.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  isEligibleRider, filterEligibleEntries, applyRiderEligibilityFilter,
  isRiderInjured, applyInjuredFilter, filterOutInjuredEntries,
  raceSelectionReferenceDateStr,
} from "./riderEligibility.js";

test("isEligibleRider: senior på holdet er berettiget", () => {
  assert.equal(isEligibleRider({ team_id: "t1", is_academy: false, is_retired: false }, { teamId: "t1" }), true);
  // null-flag = aldrig sat = aktiv
  assert.equal(isEligibleRider({ team_id: "t1", is_academy: null, is_retired: null }, { teamId: "t1" }), true);
});

test("isEligibleRider: akademi, pensioneret og off-team afvises", () => {
  assert.equal(isEligibleRider({ team_id: "t1", is_academy: true, is_retired: false }, { teamId: "t1" }), false);
  assert.equal(isEligibleRider({ team_id: "t1", is_academy: false, is_retired: true }, { teamId: "t1" }), false);
  // solgt videre: rytterens nuværende team ≠ entry'ens team
  assert.equal(isEligibleRider({ team_id: "t2", is_academy: false, is_retired: false }, { teamId: "t1" }), false);
  // fyret/free agent: team_id null
  assert.equal(isEligibleRider({ team_id: null, is_academy: false, is_retired: false }, { teamId: "t1" }), false);
});

test("isEligibleRider: manglende rytter → false; uden teamId springes team-tjek over", () => {
  assert.equal(isEligibleRider(null, { teamId: "t1" }), false);
  assert.equal(isEligibleRider(undefined), false);
  assert.equal(isEligibleRider({ team_id: "t2", is_academy: false, is_retired: false }), true); // kun status
});

test("filterEligibleEntries: ghost-entries (akademi/pensioneret/off-team/slettet) falder ud", () => {
  const ridersById = new Map([
    ["ok", { team_id: "t1", is_academy: false, is_retired: false }],
    ["academy", { team_id: "t1", is_academy: true, is_retired: false }],
    ["retired", { team_id: "t1", is_academy: false, is_retired: true }],
    ["sold", { team_id: "t2", is_academy: false, is_retired: false }],
    // "deleted" findes ikke i map
  ]);
  const entries = [
    { rider_id: "ok", team_id: "t1" },
    { rider_id: "academy", team_id: "t1" },
    { rider_id: "retired", team_id: "t1" },
    { rider_id: "sold", team_id: "t1" }, // entry siger t1, men rytteren er på t2
    { rider_id: "deleted", team_id: "t1" },
  ];
  const live = filterEligibleEntries({ entries, ridersById });
  assert.deepEqual(live.map((e) => e.rider_id), ["ok"]);
});

// #3896: kanonisk skades-predikat.
test("isRiderInjured: injured_until >= i dag = skadet; fortid/null = rask", () => {
  assert.equal(isRiderInjured("2026-08-25", "2026-08-21"), true);
  // samme dag tæller stadig som skadet (>=, ikke >)
  assert.equal(isRiderInjured("2026-08-21", "2026-08-21"), true);
  assert.equal(isRiderInjured("2026-08-20", "2026-08-21"), false);
  assert.equal(isRiderInjured(null, "2026-08-21"), false);
  assert.equal(isRiderInjured(undefined, "2026-08-21"), false);
});

test("applyInjuredFilter: kæder .gte(injured_until, todayStr) på query'en", () => {
  const calls = [];
  const q = { gte(col, val) { calls.push(["gte", col, val]); return q; } };
  const out = applyInjuredFilter(q, "2026-08-21");
  assert.equal(out, q, "returnerer query'en (kædebar)");
  assert.deepEqual(calls, [["gte", "injured_until", "2026-08-21"]]);
});

test("filterOutInjuredEntries: skadede committede entries falder ud; raske/udløbet skade/ingen condition-række består", () => {
  const injuredUntilByRider = new Map([
    ["hurt", "2026-08-25"], // stadig skadet
    ["healed", "2026-08-10"], // skaden er udløbet
    // "no-condition" mangler bevidst — Map.get() → undefined
  ]);
  const entries = [
    { rider_id: "hurt", team_id: "t1" },
    { rider_id: "healed", team_id: "t1" },
    { rider_id: "no-condition", team_id: "t1" },
  ];
  const live = filterOutInjuredEntries({ entries, injuredUntilByRider, todayStr: "2026-08-21" });
  assert.deepEqual(live.map((e) => e.rider_id), ["healed", "no-condition"]);
});

// #4701 (ejer-bekræftet 2/9): skadesstatus for udtagelse skal vurderes mod LØBETS
// startdato, ikke "nu" — en rytter skadet i dag skal kunne udtages til et løb der
// starter EFTER skaden er udløbet.
test("raceSelectionReferenceDateStr: løb i fremtiden → løbets EGEN startdato (ikke i dag)", () => {
  const race = { scheduled_for: "2026-09-20T12:00:00Z" }; // langt efter todayStr
  assert.equal(raceSelectionReferenceDateStr(race, "2026-09-03"), "2026-09-20");
});

test("raceSelectionReferenceDateStr: manglende scheduled_for (kalender ikke materialiseret) → falder tilbage til i dag", () => {
  assert.equal(raceSelectionReferenceDateStr({ scheduled_for: null }, "2026-09-03"), "2026-09-03");
  assert.equal(raceSelectionReferenceDateStr({}, "2026-09-03"), "2026-09-03");
});

test("raceSelectionReferenceDateStr: en løbsdato FØR i dag (degenereret tilfælde) gør aldrig en rask rytter skadet igen — max(i dag, løbsdato)", () => {
  const race = { scheduled_for: "2026-08-01T12:00:00Z" };
  assert.equal(raceSelectionReferenceDateStr(race, "2026-09-03"), "2026-09-03");
});

// Integrationen af de to: en rytter skadet 2/9-10/9 må IKKE afvises for et løb der
// starter 20/9 (referencedatoen er løbets, ikke dagens), men SKAL stadig afvises
// for et løb der starter 5/9 (stadig inden for skadesperioden).
test("raceSelectionReferenceDateStr + isRiderInjured: rytter skadet til 10/9 er valgbar til løb 20/9, ikke til løb 5/9", () => {
  const injuredUntil = "2026-09-10";
  const todayStr = "2026-09-03";
  const futureRace = { scheduled_for: "2026-09-20T12:00:00Z" };
  const soonRace = { scheduled_for: "2026-09-05T12:00:00Z" };
  assert.equal(isRiderInjured(injuredUntil, raceSelectionReferenceDateStr(futureRace, todayStr)), false);
  assert.equal(isRiderInjured(injuredUntil, raceSelectionReferenceDateStr(soonRace, todayStr)), true);
});

test("applyRiderEligibilityFilter: kæder akademi- + pensioneret- + ikke-under-handel-filter på query'en", () => {
  const calls = [];
  const q = {
    eq(col, val) { calls.push(["eq", col, val]); return q; },
    or(expr) { calls.push(["or", expr]); return q; },
    is(col, val) { calls.push(["is", col, val]); return q; },
  };
  const out = applyRiderEligibilityFilter(q);
  assert.equal(out, q, "returnerer query'en (kædebar)");
  assert.deepEqual(calls, [
    ["eq", "is_academy", false],
    ["or", "is_retired.is.null,is_retired.eq.false"],
    ["is", "pending_team_id", null],
  ]);
});
