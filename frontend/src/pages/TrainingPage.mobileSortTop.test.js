import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5805 (ejer 26/9): på telefonen står sorteringen OVER træningstabellen.
// TrainingMobileToday tegner `sortSlot` før tabellen og `assistantSlot` efter
// den, så kontrakten er at kontrollen sendes i sortSlot og ikke i assistantSlot.
const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");
const today = readFileSync(join(__dirname, "../components/training/mobile/TrainingMobileToday.tsx"), "utf8");

test("#5805 mobil-sorteringen sendes i sortSlot, ikke i assistantSlot", () => {
  assert.match(page, /sortSlot=\{\s*<RosterMobileSortControl/);
  assert.doesNotMatch(page, /assistantSlot=\{[^}]*<RosterMobileSortControl/);
});

test("#5805 TrainingMobileToday tegner sortSlot før tabellen og assistantSlot efter", () => {
  const sortAt = today.indexOf("{sortSlot}");
  const rosterAt = today.indexOf("<TrainingMobileRoster");
  const assistantAt = today.indexOf("{assistantSlot}");
  assert.ok(sortAt > -1 && rosterAt > -1 && assistantAt > -1);
  assert.ok(sortAt < rosterAt, "sorteringen skal stå over tabellen");
  assert.ok(assistantAt > rosterAt);
});
