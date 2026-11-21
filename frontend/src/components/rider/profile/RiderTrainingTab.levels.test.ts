// #8541: profilens Traening-fane bruger Let/Mellem/Haard (training_effort_levels), med
// samme vaelger og ord som I dag R5. Kontakten off = fanen som i dag.
// Samme kilde-scan-moenster som RiderTrainingTab.fatigue.test.ts (ingen render-harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effortOfLevel, planEffort, showsInjuryRisk, writeForLevel } from "../../training/r5/todayR5Model.ts";

const src = readFileSync(fileURLToPath(new URL("./RiderTrainingTab.jsx", import.meta.url)), "utf8");
const locale = (lng: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../public/locales/${lng}/rider.json`, import.meta.url)), "utf8"));

test("niveau-ordene er spillets egne: normal hedder Mellem, ukendt er intet niveau", () => {
  assert.equal(effortOfLevel("easy"), "easy");
  assert.equal(effortOfLevel("normal"), "medium");
  assert.equal(effortOfLevel("hard"), "hard");
  assert.equal(effortOfLevel("rest"), null);
});

test("Hvile er sit eget valg, og kun Haard har skaderisiko", () => {
  assert.equal(planEffort({ focus: "sprint", intensity: "rest" }), "rest");
  assert.equal(showsInjuryRisk(planEffort({ focus: "sprint", intensity: "hard" })), true);
  assert.equal(showsInjuryRisk(planEffort({ focus: "sprint", intensity: "normal" })), false);
  assert.equal(showsInjuryRisk(planEffort({ focus: "sprint", intensity: "easy" })), false);
  assert.equal(showsInjuryRisk(planEffort({ focus: "sprint", intensity: "rest" })), false);
  const rest = writeForLevel("rest", { storedFocus: "sprint", assistantFocus: null });
  assert.deepEqual(rest, { kind: "write", dayType: "rest", session: null, effort: null });
});

test("Haard uden kendt session gaetter ikke (sessionsvaelgeren aabnes)", () => {
  assert.deepEqual(writeForLevel("hard", { storedFocus: null, assistantFocus: null }), { kind: "pick" });
  const w = writeForLevel("hard", { storedFocus: "sprint", assistantFocus: null });
  assert.equal(w.kind === "write" && w.effort, "hard");
});

test("Haard uden session: det trykkede niveau huskes til panelet gemmer (Codex P2)", () => {
  assert.match(src, /if \(w\.kind === "pick"\) \{ setPendingEffort\(effort\); setPanelOpen\(true\); return; \}/);
  assert.match(src, /writeForTrainingAtLevel\(session, pendingEffort \?\? planEffort\(training\.planFor\(rider\.id\)\)\)/);
  assert.match(src, /onClose=\{closePanel\}/);
  assert.match(src, /onOpenPanel=\{\(\) => \{ setPendingEffort\(null\); setPanelOpen\(true\); \}\}/);
});

test("fanen bruger R5's vaelger og niveau-noegler, kun bag kontakten", () => {
  assert.match(src, /import EffortPickerR5, \{ HardRiskLine \} from "\.\.\/\.\.\/training\/r5\/EffortPickerR5\.tsx"/);
  assert.match(src, /const levelsOn = training\.effortLevels === true/);
  assert.match(src, /\{levelsOn && \(\s*<div className="mb-3">\s*<EffortPickerR5/);
  // Off: den gamle linje staar uaendret i den ikke-niveau-gren.
  assert.match(src, /t\("profile\.training\.noRiskNote"\)/);
  assert.match(src, /if \(!levelsOn\) return body;/);
});

test("med niveauer paastaas det ikke at hoejere intensitet altid vokser hurtigere", () => {
  assert.match(src, /levelsOn \? \(\s*\/\*[\s\S]*?t\("profile\.training\.levelNote"\)/);
  for (const lng of ["da", "en", "es", "fr", "nl"]) {
    const training = locale(lng).profile.training;
    assert.ok(training.levelNote && training.levelNote.length > 10, `${lng}: levelNote mangler`);
    assert.doesNotMatch(training.levelNote, /\d/, `${lng}: ingen tal i niveau-noten`);
  }
});
