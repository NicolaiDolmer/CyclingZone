import test from "node:test";
import assert from "node:assert/strict";

import {
  MESSAGE_CODE,
  NOTIFICATION_TYPE,
  TITLE_CODE,
  buildInvite,
  parseArgs,
  pendingRecipients,
  recipientIdsFromTeams,
} from "./sendSurveyInvite.mjs";

test("dry-run er default: kun --apply skriver", () => {
  assert.deepEqual(parseArgs(["--survey", "2026-09-features"]), {
    slug: "2026-09-features",
    apply: false,
  });
  assert.deepEqual(parseArgs(["--survey", "2026-09-features", "--dry-run"]), {
    slug: "2026-09-features",
    apply: false,
  });
  assert.deepEqual(parseArgs(["--survey", "2026-09-features", "--apply"]), {
    slug: "2026-09-features",
    apply: true,
  });
  assert.deepEqual(parseArgs([]), { slug: null, apply: false });
});

test("--survey uden vaerdi er ikke en slug", () => {
  assert.equal(parseArgs(["--survey"]).slug, null);
  assert.equal(parseArgs(["--survey", "--apply"]).slug, null, "naeste flag maa ikke laeses som slug");
  assert.equal(parseArgs(["--survey", "--apply"]).apply, true);
});

test("modtagere er unikke user_id i stabil raekkefoelge, uden tomme", () => {
  assert.deepEqual(
    recipientIdsFromTeams([
      { user_id: "u-2" },
      { user_id: "u-1" },
      { user_id: "u-2" },
      { user_id: null },
      {},
      null,
    ]),
    ["u-2", "u-1"]
  );
  assert.deepEqual(recipientIdsFromTeams(null), []);
});

test("en modtager der allerede har invitationen springes over (idempotens)", () => {
  const recipients = ["u-1", "u-2", "u-3"];
  const existing = [
    { user_id: "u-1", metadata: { surveySlug: "2026-09-features" } },
    { user_id: "u-3", metadata: { surveySlug: "2026-09-features" } },
  ];
  assert.deepEqual(pendingRecipients(recipients, existing, "2026-09-features"), ["u-2"]);
  assert.deepEqual(pendingRecipients(recipients, existing, "2026-09-features").length, 1);
});

test("en invitation til ET skema undertrykker ikke invitationen til det naeste", () => {
  const recipients = ["u-1", "u-2"];
  const existing = [
    { user_id: "u-1", metadata: { surveySlug: "2026-09-features" } },
    { user_id: "u-2", metadata: null },
    { user_id: "u-2", metadata: {} },
  ];
  assert.deepEqual(pendingRecipients(recipients, existing, "2027-01-features"), ["u-1", "u-2"]);
  assert.deepEqual(pendingRecipients(recipients, [], "2026-09-features"), ["u-1", "u-2"]);
  assert.deepEqual(pendingRecipients(recipients, null, "2026-09-features"), ["u-1", "u-2"]);
});

test("invitationen er en admin_notice med i18n-koder og skemaets slug i metadata", () => {
  const invite = buildInvite("2026-09-features");
  assert.equal(invite.type, NOTIFICATION_TYPE);
  assert.equal(invite.type, "admin_notice", "en ny type ville kraeve constraint + TYPE_CONFIG + parity-tests");
  assert.equal(invite.metadata.titleCode, TITLE_CODE);
  assert.equal(invite.metadata.messageCode, MESSAGE_CODE);
  assert.equal(invite.metadata.surveySlug, "2026-09-features");

  // EN-fallback i selve raekken skal vaere rigtig tekst, ikke selve noeglen:
  // det er den tekst en klient uden i18n viser, og den er en del af dedupe-noeglen.
  assert.ok(invite.title.length > 0);
  assert.notEqual(invite.title, TITLE_CODE);
  assert.ok(invite.message.length > 0);
  assert.notEqual(invite.message, MESSAGE_CODE);
});
