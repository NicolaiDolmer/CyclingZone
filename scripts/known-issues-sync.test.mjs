import { test } from "node:test";
import assert from "node:assert/strict";

import { liveRefs, planSync, parseArgs, formatPlan, loadPatches } from "./known-issues-sync.mjs";

const NOW = "2026-11-06T12:00:00.000Z";
const note = (rollout, refs) => ({ version: "1", changes: [{ rollout, refs }] });
const issue = (o) => ({ id: "aaaaaaaa-0000", issue_ref: 100, status: "confirmed", title_en: "Bug", ...o });

test("liveRefs: noter uden refs giver ingen issue-numre", () => {
  assert.deepEqual(liveRefs([note("live", undefined), note("live", []), { version: "2" }]), []);
});

test("liveRefs: kun rollout live tæller, flere refs og dubletter samles sorteret", () => {
  const patches = [
    note("live", [30, 10]),
    note("beta", [99]),
    note("beta_to_live", [98]),
    note("switched_on", [97]),
    note("live", [10, 20]),
  ];
  assert.deepEqual(liveRefs(patches), [10, 20, 30]);
});

test("liveRefs: ugyldige refs ignoreres", () => {
  assert.deepEqual(liveRefs([note("live", ["7", 0, -1, 1.5, 5])]), [5]);
});

test("planSync: ref uden kendt fejl giver tom plan", () => {
  assert.deepEqual(planSync({ refs: [555], issues: [issue({ issue_ref: 100 })], now: NOW }), []);
});

test("planSync: kendt fejl uden issue_ref røres ikke", () => {
  assert.deepEqual(planSync({ refs: [100], issues: [issue({ issue_ref: null })], now: NOW }), []);
});

test("planSync: åben række sættes til fixed med updated_at, closed_at overlades til triggeren", () => {
  const plan = planSync({ refs: [100], issues: [issue()], now: NOW });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].from, "confirmed");
  assert.deepEqual(plan[0].patch, { status: "fixed", updated_at: NOW });
});

test("planSync: alle åbne statusser tages, fixed og dismissed røres ikke (idempotent)", () => {
  const issues = [
    issue({ id: "1", status: "checking" }),
    issue({ id: "2", status: "confirmed" }),
    issue({ id: "3", status: "fixing" }),
    issue({ id: "4", status: "fixed" }),
    issue({ id: "5", status: "dismissed" }),
  ];
  const plan = planSync({ refs: [100], issues, now: NOW });
  assert.deepEqual(plan.map((p) => p.id), ["1", "2", "3"]);
});

test("planSync: kører man planen igen på resultatet, er den tom", () => {
  const first = planSync({ refs: [100], issues: [issue()], now: NOW });
  const after = [issue({ status: first[0].patch.status })];
  assert.deepEqual(planSync({ refs: [100], issues: after, now: NOW }), []);
});

test("planSync: flere refs flytter hver sin række, og samme række kun én gang", () => {
  const issues = [
    issue({ id: "a", issue_ref: 10 }),
    issue({ id: "b", issue_ref: 20 }),
    issue({ id: "c", issue_ref: 30 }),
    issue({ id: "a", issue_ref: 10 }),
  ];
  const plan = planSync({ refs: [10, 20], issues, now: NOW });
  assert.deepEqual(plan.map((p) => p.id), ["a", "b"]);
});

test("parseArgs: dry-run er default, --apply skriver, ukendt argument fejler", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--apply"]), { apply: true });
  assert.throws(() => parseArgs(["--issue", "5"]), /Ukendt argument/);
});

test("formatPlan: tom plan og linjer", () => {
  assert.match(formatPlan([]), /Ingen/);
  const [p] = planSync({ refs: [100], issues: [issue()], now: NOW });
  assert.match(formatPlan([p]), /#100 {2}confirmed -> fixed/);
});

test("loadPatches: den rigtige patchNotes.js kan læses og giver issue-numre", async () => {
  const patches = await loadPatches();
  assert.ok(patches.length > 0);
  assert.ok(liveRefs(patches).length > 0);
});
