// #5932 (ejer-godkendt mockup 1/10): Program-fanens tre under-faner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const page = read("../../pages/TrainingPage.jsx");

test("under-fanerne huskes i ?sub= og gates pr. flag", () => {
  assert.match(page, /searchParams\.get\("sub"\)/);
  assert.match(page, /p\.set\("sub", sub\)/);
  assert.match(page, /\.\.\.\(programsOn \? \["programs"\] : \[\]\)/);
  assert.match(page, /\.\.\.\(fatigueRulesOn \? \["limit"\] : \[\]\)/);
  // Flags off: fanen er praecis som i dag.
  assert.match(page, /programLayout \? renderProgramTab\(\) : renderWeekPlanTab\(\)/);
});

test("Today-fanen faar een linje i overblikket, intet nyt kort", () => {
  assert.match(page, /footer=\{fatigueRulesOn \? <FatigueRuleSummary/);
  assert.match(page, /onEdit=\{\(\) => setSub\("limit"\)\}/);
});

test("ingen ny gold: graensen gemmes ved aendring, programmer saettes paa med et valg", () => {
  for (const file of ["FatigueRulePanel.tsx", "TrainingProgramList.tsx", "TrainingPlanCard.tsx", "FatigueRuleSummary.tsx"]) {
    assert.doesNotMatch(read(file), /variant="primary"/, file);
  }
  assert.doesNotMatch(read("FatigueRulePanel.tsx"), /fatigueRule\.save"/);
  assert.doesNotMatch(page, /programsOn && activeTab === "weekplan"/);
});

test("i18n: EN og DA har de nye noegler, uden em-dash", () => {
  const en = JSON.parse(read("../../../public/locales/en/training.json"));
  const da = JSON.parse(read("../../../public/locales/da/training.json"));
  assert.deepEqual(Object.keys(en.subtabs).sort(), Object.keys(da.subtabs).sort());
  assert.equal(en.subtabs.limit, "Fatigue limit");
  assert.equal(da.subtabs.limit, "Træthedsgrænse");
  assert.equal(da.subtabs.programs, "Programmer");
  const keys = [
    "teamRuleAbove", "teamRuleRun", "teamRuleInstead", "add", "chipOwn", "chipOff",
    "summaryRule", "summaryAfterStage", "summaryExceptionsOnly", "summaryOff", "summaryToday", "summaryEdit", "summarySet",
  ];
  for (const key of keys) {
    assert.ok(en.fatigueRule[key] && da.fatigueRule[key], key);
    assert.doesNotMatch(`${en.fatigueRule[key]}${da.fatigueRule[key]}`, /—/, key);
  }
  for (const lang of [en, da]) {
    assert.ok(lang.forecast.teamLabel && lang.weekPlan.ownPlansChips && lang.programs.listNote);
  }
});
