// #8541 · GET /api/training/me sender `effortLevels` (training_effort_levels).
//
// Prod 22/11: kontakten var on, men feltet blev aldrig sendt. Profilens Traening-fane
// (RiderTrainingTab: `training.effortLevels === true`) og I dag R5 (`r5.effortLevels`)
// stod derfor paa de gamle intensitetsord. Kilde-wiring, samme lag som
// apiTrainingMeDayClose.routes.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8").replace(/\r\n/g, "\n");

function trainingMeHandler() {
  const start = apiSource.indexOf('router.get("/training/me"');
  assert.ok(start !== -1, "GET /training/me findes");
  const end = apiSource.indexOf("\n});", start);
  return apiSource.slice(start, end);
}

test("#8541 GET /training/me laeser training_effort_levels med samme funktion som motoren", () => {
  assert.match(apiSource, /import \{[^}]*\bisTrainingEffortLevelsEnabled\b[^}]*\} from "\.\.\/lib\/trainingEffortLevels\.js"/);
  assert.match(trainingMeHandler(), /isTrainingEffortLevelsEnabled\(supabase\)/);
});

test("#8541 feltet sendes kun som true og udelades helt med kontakten off", () => {
  const handler = trainingMeHandler();
  assert.match(handler, /\.\.\.\(effortLevelsOn === true \? \{ effortLevels: true \} : \{\}\)/);
  assert.doesNotMatch(handler, /\beffortLevels: effortLevelsOn\b/);
});

test("#8541 klienterne laeser netop feltet `effortLevels` fra traeningssvaret", () => {
  const useTraining = readFileSync(resolve(__dirname, "../../frontend/src/lib/useTraining.js"), "utf8");
  assert.match(useTraining, /\(data\)\.effortLevels === true/);
});
