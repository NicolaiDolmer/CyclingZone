import { test } from "node:test";
import assert from "node:assert/strict";
import { intlLocale, formatClock24 } from "./intlLocale.ts";
import { buildHelpNumbers } from "./helpNumbers.js";
import { formatCloseDate } from "./survey.js";
import { formatForumDate } from "../components/forum/forumIdentity.js";

// Refs #6785. Output for en og da skal vaere bit-for-bit som foer lib/intlLocale.ts
// blev indfoert; de nye sprog (fr/es/nl) faar deres egen Intl-locale i stedet for en-GB.

test("intlLocale: da og en giver de samme locales som de gamle ternaries", () => {
  assert.equal(intlLocale("da"), "da-DK");
  assert.equal(intlLocale("da-DK"), "da-DK");
  assert.equal(intlLocale("en"), "en-GB");
  assert.equal(intlLocale("en", { en: "en-US" }), "en-US");
  assert.equal(intlLocale("da", { en: "en-US" }), "da-DK");
});

test("intlLocale: tomt sprog og pseudo-locale falder tilbage til en", () => {
  assert.equal(intlLocale(undefined), "en-GB");
  assert.equal(intlLocale(""), "en-GB");
  assert.equal(intlLocale("en-XA"), "en-GB");
});

test("intlLocale: nye sprog sendes uaendret videre til Intl", () => {
  assert.equal(intlLocale("fr"), "fr");
  assert.equal(intlLocale("es"), "es");
  assert.equal(intlLocale("nl"), "nl");
  assert.equal(intlLocale("nl-BE"), "nl-BE");
});

test("formatClock24: 24-timers HH:MM i en fast tidszone, uden AM/PM", () => {
  // 2026-10-17 12:05 UTC er 14:05 i Koebenhavn (sommertid).
  const ms = Date.UTC(2026, 9, 17, 12, 5);
  assert.equal(formatClock24(ms, "Europe/Copenhagen"), "14:05");
  assert.equal(formatClock24(new Date(ms), "Europe/Copenhagen"), "14:05");
  assert.equal(formatClock24(Date.UTC(2026, 9, 17, 22, 0), "Europe/Copenhagen"), "00:00");
});

test("formatClock24: ugyldig eller manglende vaerdi giver tom streng", () => {
  assert.equal(formatClock24(null, "Europe/Copenhagen"), "");
  assert.equal(formatClock24("ikke en dato", "Europe/Copenhagen"), "");
});

test("buildHelpNumbers: en bruger stadig komma, da stadig punktum, fr faar sin egen separator", () => {
  assert.equal(buildHelpNumbers("en").startingBalance, "500,000");
  assert.equal(buildHelpNumbers("da").startingBalance, "500.000");
  assert.notEqual(buildHelpNumbers("fr").startingBalance, "500,000");
});

test("formatCloseDate: da og en uaendret, fr bruger fransk datoformat", () => {
  const closesAt = "2026-09-14T10:00:00Z";
  assert.equal(formatCloseDate(closesAt, "da"), "mandag den 14. september");
  assert.equal(formatCloseDate(closesAt, "en"), "Monday 14 September");
  assert.equal(formatCloseDate(closesAt, "fr"), "lundi 14 septembre");
});

test("formatForumDate: en bruger en-GB og da bruger da-DK som foer", () => {
  const iso = "2026-10-17T12:05:00Z";
  assert.match(formatForumDate(iso, "en"), /17 Oct.*14:05/);
  assert.match(formatForumDate(iso, "da"), /17\. okt\..*14\.05/);
});
