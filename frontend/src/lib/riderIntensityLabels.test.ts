// Prod 22/11 (#8541): rytterprofilens dagslog viste den raa noegle "training.intensity_race"
// paa en loebsdag. Hver intensitet, som kvitteringen kan baere, skal have en tekst paa alle sprog.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANGS = ["en", "da", "es", "fr", "nl"];
// Kvitteringens og planens intensiteter (dailyTrainingEngine: race paa loebsdagens felter).
const INTENSITIES = ["rest", "easy", "normal", "hard", "recovery", "race", "unknown_pending"];

test("rider.json: hver intensitet har en tekst paa alle fem sprog (ingen raa noegler i dagsloggen)", () => {
  for (const lang of LANGS) {
    const json = JSON.parse(readFileSync(resolve(__dirname, `../../public/locales/${lang}/rider.json`), "utf8")) as {
      training?: Record<string, unknown>;
    };
    for (const intensity of INTENSITIES) {
      const value = json.training?.[`intensity_${intensity}`];
      assert.ok(typeof value === "string" && value.trim().length > 0, `${lang}: training.intensity_${intensity} mangler eller er tom`);
    }
  }
});
