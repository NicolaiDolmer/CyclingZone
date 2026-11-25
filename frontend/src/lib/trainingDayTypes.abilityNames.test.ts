import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { sessionI18nKey } from "./trainingDayTypes.js";

function readLocale(language: string, namespace: string) {
  const file = new URL(`../../public/locales/${language}/${namespace}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
}

test("Danish training notes use the rider catalogue ability names", () => {
  const { dayPanel } = readLocale("da", "training");
  const notes = [
    dayPanel[sessionI18nKey("dayPanel.sessionNote", "sprint", true).split(".")[1]],
    dayPanel.sessionNote_lead_out,
    dayPanel.sessionNote_cobbled_sectors,
    dayPanel.sessionNote_echelon_drills,
  ].map((note: string) => note.toLocaleLowerCase("da"));

  assert.ok(notes[0].includes("sprint"), notes[0]);
  assert.ok(notes[1].includes("sprint"), notes[1]);
  assert.ok(notes[2].includes("modstandskraft"), notes[2]);
  assert.ok(notes[3].includes("modstandskraft"), notes[3]);
  assert.doesNotMatch(notes.join("\n"), /\b(?:topfart|robusthed)\b/);
});
