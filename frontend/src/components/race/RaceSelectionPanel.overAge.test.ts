// #6964 (ejer 20/10): alder afgør ungdomsløb. Serveren markerer en rytter over
// løbets aldersgrænse med `overAge` (raceSelection.getSelectionContext) og afviser en
// udtagelse med `selection_rider_over_age`. Panelet skal vise ham som ikke-udtagelig
// med en kort grund. Repoet kører node --test uden DOM-renderer, så det dækkes som
// kildekode-guards (samme mønster som RaceSelectionPanel.minEntries.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(__dirname, "RaceSelectionPanel.jsx"), "utf8");
const localesDir = join(__dirname, "..", "..", "..", "public", "locales");

test("#6964 en for gammel rytter kan ikke vælges (både mobil-listen og tabellen)", () => {
  const disabled = panel.match(/const disabled = \(\(rider\.injured \|\| rider\.overAge\) && !checked\)/g) || [];
  assert.equal(disabled.length, 2, "begge rytter-visninger skal deaktivere en for gammel rytter");
});

test("#6964 en for gammel rytter får en kort grund i begge visninger", () => {
  const badges = panel.match(/\{rider\.overAge && <OverAgeBadge label=\{t\("selection\.overAge"\)\} \/>\}/g) || [];
  assert.equal(badges.length, 2);
});

test("#6964 grund- og fejltekst findes på alle fem sprog", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const races = JSON.parse(readFileSync(join(localesDir, lang, "races.json"), "utf8"));
    assert.equal(typeof races.selection?.overAge, "string", `${lang}: selection.overAge`);
    assert.ok(races.selection.overAge.length > 0);
    assert.equal(typeof races.selection?.errors?.selection_rider_over_age, "string", `${lang}: selection.errors.selection_rider_over_age`);
  }
});
