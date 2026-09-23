import test from "node:test";
import assert from "node:assert/strict";

import { isKnownNotificationType } from "../lib/notificationTypes.js";
import { DISCORD_WELCOME_TYPE } from "../lib/discordWelcomeNotification.js";
import {
  BACKFILL_TAG,
  buildBackfillInvite,
  parseArgs,
  pendingRecipients,
  recipientIdsFromTeams,
  splitByLanguage,
  usersMissingDiscordId,
} from "./sendDiscordInviteBackfill.mjs";

test("dry-run er default: kun --execute skriver", () => {
  assert.deepEqual(parseArgs([]), { execute: false, conflicting: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { execute: false, conflicting: false });
  assert.deepEqual(parseArgs(["--execute"]), { execute: true, conflicting: false });
});

test("--execute OG --dry-run sammen flages som modsigende (CodeRabbit-fund)", () => {
  assert.equal(parseArgs(["--execute", "--dry-run"]).conflicting, true);
  assert.equal(parseArgs(["--dry-run", "--execute"]).conflicting, true);
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

test("segment: kun brugere der mangler discord_id", () => {
  assert.deepEqual(
    usersMissingDiscordId([
      { id: "u-1", discord_id: null },
      { id: "u-2", discord_id: "already-linked" },
      { id: "u-3", discord_id: "" },
      { id: "u-4" },
      null,
    ]).map((u) => u.id),
    ["u-1", "u-3", "u-4"]
  );
  assert.deepEqual(usersMissingDiscordId(null), []);
});

test("en modtager der allerede har discord_welcome (sweep ELLER tidligere backfill) springes over", () => {
  const recipients = ["u-1", "u-2", "u-3"];
  const existing = [
    { user_id: "u-1", metadata: { backfill: "2026-09" } }, // tidligere backfill-koersel
    { user_id: "u-3", metadata: {} }, // sendt af sweepen, ingen backfill-tag
  ];
  assert.deepEqual(pendingRecipients(recipients, existing), ["u-2"]);
});

test("dedupe er BREDERE end backfill-tagget: enhver discord_welcome-raekke taeller", () => {
  const recipients = ["u-1", "u-2"];
  const existing = [{ user_id: "u-1", metadata: null }];
  assert.deepEqual(pendingRecipients(recipients, existing), ["u-2"]);
  assert.deepEqual(pendingRecipients(recipients, [], ), ["u-1", "u-2"]);
  assert.deepEqual(pendingRecipients(recipients, null), ["u-1", "u-2"]);
});

test("splitByLanguage: DA taeller eksplicit, alt andet (inkl. mangler) taeller som EN", () => {
  assert.deepEqual(
    splitByLanguage([{ language: "da" }, { language: "en" }, { language: null }, {}]),
    { en: 3, da: 1 }
  );
  assert.deepEqual(splitByLanguage([]), { en: 0, da: 0 });
  assert.deepEqual(splitByLanguage(null), { en: 0, da: 0 });
});

test("invitationen genbruger discord_welcome-typen og sweepens payload, mærket med backfill-tag", () => {
  const invite = buildBackfillInvite();
  assert.equal(invite.type, DISCORD_WELCOME_TYPE);
  assert.ok(isKnownNotificationType(invite.type), "genbrug af en allerede-registreret type — ingen ny constraint/TYPE_CONFIG noedvendig");
  assert.equal(invite.relatedId, null);
  assert.equal(invite.metadata.backfill, BACKFILL_TAG);
  assert.equal(invite.metadata.titleCode, "notif.discordWelcome.title");
  assert.equal(invite.metadata.messageCode, "notif.discordWelcome.message");

  // EN-fallback i selve raekken skal vaere rigtig tekst, ikke en tom streng.
  assert.ok(invite.title.length > 0);
  assert.ok(invite.message.length > 0);
});
