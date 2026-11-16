// #8081: rene regler for akademisiden udgave A.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACADEMY_PAGE_V2_FLAG_KEY,
  AGE_FOCUS_OPTIONS,
  ageFocusChoice,
  ageFocusDistribution,
  ageFocusForSave,
  buildTalentOrigins,
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

test("fordeling pr. alder: Blandet efter skitsen, et valgt fokus fylder mest, kun ord", () => {
  const line = (focus: string | null) => ageFocusDistribution(focus).map((r) => `${r.age}:${r.share}:${r.squad}`).join(" ");
  assert.equal(line("mixed"), "16:many:junior 17:some:junior 18:some:junior 19:few:u23");
  assert.equal(line(null), line("mixed"), "Blandet er standard (null)");
  assert.equal(line("17"), "16:few:junior 17:many:junior 18:few:junior 19:few:u23");
  assert.equal(line("19"), "16:few:junior 17:few:junior 18:few:junior 19:many:u23");
  for (const focus of ["mixed", "16", "17", "18", "19"]) {
    const rows = ageFocusDistribution(focus);
    assert.equal(rows.filter((r) => r.share === "many").length, 1, `${focus}: én alder fylder mest`);
    for (const r of rows) assert.ok(["many", "some", "few"].includes(r.share), "kun kvalitative ord");
  }
});

test("Kom via: signeret tilbud vinder, ellers vundet ungdomsauktion, ellers intet", () => {
  const origins = buildTalentOrigins({
    signedIntake: [{ rider_id: "a" }, { rider_id: "b" }, { rider_id: null }],
    youthAuctionWins: [
      { rider_id: "b", current_bidder_id: "team", is_youth: true },
      { rider_id: "c", current_bidder_id: "team", is_youth: true },
      { rider_id: "d", current_bidder_id: "team", is_youth: false },
      { rider_id: "e", current_bidder_id: null, is_guaranteed_sale: false, is_youth: true },
    ],
  });
  assert.equal(origins.get("a"), "offer");
  assert.equal(origins.get("b"), "offer", "et signeret tilbud vinder over en auktion");
  assert.equal(origins.get("c"), "youthAuction");
  assert.equal(origins.has("d"), false, "en senior-auktion er ingen ungdomsauktion");
  assert.equal(origins.has("e"), false, "en auktion uden køber er ikke vundet");
  assert.equal(buildTalentOrigins().size, 0);
});
