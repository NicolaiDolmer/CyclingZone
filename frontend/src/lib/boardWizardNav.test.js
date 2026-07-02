import { test } from "node:test";
import assert from "node:assert/strict";

import { getWizardBackState, canResumeNegotiation, shouldAutoOpenSetupWizard } from "./boardWizardNav.js";

// #1240 · Regressionstests på wizard-tilbagenavigation.

test("step 3 goes back to step 2 on the same (last) goal", () => {
  assert.deepEqual(
    getWizardBackState({ step: 3, goalIdx: 4, pendingNegotiate: false }),
    { step: 2, goalIdx: 4, pendingNegotiate: false }
  );
});

test("step 2 with compromise view open closes the view, stays on goal", () => {
  assert.deepEqual(
    getWizardBackState({ step: 2, goalIdx: 2, pendingNegotiate: true }),
    { step: 2, goalIdx: 2, pendingNegotiate: false }
  );
});

test("step 2 on goal >0 goes to previous goal", () => {
  assert.deepEqual(
    getWizardBackState({ step: 2, goalIdx: 3, pendingNegotiate: false }),
    { step: 2, goalIdx: 2, pendingNegotiate: false }
  );
});

test("step 2 on first goal goes back to step 1 (strategy)", () => {
  assert.deepEqual(
    getWizardBackState({ step: 2, goalIdx: 0, pendingNegotiate: false }),
    { step: 1, goalIdx: 0, pendingNegotiate: false }
  );
});

test("step 1 has no internal back target", () => {
  assert.equal(getWizardBackState({ step: 1, goalIdx: 0, pendingNegotiate: false }), null);
  assert.equal(getWizardBackState({}), null);
});

test("resume requires same proposal reference and intact finalGoals", () => {
  const goals = [{ type: "stage_wins", target: 2 }, { type: "top_n_finish", target: 5 }];
  const finalGoals = goals.map((g) => ({ ...g }));

  // Samme reference + samme længde → genoptag (valg bevares).
  assert.equal(canResumeNegotiation({ proposedGoals: goals, previewGoals: goals, finalGoals }), true);

  // Refetchet proposal (ny array-reference, fx fokus-skifte) → start forfra.
  assert.equal(canResumeNegotiation({ proposedGoals: goals, previewGoals: goals.map((g) => ({ ...g })), finalGoals }), false);

  // Ingen igangværende forhandling → start forfra.
  assert.equal(canResumeNegotiation({ proposedGoals: [], previewGoals: [], finalGoals: [] }), false);
  assert.equal(canResumeNegotiation({}), false);

  // finalGoals ude af sync med forslaget → start forfra.
  assert.equal(canResumeNegotiation({ proposedGoals: goals, previewGoals: goals, finalGoals: [finalGoals[0]] }), false);
});

// #2104 · shouldAutoOpenSetupWizard — DNA-first-gate for setup-wizarden.

test("setup wizard auto-opens only when club DNA is already chosen", () => {
  const base = { isBaselinePhase: false, setupNextPlanType: "5yr", hasAnyPlan: true };

  assert.equal(shouldAutoOpenSetupWizard({ ...base, teamDna: { key: "sprint_kommerciel" } }), true);

  // Nyt hold uden DNA → DNA-valget på siden er første skridt, ingen wizard.
  assert.equal(shouldAutoOpenSetupWizard({ ...base, teamDna: null }), false);
});

test("setup wizard never auto-opens in baseline phase or without pending setup plan", () => {
  const dna = { key: "sprint_kommerciel" };

  assert.equal(shouldAutoOpenSetupWizard({ isBaselinePhase: true, setupNextPlanType: "5yr", hasAnyPlan: true, teamDna: dna }), false);
  assert.equal(shouldAutoOpenSetupWizard({ isBaselinePhase: false, setupNextPlanType: null, hasAnyPlan: true, teamDna: dna }), false);
  assert.equal(shouldAutoOpenSetupWizard({ isBaselinePhase: false, setupNextPlanType: "5yr", hasAnyPlan: false, teamDna: dna }), false);
  assert.equal(shouldAutoOpenSetupWizard({}), false);
});
