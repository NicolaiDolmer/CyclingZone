// backend/lib/riderEligibility.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  isEligibleRider, filterEligibleEntries, applyRiderEligibilityFilter, applyRosterVisibilityFilter,
  isRiderInjured, applyInjuredFilter, filterOutInjuredEntries,
  raceSelectionReferenceDateStr,
  ANY_SQUAD, raceSquadOf,
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
  // #4619: trup-leddet kommer nu fra squads.applySeniorSquadFilter og spørger på
  // BEGGE kolonner i overgangsperioden (squad='senior' OG is_academy=false) — se
  // seniorSquadFilter.test.js for hvorfor is_academy-leddet ikke må fjernes endnu.
  assert.deepEqual(calls, [
    ["eq", "squad", "senior"],
    ["eq", "is_academy", false],
    ["or", "is_retired.is.null,is_retired.eq.false"],
    ["is", "pending_team_id", null],
  ]);
});

// #4119: de to filtre skal skilles ad — synlighed vs. udtagelse.
test("applyRosterVisibilityFilter: akademi + pensioneret, men IKKE pending_team_id", () => {
  const calls = [];
  const q = {
    eq(col, val) { calls.push(["eq", col, val]); return q; },
    or(expr) { calls.push(["or", expr]); return q; },
    is(col, val) { calls.push(["is", col, val]); return q; },
  };
  const out = applyRosterVisibilityFilter(q);
  assert.equal(out, q, "returnerer query'en (kædebar)");
  assert.deepEqual(calls, [
    ["eq", "squad", "senior"],
    ["eq", "is_academy", false],
    ["or", "is_retired.is.null,is_retired.eq.false"],
  ], "en solgt rytter med parkeret holdskifte skal stadig VISES i truppen (#4119)");
});

// ── #5645 (Y4): trup-parameteren ─────────────────────────────────────────────
function recordingQuery() {
  const calls = [];
  const q = {
    eq(col, val) { calls.push(["eq", col, val]); return q; },
    or(expr) { calls.push(["or", expr]); return q; },
    is(col, val) { calls.push(["is", col, val]); return q; },
  };
  return { q, calls };
}

test("#5645 applyRiderEligibilityFilter: squad 'senior' eksplicit = samme kæde som uden argument", () => {
  const a = recordingQuery();
  const b = recordingQuery();
  applyRiderEligibilityFilter(a.q);
  applyRiderEligibilityFilter(b.q, { squad: "senior" });
  assert.deepEqual(b.calls, a.calls);
});

test("#5645 applyRiderEligibilityFilter: U23 spørger kun på squad='u23' (intet senior-led)", () => {
  const { q, calls } = recordingQuery();
  applyRiderEligibilityFilter(q, { squad: "u23" });
  assert.deepEqual(calls, [
    ["eq", "squad", "u23"],
    ["or", "is_retired.is.null,is_retired.eq.false"],
    ["is", "pending_team_id", null],
  ]);
});

test("#5645 applyRosterVisibilityFilter: junior-trup, og en ukendt trup kaster (fejl lukket)", () => {
  const { q, calls } = recordingQuery();
  applyRosterVisibilityFilter(q, { squad: "junior" });
  assert.deepEqual(calls, [["eq", "squad", "junior"], ["or", "is_retired.is.null,is_retired.eq.false"]]);
  assert.throws(() => applyRosterVisibilityFilter(recordingQuery().q, { squad: "academy" }), /ukendt trup/);
  assert.throws(() => applyRosterVisibilityFilter(recordingQuery().q, { squad: ANY_SQUAD }), /ukendt trup/);
});

