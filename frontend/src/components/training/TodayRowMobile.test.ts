// #5685/#5630 · wiring-vagt: raekken bruger samme prognose, samme hurtig-valg
// og samme laas som resten af siden — ingen kopi af formler eller mutationer.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const row = read("TodayRowMobile.tsx");
const page = read("../../pages/TrainingPage.jsx");

test("raekken regner ingen prognose selv (I5): kun rowForecast fra modellen", () => {
  assert.match(row, /rowForecast\(forecastFor\(rider\.id\)\)/);
  assert.doesNotMatch(row, /fetch\(|apiFetch/);
});

test("touch-targets er mindst 40 px og ingen piller", () => {
  assert.match(row, /min-h-10/);
  assert.doesNotMatch(row, /rounded-full|rounded-cz-pill/);
});

test("siden kobler raekken (felter on for alle, #6030) med desktoppens QUICK_DAY_TYPES", () => {
  assert.match(page, /\) : \(\s*<TodayRowsMobile/);
  assert.doesNotMatch(page, /TrainingMobileToday/);
  assert.match(page, /choices=\{QUICK_DAY_TYPES\}/);
  assert.match(page, /onChoose=\{handleOneTapChoice\}/);
  assert.match(page, /handleDayQuickChange\(riderId, choice, planFor\(riderId\)\?\.focus\)/);
});

test("valget laases efter Train now via sidens run-gate", () => {
  assert.match(page, /locked=\{rowLocked\(\{ trainedToday: runGate\.trainedToday \}\)\}/);
  assert.match(row, /const disabled = locked \|\| busy;/);
});

test("'Rest for several' (#5638) bevares: markering skjuler valget og toggler raekken", () => {
  assert.match(page, /picked=\{mobilePickMode \? selected : null\}/);
  assert.match(row, /\{!pickMode && \(/);
  assert.match(row, /onTogglePick\?\.\(rider\.id\)/);
});

test("en fejlet hurtig-aendring vises i raekken (role=alert, sidens egne fejltekster)", () => {
  assert.ok(page.includes("errorFor={(riderId) => (planActionError?.riderId === riderId"));
  assert.match(row, /role="alert"/);
  assert.match(row, /planActionErrorGeneric/);
});

test("trykket segment laeses fra dagens effektive felt (samme sessionFor som tabellen)", () => {
  assert.ok(page.includes("pressedChoiceFromSession(sessionFor(riderId, column))"));
});

test("i18n en+da har alle raekkens noegler", () => {
  for (const lang of ["en", "da"]) {
    const json = JSON.parse(readFileSync(join(here, `../../../public/locales/${lang}/training.json`), "utf8"));
    for (const key of ["choice_rest", "choice_recovery", "choice_session", "groupAria", "approx", "stageToday", "locked"]) {
      assert.equal(typeof json.oneTap?.[key], "string", `${lang} oneTap.${key}`);
    }
  }
});

test("#6123 'Back to team program': raekken og tabellen rummer slottet, siden kalder begge DELETE-lag", () => {
  const reset = read("ResetToTeamProgram.tsx");
  const table = read("TrainingTodayTable.tsx");
  assert.match(row, /\{!pickMode && renderReset\?\.\(rider\.id\)\}/);
  assert.match(table, /renderReset\?\.\(row\.id\)/);
  assert.match(page, /renderReset=\{\(riderId\) => renderResetFor\(riderId, true\)\}/);
  assert.match(page, /renderReset=\{renderResetFor\}/);
  assert.match(page, /await clearRiderWeekPlan\(riderId\)/);
  assert.match(page, /await clearPlan\(riderId\)/);
  // Laasen og fejlteksten kommer fra de eksisterende kilder.
  assert.match(page, /locked=\{rowLocked\(\{ trainedToday: runGate\.trainedToday \}\)\}\s+busy=\{savingId === riderId/);
  assert.match(reset, /trainNowSaveErrorKey\(error, "resetProgram\.error"\)/);
  assert.match(reset, /disabled=\{locked \|\| busy \|\| working\}/);
  assert.match(reset, /role="status"/);
  assert.doesNotMatch(reset, /fetch\(|apiFetch/);
});

test("#6123 i18n en+da har alle nulstil-noeglerne", () => {
  for (const lang of ["en", "da"]) {
    const json = JSON.parse(readFileSync(join(here, `../../../public/locales/${lang}/training.json`), "utf8"));
    for (const key of ["action", "done", "error"]) {
      assert.equal(typeof json.resetProgram?.[key], "string", `${lang} resetProgram.${key}`);
    }
  }
});
