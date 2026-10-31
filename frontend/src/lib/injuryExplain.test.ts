import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { injuryFitAgainDate, injuryCauseMessage } from "./injuryExplain.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("#7412 injuryFitAgainDate: dagen efter sidste skadedag, ogsaa over maaneds- og aarsskifte", () => {
  assert.equal(injuryFitAgainDate("2026-11-02"), "2026-11-03");
  assert.equal(injuryFitAgainDate("2026-10-31"), "2026-11-01");
  assert.equal(injuryFitAgainDate("2026-12-31"), "2027-01-01");
  assert.equal(injuryFitAgainDate(null), null);
  assert.equal(injuryFitAgainDate("not a date"), null);
});

test("#7412 injuryCauseMessage: styrt med loeb og etape, endagsloeb uden etape, traening, sygdom", () => {
  assert.deepEqual(injuryCauseMessage("race_crash", { race: "Tour X", stage: 3, stages: 7 }),
    { key: "condition.causeCrashStage", params: { race: "Tour X", stage: 3 } });
  assert.deepEqual(injuryCauseMessage("race_crash", { race: "Omloop", stage: 1, stages: 1 }),
    { key: "condition.causeCrashRace", params: { race: "Omloop" } });
  assert.deepEqual(injuryCauseMessage("race_crash", null), { key: "condition.causeCrash", params: {} },
    "uden fundet styrt: aarsagen uden et opfundet sted");
  assert.deepEqual(injuryCauseMessage("training_overload"), { key: "condition.causeTraining", params: {} });
  assert.deepEqual(injuryCauseMessage("illness"), { key: "condition.causeIllness", params: {} });
  assert.equal(injuryCauseMessage(null), null);
  assert.equal(injuryCauseMessage("something_new"), null);
});

test("#7412 alle chip-noegler findes i rider.json i alle fem sprog med de rigtige pladsholdere", () => {
  const expected = {
    fitAgain: ["{date}"], fitAgainApprox: ["{date}"], causeCrashStage: ["{race}", "{stage}"], causeCrashRace: ["{race}"],
    causeCrash: [], causeTraining: [], causeIllness: [],
  };
  for (const lang of ["en", "da", "fr", "es", "nl"]) {
    const rider = JSON.parse(readFileSync(join(__dirname, `../../public/locales/${lang}/rider.json`), "utf8"));
    for (const [key, params] of Object.entries(expected)) {
      const text = rider.condition?.[key];
      assert.ok(text, `${lang}: condition.${key} mangler`);
      for (const p of params) assert.ok(text.includes(p), `${lang} condition.${key} mangler ${p}`);
      assert.ok(!/[–—]/.test(text), `${lang} condition.${key}: ingen tankestreg`);
    }
  }
});
