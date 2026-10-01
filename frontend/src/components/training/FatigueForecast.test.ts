// #5932/#5933 · prognosen og de laaste etapefelter: ren logik + wiring.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { forecastTone, raceSlotsFor } from "./FatigueForecastModel.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

test("farvebaandet: kendte baand passerer, ukendt bliver aldrig 'frisk'", () => {
  assert.equal(forecastTone({ band: "ok" }), "ok");
  assert.equal(forecastTone({ band: "risk" }), "risk");
  assert.equal(forecastTone({ band: null }), "warn");
});

test("laaste felter kun naar prognosen er aktiv og ikke afregnet", () => {
  const live = { available: true, settled: false, riders: { r1: { fatigue: 60, band: "ok" as const, raceSlots: [2] } } };
  assert.deepEqual([...raceSlotsFor(live, "r1")], [2]);
  assert.equal(raceSlotsFor({ ...live, settled: true }, "r1").size, 0);
  assert.equal(raceSlotsFor(null, "r1").size, 0);
  assert.equal(raceSlotsFor(live, "r9").size, 0);
});

test("ingen formel paa fladen: komponenten viser kun tal, baand og tekst", () => {
  const src = read("FatigueForecast.tsx");
  assert.match(src, /forecast\.label/);
  assert.doesNotMatch(src, /recovery|fatigueLoad|injuryFatigueFloor|\b70\b/);
});

test("wiring: rytterkortet (desktop + telefon) og gitteret faar prognosen", () => {
  const page = read("../../pages/TrainingPage.jsx");
  assert.match(page, /forecast=\{renderForecast\(riderId\)\}/);
  assert.match(page, /forecastFor=\{renderForecast\}/);
  assert.match(page, /programsOn \|\| cellsOn \?/);
  assert.match(read("mobile/TrainingMobileToday.tsx"), /forecast=\{forecastFor \? forecastFor\(selected\.id\) : null\}/);
  assert.match(read("TrainingProgramsPanel.tsx"), /training-program-cell-locked/);
});

test("I dag-tabel, egne planer og fanenavn gates paa felt-flaget (samme som motoren)", () => {
  const page = read("../../pages/TrainingPage.jsx");
  // cells=on + katalog=off: tabellen skal vise feltet, ikke ugedagens gamle session.
  assert.match(page, /if \(cellsOn && column\.state !== "done"\)/);
  assert.match(page, /!\(cellsOn && isProgramPlan\(riderWeekPlans\[r\.id\]/);
  assert.match(page, /\{cellsOn \? t\("tabs\.program"\) : t\("tabs\.weekplan"\)\}/);
  assert.doesNotMatch(page, /programsOn && column\.state/);
});

test("i18n: EN og DA har de samme prognose-noegler", () => {
  const en = JSON.parse(read("../../../public/locales/en/training.json"));
  const da = JSON.parse(read("../../../public/locales/da/training.json"));
  assert.deepEqual(Object.keys(en.forecast).sort(), Object.keys(da.forecast).sort());
  assert.equal(en.forecast.label, "Fatigue tonight");
  assert.equal(da.forecast.label, "Træthed i aften");
  for (const key of ["cellsIntro", "seededHint", "stageLocked", "stageLockedTitle"]) {
    assert.ok(en.programs[key] && da.programs[key], key);
  }
});
