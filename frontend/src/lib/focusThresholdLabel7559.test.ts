// #7559: Tærskel træner ikke længere enkeltstart, så session-navnet i
// træningsrapporten (training.focus_threshold i rider-namespacet) må ikke
// nævne TT/CRI/CLM i nogen sprogfil.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LANGS = ["en", "da", "es", "fr", "nl"];

for (const lang of LANGS) {
  test(`#7559 focus_threshold i ${lang} nævner ikke enkeltstart`, () => {
    const file = new URL(`../../public/locales/${lang}/rider.json`, import.meta.url);
    const rider = JSON.parse(readFileSync(file, "utf8"));
    const label = rider.training.focus_threshold;
    assert.ok(label && label.length > 0);
    assert.doesNotMatch(label, /\/|\bTT\b|\bCRI\b|\bCLM\b/);
  });
}
