import test from "node:test";
import assert from "node:assert/strict";

import { DISCORD_WELCOME_TYPE, buildDiscordWelcomeNotification } from "./discordWelcomeNotification.js";
import { isKnownNotificationType } from "./notificationTypes.js";

test("DISCORD_WELCOME_TYPE er registreret i NOTIFICATION_TYPES", () => {
  assert.ok(isKnownNotificationType(DISCORD_WELCOME_TYPE));
  assert.equal(DISCORD_WELCOME_TYPE, "discord_welcome");
});

test("buildDiscordWelcomeNotification: payload-form", () => {
  const payload = buildDiscordWelcomeNotification();
  assert.equal(payload.type, DISCORD_WELCOME_TYPE);
  assert.equal(payload.relatedId, null);
  assert.ok(payload.title.length > 0);
  assert.ok(payload.message.length > 0);
  assert.equal(payload.metadata.titleCode, "notif.discordWelcome.title");
  assert.equal(payload.metadata.messageCode, "notif.discordWelcome.message");
});
