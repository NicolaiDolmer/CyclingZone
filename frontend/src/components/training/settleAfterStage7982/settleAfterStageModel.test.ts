// #7982 skaermdelen: laasen foelger det, der er koert; slukket kontakt = dagens skaerm.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { raceSlotsFor } from "../FatigueForecastModel.ts";
import {
  raceSessionNote, raceSessionSettleOn, raceSessionsRunCount, ranSlotsFor, todayLockedSlots,
} from "./settleAfterStageModel.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const sorted = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);

// Opdigtede ryttere: A koerte etapen i felt 3 (afregnet), B har etapen i felt 5 (ikke koert endnu),
// C har ingen etape i dag.
const OFF = {
  available: true, settled: false,
  riders: {
    a: { fatigue: 64, band: "ok" as const, raceSlots: [2] },
    b: { fatigue: 50, band: "ok" as const, raceSlots: [4] },
    c: { fatigue: 40, band: "ok" as const, raceSlots: [] },
  },
};
const ON = {
  ...OFF,
  raceSessionSettle: { fatigueNow: true },
  riders: {
    a: { ...OFF.riders.a, ranSlots: [2] },
    b: { ...OFF.riders.b, ranSlots: [] },
    c: { ...OFF.riders.c, ranSlots: [] },
  },
};

test("slukket: laasen er praecis dagens (kun loebets felter), intet er 'koert', ingen linje", () => {
  for (const id of ["a", "b", "c", "x"]) {
    assert.deepEqual(sorted(todayLockedSlots(OFF, id)), sorted(raceSlotsFor(OFF, id)), id);
    assert.equal(ranSlotsFor(OFF, id).size, 0, id);
  }
  assert.equal(raceSessionSettleOn(OFF), false);
  assert.equal(raceSessionsRunCount(OFF), 0);
  assert.equal(raceSessionNote(OFF), null);
  assert.equal(raceSessionNote(null), null);
});

test("slukket: et aeldre svar med ranSlots men uden kontaktfeltet giver stadig dagens skaerm", () => {
  const stray = { ...OFF, riders: { a: { ...OFF.riders.a, ranSlots: [0, 2] } } };
  assert.deepEqual(sorted(todayLockedSlots(stray, "a")), [2]);
  assert.equal(ranSlotsFor(stray, "a").size, 0);
});

test("on: loebets session med kvittering er laast og koert; felterne foer og efter er aabne", () => {
  assert.deepEqual(sorted(todayLockedSlots(ON, "a")), [2]);
  assert.deepEqual(sorted(ranSlotsFor(ON, "a")), [2]);
  for (const slot of [0, 1, 3, 4]) assert.equal(todayLockedSlots(ON, "a").has(slot), false, `felt ${slot + 1} er aabent`);
});

test("on: en etape, der ikke er koert endnu, er laast af loebet (som i dag), men ikke 'koert'", () => {
  assert.deepEqual(sorted(todayLockedSlots(ON, "b")), [4]);
  assert.equal(ranSlotsFor(ON, "b").size, 0);
  assert.equal(todayLockedSlots(ON, "c").size, 0);
});

test("on: et koert traeningsfelt (fx Traen nu) er laast, selv uden loeb", () => {
  const pressed = { ...ON, riders: { ...ON.riders, c: { ...ON.riders.c, ranSlots: [0, 1] } } };
  assert.deepEqual(sorted(todayLockedSlots(pressed, "c")), [0, 1]);
  assert.deepEqual(sorted(ranSlotsFor(pressed, "c")), [0, 1]);
  // Linjen taeller kun loebssessioner, ikke traeningsfelter.
  assert.equal(raceSessionsRunCount(pressed), 1);
});

test("on: to etaper samme dato, kun den afgjorte er koert", () => {
  const two = { ...ON, riders: { a: { fatigue: 70, band: "warn" as const, raceSlots: [1, 4], ranSlots: [1] } } };
  assert.deepEqual(sorted(todayLockedSlots(two, "a")), [1, 4]);
  assert.deepEqual(sorted(ranSlotsFor(two, "a")), [1]);
});

test("tal efter etapen: linjen siger kun, at traetheden viser loebet, naar serveren regner den lige nu", () => {
  assert.deepEqual(raceSessionNote(ON), { keys: ["settleAfterStage.note", "settleAfterStage.fatigueNow"], n: 1 });
  const noFatigueNow = { ...ON, raceSessionSettle: { fatigueNow: false } };
  assert.deepEqual(raceSessionNote(noFatigueNow), { keys: ["settleAfterStage.note"], n: 1 });
  const none = { ...ON, riders: { b: ON.riders.b, c: ON.riders.c } };
  assert.equal(raceSessionNote(none), null, "ingen loebssession koert endnu: ingen linje");
});

test("en afgjort dato vises som i dag, ogsaa med kontakten on", () => {
  const settled = { ...ON, settled: true };
  assert.equal(raceSessionSettleOn(settled), false);
  assert.equal(todayLockedSlots(settled, "a").size, 0);
  assert.equal(raceSessionNote(settled), null);
});

test("wiring: gitteret og grupperne faar laasen og 'koert' fra modellen; teksten om etapen beholdes", () => {
  const page = read("../../../pages/TrainingPage.jsx");
  assert.match(page, /lockedToday: todayLockedSlots\(fatigueForecast\.forecast, key\)/);
  assert.match(page, /ranToday: ranSlotsFor\(fatigueForecast\.forecast, key\)/);
  assert.match(page, /lockedFor=\{\(id\) => todayLockedSlots\(fatigueForecast\.forecast, id\)\}/);
  assert.match(page, /<RaceSessionNote forecast=\{fatigueForecast\.forecast\}/);
  const card = read("../TrainingPlanCard.tsx");
  assert.match(card, /settleAfterStage\.ran/);
  assert.match(read("../TrainingGroupsPlan.tsx"), /ranToday: groupLockedSlots\(memberIds\.map\(ranFor\)\)/);
  const en = JSON.parse(read("../../../../public/locales/en/training.json"));
  assert.equal(en.trainNow.afterRace, "Riders racing today are settled after their stage.");
});

test("i18n: alle fem sprog har de samme noegler, uden tankestreg", () => {
  const keysOf = (lang: string) => JSON.parse(read(`../../../../public/locales/${lang}/training.json`)).settleAfterStage;
  const en = keysOf("en");
  assert.equal(en.ran, "Run");
  assert.equal(keysOf("da").ran, "Kørt");
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const block = keysOf(lang);
    assert.deepEqual(Object.keys(block).sort(), Object.keys(en).sort(), lang);
    for (const value of Object.values(block) as string[]) assert.doesNotMatch(value, /—|–/, lang);
  }
});
