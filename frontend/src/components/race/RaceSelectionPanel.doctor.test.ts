// #6984 M4 + M8: holdlægens ord på holdudtagelsen. Backend sender `doctor` kun under
// condition_model_v2; panelet viser intet uden. Kildekode-guards (node --test uden DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(__dirname, "RaceSelectionPanel.jsx"), "utf8");
const note = readFileSync(join(__dirname, "DoctorNote.tsx"), "utf8");
const localesDir = join(__dirname, "..", "..", "..", "public", "locales");
const LANGS = ["en", "da", "fr", "es", "nl"];

test("lægens ord vises i både mobil-listen og tabellen, kun når doctor findes", () => {
  assert.equal((panel.match(/<DoctorNote /g) || []).length, 2);
  assert.ok(panel.includes("data?.doctor?.riders?.[rider.id] &&"), "mobil: kun med data");
  assert.ok((panel.match(/\{data\?\.doctor && \(/g) || []).length >= 2, "tabel: kolonne og celle kun med data");
});

test("DoctorNote viser aldrig tal, kun oversatte ord", () => {
  assert.ok(!/fatigue|toFixed|\{entry\.(fatigue|days)/.test(note));
  assert.ok(note.includes("selection.doctor.assessment."));
  assert.ok(note.includes("selection.doctor.season."));
});

test("alle sprog har alle lægens nøgler", () => {
  const assessment = ["fresh", "ready", "tired", "rest", "injured"];
  const season = ["ready", "ready_but_spent_later", "already_heavy", "rest_first"];
  for (const lang of LANGS) {
    const doc = JSON.parse(readFileSync(join(localesDir, lang, "races.json"), "utf8")).selection?.doctor;
    assert.ok(doc?.label && doc?.hint, `${lang}: label/hint`);
    for (const k of assessment) assert.ok(doc.assessment?.[k], `${lang}: assessment.${k}`);
    for (const k of season) assert.ok(doc.season?.[k], `${lang}: season.${k}`);
    for (const text of [doc.hint, ...Object.values(doc.season)]) {
      assert.ok(!text.includes("—"), `${lang}: ingen em-dash`);
      assert.ok(!/\d/.test(text), `${lang}: ingen tal`);
    }
  }
});
