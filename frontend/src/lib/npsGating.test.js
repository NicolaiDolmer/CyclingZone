import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  shouldPromptNps,
  throttleElapsed,
  hasEnoughRaceDays,
  normalizeNpsSubmission,
  parseTimestamp,
  NPS_THROTTLE_MS,
  NPS_MIN_RACE_DAYS,
} from "./npsGating.js";

const NOW = Date.parse("2026-06-25T12:00:00.000Z");

// --- shouldPromptNps: regel 1 (mindst 3 afsluttede løbsdage, #4997) -----------

test("viser IKKE prompt før holdet har nok afsluttede løbsdage", () => {
  for (const days of [0, 1, 2]) {
    assert.equal(
      shouldPromptNps({ completedRaceDays: days, hasResponded: false, lastPromptedAt: null, now: NOW }),
      false,
      `${days} løbsdage burde ikke udløse prompten`,
    );
  }
});

test("viser prompt fra og med tærsklen når der aldrig er promptet/svaret", () => {
  assert.equal(
    shouldPromptNps({ completedRaceDays: NPS_MIN_RACE_DAYS, hasResponded: false, lastPromptedAt: null, now: NOW }),
    true,
  );
  assert.equal(
    shouldPromptNps({ completedRaceDays: 42, hasResponded: false, lastPromptedAt: null, now: NOW }),
    true,
  );
});

test("ukendt/ugyldigt løbsdags-tal lukker prompten (fejlet opslag må ikke åbne den)", () => {
  for (const value of [null, undefined, NaN, "mange"]) {
    assert.equal(
      shouldPromptNps({ completedRaceDays: value, hasResponded: false, lastPromptedAt: null, now: NOW }),
      false,
    );
  }
});

// --- regel 3 (allerede svaret) -----------------------------------------------

test("viser IKKE prompt hvis brugeren allerede har svaret", () => {
  assert.equal(
    shouldPromptNps({ completedRaceDays: 10, hasResponded: true, lastPromptedAt: null, now: NOW }),
    false,
  );
});

// --- regel 2 (max 1 / 90 dage) -----------------------------------------------

test("viser IKKE prompt inden for 90-dages-vinduet", () => {
  const promptedAt = new Date(NOW - (NPS_THROTTLE_MS - 1)).toISOString(); // 1 ms inden vinduet udløber
  assert.equal(
    shouldPromptNps({ completedRaceDays: 10, hasResponded: false, lastPromptedAt: promptedAt, now: NOW }),
    false,
  );
});

test("viser prompt igen når 90 dage er gået", () => {
  const promptedAt = new Date(NOW - NPS_THROTTLE_MS).toISOString(); // præcis 90 dage siden
  assert.equal(
    shouldPromptNps({ completedRaceDays: 10, hasResponded: false, lastPromptedAt: promptedAt, now: NOW }),
    true,
  );
});

// --- hasEnoughRaceDays --------------------------------------------------------

test("hasEnoughRaceDays: tærsklen er inklusiv", () => {
  assert.equal(hasEnoughRaceDays(NPS_MIN_RACE_DAYS - 1), false);
  assert.equal(hasEnoughRaceDays(NPS_MIN_RACE_DAYS), true);
  assert.equal(hasEnoughRaceDays(NPS_MIN_RACE_DAYS + 1), true);
});

test("hasEnoughRaceDays: null/NaN/ikke-tal → false", () => {
  assert.equal(hasEnoughRaceDays(null), false);
  assert.equal(hasEnoughRaceDays(undefined), false);
  assert.equal(hasEnoughRaceDays(NaN), false);
  assert.equal(hasEnoughRaceDays("abc"), false);
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

// --- #4997: instrumentering + monteringssteder --------------------------------
// Kilde-assertions (samme mønster som actionTelemetry.test.js): de tre fund fra
// #4997 må ikke kunne falde stille ud igen ved en senere refaktorering.

const logEventSource = fs.readFileSync(new URL("./logEvent.js", import.meta.url), "utf8");

test("nps_submitted + nps_dismissed er registreret i KNOWN_EVENTS (Detector E's canary-liste)", () => {
  const match = logEventSource.match(/KNOWN_EVENTS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "KNOWN_EVENTS-arrayet blev ikke fundet i logEvent.js");
  assert.match(match[1], /"nps_submitted"/);
  assert.match(match[1], /"nps_dismissed"/);
});

const dashboardSource = fs.readFileSync(new URL("../pages/DashboardPage.jsx", import.meta.url), "utf8");

test("Dashboard monterer NPS-prompten (rod-årsagen bag 40 af 262, #4997)", () => {
  assert.match(dashboardSource, /import NpsPrompt from "\.\.\/components\/NpsPrompt"/);
  assert.match(dashboardSource, /<NpsPrompt/);
});

const hookSource = fs.readFileSync(new URL("../hooks/useNpsPrompt.js", import.meta.url), "utf8");

test("hook'en gør IKKE længere visning betinget af analytics-consent (#4997)", () => {
  // Selve svaret er spillerens frivillige input, ikke tracking; kun player_events
  // er consent-gated (logEvent.js gater sig selv).
  assert.doesNotMatch(hookSource, /hasConsent\(\s*"analytics"\s*\)/);
});
