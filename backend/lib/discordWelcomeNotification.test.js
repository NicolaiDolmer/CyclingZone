import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DISCORD_WELCOME_TYPE, buildDiscordWelcomeNotification } from "./discordWelcomeNotification.js";
import { isKnownNotificationType } from "./notificationTypes.js";

const BUNDLE = JSON.parse(
  readFileSync(new URL("./locales/backendMessages.generated.json", import.meta.url), "utf8"),
);
const CARD_KEYS = ["title", "message", "forumLine", "cta"];

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

// #2761: kortets knap + forum-linje er egne noegler ved siden af den ejer-
// godkendte title/message. Findes en noegle kun paa det ene sprog, viser
// kortet den raa noegle for den anden halvdel af spillerne.
test("#2761 notif.discordWelcome har title/message/forumLine/cta paa baade en og da", () => {
  for (const lang of ["en", "da"]) {
    for (const key of CARD_KEYS) {
      const value = BUNDLE[lang]?.[`notif.discordWelcome.${key}`];
      assert.equal(typeof value, "string", `${lang}: notif.discordWelcome.${key} mangler`);
      assert.ok(value.trim().length > 0, `${lang}: notif.discordWelcome.${key} er tom`);
      assert.ok(!value.includes("—"), `${lang}: notif.discordWelcome.${key} indeholder em-dash`);
    }
  }
});

test("#2761 forumLine har praecis eet <forum>-link paa begge sprog (Trans-komponenten)", () => {
  for (const lang of ["en", "da"]) {
    const line = BUNDLE[lang]["notif.discordWelcome.forumLine"];
    assert.equal((line.match(/<forum>/g) || []).length, 1, `${lang}: forventer een <forum>`);
    assert.equal((line.match(/<\/forum>/g) || []).length, 1, `${lang}: forventer een </forum>`);
    assert.match(line, /<forum>[^<]+<\/forum>/, `${lang}: <forum> skal omslutte linkteksten`);
  }
});