test("#5645 isEligibleRider: ungdomsløb kræver rytterens trup = løbets trup", () => {
  const u23 = { team_id: "t1", squad: "u23", is_academy: true, is_retired: false };
  const senior = { team_id: "t1", squad: "senior", is_academy: false, is_retired: false };
  const noSquad = { team_id: "t1", is_academy: true, is_retired: false };
  assert.equal(isEligibleRider(u23, { teamId: "t1", squad: "u23" }), true);
  assert.equal(isEligibleRider(senior, { teamId: "t1", squad: "u23" }), false, "senior aldrig i et U23-løb");
  assert.equal(isEligibleRider(u23, { teamId: "t1", squad: "junior" }), false);
  assert.equal(isEligibleRider(noSquad, { teamId: "t1", squad: "u23" }), false, "manglende squad = ikke berettiget");
  assert.equal(isEligibleRider({ ...u23, is_retired: true }, { teamId: "t1", squad: "u23" }), false);
  assert.equal(isEligibleRider(u23, { teamId: "t2", squad: "u23" }), false);
  // Default (senior) er uændret: U23-rytteren er ikke berettiget til et seniorløb.
  assert.equal(isEligibleRider(u23, { teamId: "t1" }), false);
  assert.equal(isEligibleRider(senior, { teamId: "t1" }), true);
});

test("#5645 isEligibleRider: ANY_SQUAD springer kun trup-leddet over (binding)", () => {
  const u23 = { team_id: "t1", squad: "u23", is_academy: true, is_retired: false };
  assert.equal(isEligibleRider(u23, { teamId: "t1", squad: ANY_SQUAD }), true);
  assert.equal(isEligibleRider({ ...u23, team_id: "t2" }, { teamId: "t1", squad: ANY_SQUAD }), false);
  assert.equal(isEligibleRider({ ...u23, is_retired: true }, { teamId: "t1", squad: ANY_SQUAD }), false);
});

test("#5645 filterEligibleEntries: trup-parameteren sendes videre, default senior", () => {
  const ridersById = new Map([
    ["s", { id: "s", team_id: "t1", squad: "senior", is_academy: false, is_retired: false }],
    ["u", { id: "u", team_id: "t1", squad: "u23", is_academy: true, is_retired: false }],
  ]);
  const entries = [{ rider_id: "s", team_id: "t1" }, { rider_id: "u", team_id: "t1" }];
  assert.deepEqual(filterEligibleEntries({ entries, ridersById }).map((e) => e.rider_id), ["s"]);
  assert.deepEqual(filterEligibleEntries({ entries, ridersById, squad: "u23" }).map((e) => e.rider_id), ["u"]);
});

test("#5645 raceSquadOf: manglende/ukendt trup = senior", () => {
  assert.equal(raceSquadOf({ squad: "u23" }), "u23");
  assert.equal(raceSquadOf({ squad: "junior" }), "junior");
  assert.equal(raceSquadOf({ squad: "senior" }), "senior");
  assert.equal(raceSquadOf({}), "senior");
  assert.equal(raceSquadOf({ squad: null }), "senior");
  assert.equal(raceSquadOf(null), "senior");
});

test("#5645 (ejer 24/9): 16-årig i juniortruppen er løbsberettiget — ingen separat aldersgate", () => {
  // En 16-årig (fx sæsonalder 16, YOUTH_RULES §2.1) er berettiget alene på trup-medlemskab.
  const junior16 = { id: "j16", team_id: "t1", squad: "junior", is_academy: true, is_retired: false, birthdate: "2013-12-31" };
  assert.equal(isEligibleRider(junior16, { teamId: "t1", squad: "junior" }), true);
  const entries = [{ rider_id: "j16", team_id: "t1" }];
  const ridersById = new Map([["j16", junior16]]);
  assert.deepEqual(filterEligibleEntries({ entries, ridersById, squad: "junior" }).map((e) => e.rider_id), ["j16"]);
});

test("#5645 (ejer 24/9): seniorer må stadig ikke køre ungdomsløb", () => {
  const senior = { id: "s1", team_id: "t1", squad: "senior", is_academy: false, is_retired: false };
  assert.equal(isEligibleRider(senior, { teamId: "t1", squad: "junior" }), false);
  assert.equal(isEligibleRider(senior, { teamId: "t1", squad: "u23" }), false);
});
