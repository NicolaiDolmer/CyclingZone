// #6060: kopiér en dags plan til de næste dage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTargets, applyCopyDay } from "./copyDayPlan.ts";

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

test("copyTargets: de n naeste dage, wrap, aldrig kilden", () => {
  assert.deepEqual(copyTargets("mon", 2, WEEK), ["tue", "wed"]);
  assert.deepEqual(copyTargets("sat", 3, WEEK), ["sun", "mon", "tue"]);
  assert.deepEqual(copyTargets("wed", 6, WEEK), ["thu", "fri", "sat", "sun", "mon", "tue"]);
  assert.ok(!copyTargets("wed", 6, WEEK).includes("wed"));
});

test("copyTargets: max 6, ugyldigt input giver ingenting", () => {
  assert.equal(copyTargets("mon", 99, WEEK).length, 6);
  assert.deepEqual(copyTargets("mon", 0, WEEK), []);
  assert.deepEqual(copyTargets("mon", -3, WEEK), []);
  assert.deepEqual(copyTargets("mon", Number.NaN, WEEK), []);
  assert.deepEqual(copyTargets("xxx", 2, WEEK), []);
});

test("copyTargets: i dag springes over naar den er laast (#6139), ellers ikke", () => {
  assert.deepEqual(copyTargets("mon", 3, WEEK, { todayWeekday: "tue", todayLocked: true }), ["wed", "thu"]);
  assert.deepEqual(copyTargets("mon", 3, WEEK, { todayWeekday: "tue", todayLocked: false }), ["tue", "wed", "thu"]);
  assert.deepEqual(copyTargets("tue", 2, WEEK, { todayWeekday: "tue", todayLocked: true }), ["wed", "thu"]);
});

test("applyCopyDay: kalder kun kladde-setteren for maaldage, med kildens intensitet", () => {
  const calls: Array<[string, string]> = [];
  const plan: Record<string, string> = { mon: "hard", tue: "rest", wed: "rest", thu: "easy" };
  const done = applyCopyDay("mon", 2, WEEK, (d) => plan[d] ?? "rest", (d, v) => calls.push([d, v]));
  assert.deepEqual(done, ["tue", "wed"]);
  assert.deepEqual(calls, [["tue", "hard"], ["wed", "hard"]]);
});

test("kildeanalyse: knappen bor kun i intensitets-gitteret og rammer ingen rytter-setter", () => {
  const card = read("TrainingPlanCard.tsx");
  assert.match(card, /applyCopyDay\(copyFrom, copyCount, weekdays, intensity\.intensityFor, intensity\.onSetDay/);
  assert.doesNotMatch(card, /variant="primary"/);
  // Kopien raerer hverken program-felterne eller rytter-planer.
  const copyBlock = card.slice(card.indexOf("const runCopy"), card.indexOf("const hint = cells"));
  assert.doesNotMatch(copyBlock, /cells\.|onOpenOwnPlan|onSetCell/);
  // Knappen ligger i intensitets-fragmentet (intensity && !showCells), foer Gem.
  const frag = card.indexOf("{intensity && !showCells && (");
  const btn = card.indexOf('data-testid="training-copy-day-button"');
  const save = card.indexOf('data-testid="training-week-plan-save"');
  assert.ok(frag > 0 && btn > frag && btn < save);
  // 44px touch paa mobil.
  assert.match(card.slice(btn - 400, btn), /min-h-11/);
  // Gruppevisning og program-felter er urørt.
  assert.doesNotMatch(read("TrainingGroupsPlan.tsx"), /copyDayPlan/);
  assert.doesNotMatch(read("../../pages/TrainingPage.jsx"), /copyDayPlan/);
});

test("i18n: EN og DA har copy-noeglerne, uden em-dash", () => {
  const en = JSON.parse(read("../../../public/locales/en/training.json")).weekPlan;
  const da = JSON.parse(read("../../../public/locales/da/training.json")).weekPlan;
  for (const k of ["copySource", "copyCount", "copyOption", "copyButton", "copyDone", "copyNone"]) {
    assert.ok(en[k] && da[k], k);
    assert.doesNotMatch(en[k] + da[k], /[—–]/, k);
  }
  assert.match(en.copyDone, /Save to keep it/);
});
