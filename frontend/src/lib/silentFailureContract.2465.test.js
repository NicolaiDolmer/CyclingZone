import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #2465 — feedback-kontrakten: seks hooks (useTraining, useAcademy, useFacilities,
// usePlanner, useScouting, useScoutingCentral) returnerer eksplicit {ok, error},
// men flere kaldesteder kaldte dem uden await og læste aldrig svaret. Ved fejl
// (udløbet session, netværk, backend-afvisning) skete der visuelt INGENTING.
//
// Source-string-guards (spejler KlubPage.wiring.test.js / TrainingPage.wiring.test.js
// -mønstret — ingen jsdom i denne kodebase) for de 4 verificerede kaldesteder + de to
// beslægtede scout-kaldesteder fundet under #2465's backwards-check.
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const riderTrainingTab = read("../components/rider/profile/RiderTrainingTab.jsx");
const riderScoutingTab = read("../components/rider/profile/RiderScoutingTab.jsx");
const scoutablePotentiale = read("../components/rider/ScoutablePotentiale.jsx");
const strategyPage = read("../pages/StrategyPage.jsx");
const trainingPage = read("../pages/TrainingPage.jsx");
const stageRoleMatrix = read("../components/race/StageRoleMatrix.jsx");

// #3721: the focus chips + intensity segment moved into the shared FocusPanel,
// so the call sites are now handlePanelSave/handlePanelClear. The CONTRACT is
// unchanged and pinned at least as tightly as before.
test("RiderTrainingTab: panel save/clear await setPlan/clearPlan and surface {ok:false}", () => {
  assert.match(riderTrainingTab, /async function handlePanelSave\(focus, intensity\)/);
  assert.match(riderTrainingTab, /const result = await training\.setPlan\(rider\.id, focus, intensity\)/);
  assert.match(riderTrainingTab, /async function handlePanelClear\(\)/);
  assert.match(riderTrainingTab, /const result = await training\.clearPlan\(rider\.id\)/);
  assert.match(riderTrainingTab, /if \(result && !result\.ok\) setActionError\(result\.error \|\| "failed"\)/);
  // The error state must actually be rendered (role=alert, i18n fallback array).
  assert.match(riderTrainingTab, /\{actionError && \(/);
  assert.match(riderTrainingTab, /role="alert"/);
  // #3721: the panel must RECEIVE the error too, or a failed save would only be
  // visible on the card behind the open panel.
  assert.match(riderTrainingTab, /error=\{actionError\}/);
  // A failed save must not close the panel — the manager has to see it failed.
  assert.match(riderTrainingTab, /else setPanelOpen\(false\)/);
});

test("RiderScoutingTab: handleScout awaits scout() and surfaces r.error on failure", () => {
  assert.match(riderScoutingTab, /const handleScout = async \(\) => \{/);
  assert.match(riderScoutingTab, /const r = await scout\(riderId\)/);
  assert.match(riderScoutingTab, /setScoutError\(r\?\.error \|\| "failed"\)/);
  assert.match(riderScoutingTab, /\{scoutError && \(/);
});

test("ScoutablePotentiale (#2465 backwards-check): handleScout awaits scout() too", () => {
  // Same scout() hook, a second unguarded call site found while auditing #2465's
  // scope — fixed alongside the four verified call sites.
  assert.match(scoutablePotentiale, /const handleScout = async \(e\) => \{/);
  assert.match(scoutablePotentiale, /const r = await scout\(riderId\)/);
  assert.match(scoutablePotentiale, /if \(r && !r\.ok\) setScoutError\(r\.error \|\| "failed"\)/);
  // useState must be called before any early `return` (rules-of-hooks) —
  // regression-guard for the react-hooks/rules-of-hooks lint error this fix
  // originally tripped.
  const stateIdx = scoutablePotentiale.indexOf("const [scoutError, setScoutError] = useState(null);");
  const firstReturnIdx = scoutablePotentiale.indexOf("return <PotentialeStars value={null} />;");
  assert.ok(stateIdx > 0 && firstReturnIdx > 0 && stateIdx < firstReturnIdx);
});

test("StrategyPage: preview/save/regenerate no longer swallow errors silently", () => {
  assert.doesNotMatch(strategyPage, /catch \{ \/\* ignore \*\/ \}/);
  assert.match(strategyPage, /setError\(\{ code: body\.error \|\| "generic" \}\)/);
  assert.match(strategyPage, /\{error && \(/);
  // Mirrors the canonical RaceHubBoard.jsx pattern named in the issue.
  assert.match(strategyPage, /t\(\[`selection\.errors\.\$\{error\.code\}`, "selection\.errors\.generic"\]\)/);
});

test("TrainingPage: roster-row focus/intensity/clear handlers await setPlan/clearPlan", () => {
  assert.match(trainingPage, /async function handlePlanChange\(riderId, focus, intensity\)/);
  assert.match(trainingPage, /async function handleClearPlan\(riderId\)/);
  assert.match(trainingPage, /const result = await setPlan\(riderId, focus, intensity\)/);
  assert.match(trainingPage, /const result = await clearPlan\(riderId\)/);
  // The intensity buttons in the roster row still call the wrapper, not the raw hook fn.
  assert.match(trainingPage, /onClick=\{\(\) => handlePlanChange\(rider\.id, plan\.focus, k\)\}/);
  assert.match(trainingPage, /planActionError\?\.riderId === rider\.id/);

  // #3721: the focus <select> + its clear button became the focus PANEL, so
  // set/clear now route through handleFocusPanelSave/handleFocusPanelClear.
  // Both must go through the wrappers (never the raw hook fns) and must only
  // close the panel when the write actually succeeded — hence the wrappers now
  // return a boolean instead of undefined.
  assert.match(trainingPage, /if \(await handlePlanChange\(focusPanelRiderId, focus, intensity\)\) setFocusPanelRiderId\(null\)/);
  assert.match(trainingPage, /if \(await handleClearPlan\(focusPanelRiderId\)\) setFocusPanelRiderId\(null\)/);
  assert.match(trainingPage, /setPlanActionError\(\{ riderId, error: result\.error \|\| "failed" \}\);\s*\n\s*return false;/);
  // The panel must receive the error for the rider it is open for.
  assert.match(trainingPage, /error=\{planActionError\?\.riderId === focusPanelRiderId \? planActionError\.error : null\}/);
});

test("StageRoleMatrix: shows a short direction hint per role (not raw tuning numbers)", () => {
  assert.match(stageRoleMatrix, /ROLE_HELP_KEY/);
  assert.match(stageRoleMatrix, /stageTactics\.roleHelp\.captain/);
  assert.match(stageRoleMatrix, /stageTactics\.roleHelp\.helper/);
  // Must not leak the calibrated backend constants into frontend copy.
  assert.doesNotMatch(stageRoleMatrix, /WORK_COST_HELPER/);
  assert.doesNotMatch(stageRoleMatrix, /-0\.03/);
});

test("locale keys referenced by the new error surfaces exist in both en + da (key-parity)", () => {
  const en = JSON.parse(readFileSync(new URL("../../public/locales/en/rider.json", import.meta.url), "utf8"));
  const da = JSON.parse(readFileSync(new URL("../../public/locales/da/rider.json", import.meta.url), "utf8"));
  assert.ok(en.profile.training.actionErrorGeneric);
  assert.ok(da.profile.training.actionErrorGeneric);
  assert.ok(en.profile.scouting.scoutFailed);
  assert.ok(da.profile.scouting.scoutFailed);

  const enTraining = JSON.parse(readFileSync(new URL("../../public/locales/en/training.json", import.meta.url), "utf8"));
  const daTraining = JSON.parse(readFileSync(new URL("../../public/locales/da/training.json", import.meta.url), "utf8"));
  assert.ok(enTraining.planActionErrorGeneric);
  assert.ok(daTraining.planActionErrorGeneric);

  const enRaces = JSON.parse(readFileSync(new URL("../../public/locales/en/races.json", import.meta.url), "utf8"));
  const daRaces = JSON.parse(readFileSync(new URL("../../public/locales/da/races.json", import.meta.url), "utf8"));
  for (const key of ["captain", "sprintCaptain", "helper", "hunter", "freeRole"]) {
    assert.ok(enRaces.stageTactics.roleHelp[key], `en missing roleHelp.${key}`);
    assert.ok(daRaces.stageTactics.roleHelp[key], `da missing roleHelp.${key}`);
  }
});
