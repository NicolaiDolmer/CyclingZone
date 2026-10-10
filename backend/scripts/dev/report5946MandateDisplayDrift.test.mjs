import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyMandateDisplayDrift,
  goalsDifferFromMandate,
  renderMarkdown,
  summarizeDrift,
} from "./report5946MandateDisplayDrift.mjs";

const MANDATE = {
  id: "m-a", team_id: "team-a", season_number: 4, status: "active", signed_at: "2026-09-27T19:03:00Z",
  goals: [{ type: "top_n_finish", target: 7, label: "Slut i top 7", category: "results" }],
};
const STALE_SAME_SEASON = {
  team_id: "team-a", plan_type: "1yr", negotiation_status: "completed", negotiated_at: null,
  plan_start_season_number: 4,
  current_goals: [{ type: "top_n_finish", target: 5, label: "Slut i top 5", category: "results" }],
};

test("goalsDifferFromMandate: sammenligner kun de felter legacy kan overføre", () => {
  const own = [{ type: "top_n_finish", target: 7, label: "x", category: "results" }];
  assert.equal(goalsDifferFromMandate(own, own), false);
  assert.equal(goalsDifferFromMandate([{ ...own[0], category: "other" }], own), false);
  assert.equal(goalsDifferFromMandate([{ ...own[0], target: 5 }], own), true);
  assert.equal(goalsDifferFromMandate([], own), true);
});

test("classify: genskrevet legacy-række i samme sæson → drift før, ingen drift efter under 'on'", () => {
  assert.deepEqual(
    classifyMandateDisplayDrift({ mandate: MANDATE, legacyBoard: STALE_SAME_SEASON, mandateModelStage: "on" }),
    { driftBefore: true, driftAfter: false, reason: "legacy_same_season" },
  );
});

test("classify: legacy-række fra en anden sæson → årsag legacy_other_season", () => {
  const result = classifyMandateDisplayDrift({
    mandate: MANDATE,
    legacyBoard: { ...STALE_SAME_SEASON, plan_start_season_number: 3 },
    mandateModelStage: "on",
  });
  assert.equal(result.reason, "legacy_other_season");
  assert.equal(result.driftAfter, false);
});

test("classify: 'beta' → drift består efter (reconcile gælder stadig dér)", () => {
  const result = classifyMandateDisplayDrift({ mandate: MANDATE, legacyBoard: STALE_SAME_SEASON, mandateModelStage: "beta" });
  assert.equal(result.driftBefore, true);
  assert.equal(result.driftAfter, true);
});

test("classify: ens legacy-række eller ingen legacy → ingen drift", () => {
  assert.deepEqual(
    classifyMandateDisplayDrift({ mandate: MANDATE, legacyBoard: null, mandateModelStage: "on" }),
    { driftBefore: false, driftAfter: false, reason: "none" },
  );
  const same = { ...STALE_SAME_SEASON, current_goals: JSON.stringify(MANDATE.goals) };
  assert.equal(classifyMandateDisplayDrift({ mandate: MANDATE, legacyBoard: same, mandateModelStage: "on" }).driftBefore, false);
});

test("summarizeDrift + renderMarkdown: kun aggregerede tal, ingen hold-id'er", () => {
  const summary = summarizeDrift({
    mandates: [MANDATE, { ...MANDATE, id: "m-b", team_id: "team-b" }],
    oneYearBoardsByTeamId: new Map([["team-a", STALE_SAME_SEASON]]),
    mandateModelStage: "on",
    managerSignedTeamIds: new Set(["team-a", "team-b"]),
    negotiatedTeamIds: new Set(["team-b"]),
  });
  assert.equal(summary.activeMandates, 2);
  assert.equal(summary.signedActiveMandates, 2);
  assert.equal(summary.driftBefore, 1);
  assert.equal(summary.driftAfter, 0);
  assert.equal(summary.byReason.legacy_same_season, 1);
  assert.equal(summary.onboardingManagerSigned, 2);
  assert.equal(summary.onboardingMissingBefore, 1);

  const md = renderMarkdown(summary, { generatedAt: "2026-10-10T00:00:00Z" });
  assert.match(md, /Visning afviger fra mandatet FØR #5946 \| 1 \|/);
  assert.doesNotMatch(md, /team-a|team-b/);
});
