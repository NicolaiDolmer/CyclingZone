// backend/scripts/notify-4376-sponsor-correction.test.js
// #4376 · Test af de rene funktioner: modtager-filter + besked-valg pr. sprog.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSponsorCorrectionMessage,
  selectHumanManagerRecipients,
  SPONSOR_CORRECTION_TYPE,
} from "./notify-4376-sponsor-correction.js";

test("type er admin_notice (generisk, allerede i notifications_type_check)", () => {
  assert.equal(SPONSOR_CORRECTION_TYPE, "admin_notice");
});

test("buildSponsorCorrectionMessage: 'da' giver ren DA-tekst", () => {
  const { title, message } = buildSponsorCorrectionMessage("da");
  assert.equal(title, "Din sponsoraftale har fået et divisions-tillæg");
  assert.match(message, /Sponsoraftaler blev prissat/);
  assert.doesNotMatch(message, /Sponsor deals were priced/);
});

test("buildSponsorCorrectionMessage: EN, ukendt kode og manglende sprog giver ren EN-tekst (ejer 4/9)", () => {
  for (const language of ["en", "fr", null, undefined, ""]) {
    const { title, message } = buildSponsorCorrectionMessage(language);
    assert.equal(title, "Your sponsor deal got a division top-up");
    assert.match(message, /Sponsor deals were priced against the division/);
    assert.doesNotMatch(message, /Sponsoraftaler blev prissat/);
  }
});

test("selectHumanManagerRecipients: filtrerer AI/bank/frozen/test-hold og hold uden user_id", () => {
  const teams = [
    { id: 1, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    { id: 2, user_id: "u2", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
    { id: 3, user_id: "u3", is_ai: false, is_bank: true, is_frozen: false, is_test_account: false },
    { id: 4, user_id: "u4", is_ai: false, is_bank: false, is_frozen: true, is_test_account: false },
    { id: 5, user_id: "u5", is_ai: false, is_bank: false, is_frozen: false, is_test_account: true },
    { id: 6, user_id: null, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
  ];
  const languageByUserId = new Map([["u1", "da"]]);
  const recipients = selectHumanManagerRecipients(teams, languageByUserId);
  assert.deepEqual(recipients, [{ userId: "u1", language: "da" }]);
});

test("selectHumanManagerRecipients: distinct pr. user_id (flere hold, samme bruger)", () => {
  const teams = [
    { id: 1, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    { id: 2, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
  ];
  const recipients = selectHumanManagerRecipients(teams, new Map());
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].language, null);
});

test("selectHumanManagerRecipients: manglende users.language-opslag falder tilbage til null", () => {
  const teams = [
    { id: 1, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
  ];
  const recipients = selectHumanManagerRecipients(teams, new Map());
  assert.equal(recipients[0].language, null);
});
