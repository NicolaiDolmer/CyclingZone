import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Forum-synlighed (#3199, ejer-beslutning 25/8): Forum flyttet fra sidst i
// Klubhus-gruppen til lige efter Indbakke (/notifications), så den gule
// ulæst-prik sidder i øjenhøjde ved siden af den prik spillerne allerede
// reagerer på. Forward-guard (kilde-tekst, samme mønster som
// Layout.jargonTooltips.test.js) — fanger hvis nogen flytter punktet igen
// uden at opdatere denne test bevidst.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "Layout.jsx"), "utf8");

test("Klubhus-gruppen: /forum kommer LIGE EFTER /notifications, ikke sidst", () => {
  const notificationsIdx = src.indexOf('to: "/notifications"');
  const forumIdx = src.indexOf('to: "/forum"');
  const teamIdx = src.indexOf('to: "/team"');
  assert.ok(notificationsIdx !== -1 && forumIdx !== -1 && teamIdx !== -1, "alle tre nav-punkter skal findes");
  assert.ok(notificationsIdx < forumIdx, "/forum skal stå EFTER /notifications");
  assert.ok(forumIdx < teamIdx, "/forum skal stå FØR /team (dvs. lige efter /notifications, ikke sidst i gruppen)");
  // Ingen andre klubhus-punkter må ligge imellem notifications og forum.
  const between = src.slice(notificationsIdx, forumIdx);
  assert.ok(!/to: "\/team"|to: "\/training"|to: "\/finance"/.test(between), "intet andet klubhus-punkt må stå mellem /notifications og /forum");
});

test("forum-nav-punktet beholder ulæst-prikken (#4118/#3451) efter flytningen", () => {
  const forumLine = src.slice(src.indexOf('to: "/forum"'), src.indexOf('to: "/forum"') + 160);
  assert.match(forumLine, /dot: true/);
  assert.match(forumLine, /dotLabel: t\("a11y\.unreadForum"\)/);
});
