import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5805 (ejer 26/9): på telefonen står sorteringen ØVERST ved træningstabellen,
// ikke under den. Kontrakten her: kontrollen sendes i sortSlot (header-udgaven)
// til telefonens række-liste (TodayRowsMobile), som tegner den før rækkerne.
// #6030: TrainingMobileToday/TrainingMobileRoster (training_program_cells off)
// er slettet; telefonen tegner altid TodayRowsMobile.
const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");
const rows = readFileSync(join(__dirname, "../components/training/TodayRowMobile.tsx"), "utf8");

test("#5805 mobil-sorteringen sendes i sortSlot som header-udgaven, ikke i assistantSlot", () => {
  assert.match(page, /sortSlot=\{\s*<RosterMobileSortControl\s+header\b/);
  assert.doesNotMatch(page, /assistantSlot=\{[^}]*<RosterMobileSortControl/);
});

test("#5805 TodayRowsMobile tegner sortSlot før rækkerne", () => {
  const slotAt = rows.indexOf("{sortSlot}");
  const mapAt = rows.indexOf("riders.map(");
  assert.ok(slotAt > -1 && mapAt > -1, "sortSlot og rækkerne skal findes");
  assert.ok(slotAt < mapAt, "sorteringen skal stå over rækkerne");
});
