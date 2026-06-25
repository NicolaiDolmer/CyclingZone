import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldPromptNps,
  throttleElapsed,
  normalizeNpsSubmission,
  parseTimestamp,
  NPS_THROTTLE_MS,
} from "./npsGating.js";

const NOW = Date.parse("2026-06-25T12:00:00.000Z");

// --- shouldPromptNps: regel 1 (kræver løb-resultat) ---------------------------

test("viser IKKE prompt uden et set løb-resultat", () => {
  assert.equal(
    shouldPromptNps({ hasSeenRaceResult: false, hasResponded: false, lastPromptedAt: null, now: NOW }),
    false,
  );
});

test("viser prompt efter første løb-resultat når aldrig promptet/svaret", () => {
  assert.equal(
    shouldPromptNps({ hasSeenRaceResult: true, hasResponded: false, lastPromptedAt: null, now: NOW }),
    true,
  );
});

// --- regel 3 (allerede svaret) -----------------------------------------------

test("viser IKKE prompt hvis brugeren allerede har svaret", () => {
  assert.equal(
    shouldPromptNps({ hasSeenRaceResult: true, hasResponded: true, lastPromptedAt: null, now: NOW }),
    false,
  );
});

// --- regel 2 (max 1 / 90 dage) -----------------------------------------------

test("viser IKKE prompt inden for 90-dages-vinduet", () => {
  const promptedAt = new Date(NOW - (NPS_THROTTLE_MS - 1)).toISOString(); // 1 ms inden vinduet udløber
  assert.equal(
    shouldPromptNps({ hasSeenRaceResult: true, hasResponded: false, lastPromptedAt: promptedAt, now: NOW }),
    false,
  );
});

test("viser prompt igen når 90 dage er gået", () => {
  const promptedAt = new Date(NOW - NPS_THROTTLE_MS).toISOString(); // præcis 90 dage siden
  assert.equal(
    shouldPromptNps({ hasSeenRaceResult: true, hasResponded: false, lastPromptedAt: promptedAt, now: NOW }),
    true,
  );
});

// --- throttleElapsed ----------------------------------------------------------

test("throttleElapsed: null/aldrig-vist → true", () => {
  assert.equal(throttleElapsed(null, NOW), true);
  assert.equal(throttleElapsed(undefined, NOW), true);
});

test("throttleElapsed: lige under vs lige over grænsen", () => {
  assert.equal(throttleElapsed(new Date(NOW - (NPS_THROTTLE_MS - 1000)).toISOString(), NOW), false);
  assert.equal(throttleElapsed(new Date(NOW - (NPS_THROTTLE_MS + 1000)).toISOString(), NOW), true);
});

// --- parseTimestamp -----------------------------------------------------------

test("parseTimestamp: ugyldig/tom → null", () => {
  assert.equal(parseTimestamp(null), null);
  assert.equal(parseTimestamp(""), null);
  assert.equal(parseTimestamp("not-a-date"), null);
  assert.equal(parseTimestamp("2026-06-25T12:00:00.000Z"), NOW);
});

// --- normalizeNpsSubmission ---------------------------------------------------

test("normalizeNpsSubmission: gyldig score + trimmet reason", () => {
  assert.deepEqual(normalizeNpsSubmission({ score: 9, reason: "  great game  " }), { score: 9, reason: "great game" });
});

test("normalizeNpsSubmission: tom reason → null", () => {
  assert.deepEqual(normalizeNpsSubmission({ score: 0, reason: "   " }), { score: 0, reason: null });
  assert.deepEqual(normalizeNpsSubmission({ score: 10 }), { score: 10, reason: null });
});

test("normalizeNpsSubmission: score uden for 0-10 eller ikke-heltal → null", () => {
  assert.equal(normalizeNpsSubmission({ score: -1 }), null);
  assert.equal(normalizeNpsSubmission({ score: 11 }), null);
  assert.equal(normalizeNpsSubmission({ score: 5.5 }), null);
  assert.equal(normalizeNpsSubmission({ score: "abc" }), null);
});
