// backend/lib/riderEligibility.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { isEligibleRider, filterEligibleEntries, applyRiderEligibilityFilter } from "./riderEligibility.js";

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

test("isEligibleRider: udlånt rytter afvises for ejer-holdet (loan-aware)", () => {
  const loaned = new Set(["onLoan"]);
  // Udlånt rytter står stadig på ejer-holdet (team_id=t1, senior, aktiv) men er ude.
  assert.equal(
    isEligibleRider({ id: "onLoan", team_id: "t1", is_academy: false, is_retired: false }, { teamId: "t1", loanedOutRiderIds: loaned }),
    false
  );
  // Ikke-udlånt rytter på samme hold er stadig berettiget.
  assert.equal(
    isEligibleRider({ id: "home", team_id: "t1", is_academy: false, is_retired: false }, { teamId: "t1", loanedOutRiderIds: loaned }),
    true
  );
  // Uden loanedOutRiderIds → loan-tjek springes over (bagudkompatibelt).
  assert.equal(
    isEligibleRider({ id: "onLoan", team_id: "t1", is_academy: false, is_retired: false }, { teamId: "t1" }),
    true
  );
});

test("filterEligibleEntries: udlånte ryttere falder ud sammen med ghosts", () => {
  const ridersById = new Map([
    ["ok", { id: "ok", team_id: "t1", is_academy: false, is_retired: false }],
    ["loaned", { id: "loaned", team_id: "t1", is_academy: false, is_retired: false }],
  ]);
  const entries = [
    { rider_id: "ok", team_id: "t1" },
    { rider_id: "loaned", team_id: "t1" },
  ];
  const live = filterEligibleEntries({ entries, ridersById, loanedOutRiderIds: new Set(["loaned"]) });
  assert.deepEqual(live.map((e) => e.rider_id), ["ok"]);
});

test("applyRiderEligibilityFilter: kæder akademi- + pensioneret-filter på query'en", () => {
  const calls = [];
  const q = {
    eq(col, val) { calls.push(["eq", col, val]); return q; },
    or(expr) { calls.push(["or", expr]); return q; },
  };
  const out = applyRiderEligibilityFilter(q);
  assert.equal(out, q, "returnerer query'en (kædebar)");
  assert.deepEqual(calls, [
    ["eq", "is_academy", false],
    ["or", "is_retired.is.null,is_retired.eq.false"],
  ]);
});
