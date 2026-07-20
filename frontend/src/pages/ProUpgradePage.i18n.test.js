import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1903 Founder-seat-counter på /pro. Regression-guard for interpolations-
// syntaks: projektet kører i18next-icu, hvor pladsholdere er ENKELT-tuborg
// ({taken}), ikke i18next-default ({{taken}}). Dobbelt-tuborg omkring en bar
// identifier rendered råt i UI'et (ramte prod 20/7: "{{taken}} af {{cap}}...").
// NB: ICU select-blokke har legitim "{{"-nesting ({kind, select, x {{rider}...}}),
// så guarden er målrettet bare identifiers, ikke et blankt "{{"-forbud.

const __dirname = dirname(fileURLToPath(import.meta.url));

const RAW_I18NEXT_PLACEHOLDER = /\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/;

for (const lng of ["en", "da"]) {
  const pro = JSON.parse(
    readFileSync(join(__dirname, `../../public/locales/${lng}/pro.json`), "utf8")
  );

  test(`pro.json (${lng}): ingen i18next-style {{var}}-pladsholdere (ICU kræver {var})`, () => {
    for (const [key, value] of Object.entries(pro)) {
      assert.doesNotMatch(String(value), RAW_I18NEXT_PLACEHOLDER, `nøgle "${key}"`);
    }
  });

  test(`pro.json (${lng}): seat-counter-nøgler bruger ICU-pladsholdere`, () => {
    assert.match(pro.founderSeatsTaken, /\{taken\}/);
    assert.match(pro.founderSeatsTaken, /\{cap\}/);
    assert.match(pro.founderSeatsRemaining, /\{remaining\}/);
  });
}
