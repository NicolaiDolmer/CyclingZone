import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESEND_COOLDOWN_SECONDS,
  parseRateLimitSeconds,
  cooldownSecondsLeft,
  cooldownUntil,
} from "./resendCooldown.js";

// #2826 — resend-knappen havde ingen cooldown. Klikkede spilleren to gange
// inden for et minut, svarede Supabase med en rate-limit-fejl i stedet for
// hjælp. Nedtællingen skal være SAND, så vi læser serverens eget sekundtal ud
// af beskeden når vi har det.

test("parser begge rate-limit-ordlyde vi har set i prod (#2068/#2826)", () => {
  assert.equal(
    parseRateLimitSeconds({ message: "For security purposes, you can only request this after 54 seconds" }),
    54,
  );
  assert.equal(
    parseRateLimitSeconds({ message: "For security purposes, you can only request this once every 60 seconds" }),
    60,
  );
  assert.equal(parseRateLimitSeconds("you can only request this after 7 second"), 7);
});

test("returnerer null for fejl der ikke er rate-limits (#2826)", () => {
  assert.equal(parseRateLimitSeconds({ message: "Invalid login credentials" }), null);
  assert.equal(parseRateLimitSeconds({ message: "Email not confirmed" }), null);
  assert.equal(parseRateLimitSeconds(null), null);
  assert.equal(parseRateLimitSeconds(undefined), null);
  assert.equal(parseRateLimitSeconds({}), null);
  assert.equal(parseRateLimitSeconds(123), null);
});

test("lofter absurde ventetider så knappen ikke låses for evigt (#2826)", () => {
  assert.equal(parseRateLimitSeconds({ message: "request this after 99999 seconds" }), 600);
  assert.equal(parseRateLimitSeconds({ message: "request this after 0 seconds" }), null);
});

test("cooldownSecondsLeft runder op og bunder i 0 (#2826)", () => {
  const now = 1_000_000;
  assert.equal(cooldownSecondsLeft(now + 60_000, now), 60);
  assert.equal(cooldownSecondsLeft(now + 1, now), 1); // stadig aktiv → vis 1, ikke 0
  assert.equal(cooldownSecondsLeft(now, now), 0);
  assert.equal(cooldownSecondsLeft(now - 5_000, now), 0);
  assert.equal(cooldownSecondsLeft(null, now), 0);
});

test("cooldownUntil bruger default når sekunder mangler eller er ugyldige (#2826)", () => {
  const now = 1_000_000;
  assert.equal(cooldownUntil(now), now + RESEND_COOLDOWN_SECONDS * 1000);
  assert.equal(cooldownUntil(now, 30), now + 30_000);
  assert.equal(cooldownUntil(now, 0), now + RESEND_COOLDOWN_SECONDS * 1000);
  assert.equal(cooldownUntil(now, -5), now + RESEND_COOLDOWN_SECONDS * 1000);
  assert.equal(cooldownUntil(now, undefined), now + RESEND_COOLDOWN_SECONDS * 1000);
});

test("en server-oplyst ventetid vinder over defaulten (#2826)", () => {
  // Kernen: rammer vi rate-limitten, skal nedtællingen matche serveren, ikke
  // vores gæt på 60 sekunder.
  const now = 1_000_000;
  const seconds = parseRateLimitSeconds({ message: "you can only request this after 54 seconds" });
  assert.equal(cooldownSecondsLeft(cooldownUntil(now, seconds), now), 54);
});
