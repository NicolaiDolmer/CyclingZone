// #8081: rene regler for akademisiden udgave A.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACADEMY_PAGE_V2_FLAG_KEY,
  AGE_FOCUS_OPTIONS,
  ageFocusChoice,
  ageFocusForSave,
  initialAcademyTab,
  talentSquad,
} from "./academyV2Model.ts";

test("kontaktens nøgle er den samme som backend seeder", () => {
  assert.equal(ACADEMY_PAGE_V2_FLAG_KEY, "academy_page_v2_8081");
});

test("aldersfokus: Blandet + 16-19; Blandet gemmes som null", () => {
  assert.deepEqual([...AGE_FOCUS_OPTIONS], ["mixed", "16", "17", "18", "19"]);
  assert.equal(ageFocusChoice(null), "mixed");
  assert.equal(ageFocusChoice("17"), "17");
  assert.equal(ageFocusChoice("23"), "mixed");
  assert.equal(ageFocusForSave("mixed"), null);
  assert.equal(ageFocusForSave("19"), "19");
});

test("A1: tomt optag åbner på Dine talenter, ellers på optaget", () => {
  const base = { regularCount: 0, giftCount: 0, pullOpen: false, talentCount: 4 };
  assert.equal(initialAcademyTab(base), "talents");
  assert.equal(initialAcademyTab({ ...base, regularCount: 2 }), "intake");
  assert.equal(initialAcademyTab({ ...base, giftCount: 1 }), "intake");
  assert.equal(initialAcademyTab({ ...base, pullOpen: true }), "intake");
  // Ingen talenter: optaget, hvor den tomme tilstand peger videre.
  assert.equal(initialAcademyTab({ ...base, talentCount: 0 }), "intake");
});

test("talentets trup: riders.squad først, ellers sæsonalderen", () => {
  assert.equal(talentSquad({ squad: "u23", birthdate: "2010-01-01" }, 2026), "u23");
  assert.equal(talentSquad({ squad: null, birthdate: "2009-06-01" }, 2026), "junior");
  assert.equal(talentSquad({ squad: "senior", birthdate: "2006-06-01" }, 2026), "u23");
  assert.equal(talentSquad({ squad: null, birthdate: null }, null), null);
});
