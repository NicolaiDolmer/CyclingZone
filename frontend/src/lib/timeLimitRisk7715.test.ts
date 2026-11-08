// #7715: mærket på taktik og udtagelse.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../i18n/languages.js";
import { TIME_LIMIT_FATIGUE_SAFE_EFFORTS_7715 } from "../../../backend/lib/engine/v4/mechanics/timeLimit.ts";
import { TIME_LIMIT_SAFE_EFFORTS, selectionTimeLimitRisk, showsTimeLimitOut, showsTimeLimitRisk } from "./timeLimitRisk7715.ts";

const load = (lng: string) => JSON.parse(readFileSync(new URL(`../../public/locales/${lng}/races.json`, import.meta.url), "utf8"));

test("udvejen er den samme som motorens", () => {
  assert.deepEqual([...TIME_LIMIT_SAFE_EFFORTS].sort(), [...TIME_LIMIT_FATIGUE_SAFE_EFFORTS_7715].sort());
});

test("varslet: kun på den ramte etape, og det forsvinder med spillerens udvej", () => {
  const rider = { time_limit_risk: { 3: true } };
  assert.equal(showsTimeLimitRisk(rider, 3, "normal"), true);
  assert.equal(showsTimeLimitRisk(rider, 2, "normal"), false);
  assert.equal(showsTimeLimitRisk(rider, 3, "grupetto"), false);
  assert.equal(showsTimeLimitRisk(rider, 3, "save"), false);
  assert.equal(showsTimeLimitRisk({ ...rider, abandoned: true }, 3, "normal"), false);
  assert.equal(showsTimeLimitRisk({}, 3, "normal"), false, "slukket kontakt = feltet findes ikke");
});

test("efter etapen: forklaringen står på den etape han røg ud", () => {
  assert.equal(showsTimeLimitOut({ time_limit_out_stage: 4 }, 4), true);
  assert.equal(showsTimeLimitOut({ time_limit_out_stage: 4 }, 5), false);
  assert.equal(showsTimeLimitOut({}, 4), false);
  assert.equal(showsTimeLimitOut({ time_limit_out_stage: null }, 4), false);
});

test("udtagelsen: valgt etape, ellers en hvilken som helst", () => {
  const rider = { stageTimeLimitRisk: [false, true] };
  assert.equal(selectionTimeLimitRisk(rider, 1), true);
  assert.equal(selectionTimeLimitRisk(rider, 0), false);
  assert.equal(selectionTimeLimitRisk(rider, null), true);
  assert.equal(selectionTimeLimitRisk({}, null), false);
});

for (const { code } of LANGUAGES) {
  test(`${code}: teksten findes og har hverken tal, procent eller formel`, () => {
    const copy = load(code).timeLimitRisk;
    for (const key of ["short", "long", "outShort", "outLong"]) {
      assert.ok(copy?.[key], key);
      assert.doesNotMatch(copy[key], /\d|%/, key);
    }
  });
}

test("#7715: planens haardeste indsats afgoer maerket, ikke den gamle intention", async () => {
  const { hardestPlanEffort } = await import("../components/race/StagePlanModel.ts");
  assert.equal(hardestPlanEffort([{ task: "grupetto" }]), "grupetto");
  assert.equal(hardestPlanEffort([{ task: "stay_sheltered" }, { task: "attack" }]), "all_out");
});
