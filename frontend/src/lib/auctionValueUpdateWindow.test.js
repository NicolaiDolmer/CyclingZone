import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSundayValueUpdateUTC, auctionSettlesAfterValueUpdate } from "./auctionValueUpdateWindow.js";

// Alle tidspunkter er i CEST-perioden (maj-sep, Copenhagen = UTC+2).
// Vinduet er søndag kl. 06 dansk tid (#4419, ejer-beslutning 30/8) = 04:00 UTC
// i CEST og 05:00 UTC i CET.

test("nextSundayValueUpdateUTC: en tirsdag → kommende søndag 06:00 CEST (04:00 UTC)", () => {
  // 2026-05-05 er en tirsdag.
  const now = new Date("2026-05-05T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  // 2026-05-10 er søndagen samme uge.
  assert.equal(result.toISOString(), "2026-05-10T04:00:00.000Z");
});

test("nextSundayValueUpdateUTC: søndag FØR kl. 06 dansk tid → samme dags refresh", () => {
  // 2026-05-10 (søndag) kl. 02:00 UTC = 04:00 CEST.
  const now = new Date("2026-05-10T02:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-10T04:00:00.000Z");
});

test("nextSundayValueUpdateUTC: søndag EFTER kl. 06 dansk tid → næste uges søndag", () => {
  // 2026-05-10 (søndag) kl. 12:00 UTC = 14:00 CEST — allerede forbi refreshen.
  // Præcis det hul #4419's review fandt: før rettelsen svarede denne dag stadig
  // "i aften kl. 22", og en auktion der lukkede søndag middag fik intet varsel.
  const now = new Date("2026-05-10T12:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-17T04:00:00.000Z");
});

test("nextSundayValueUpdateUTC: præcis på grænsen (søndag 06:00:00 CEST) → tæller som allerede passeret", () => {
  const now = new Date("2026-05-10T04:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-17T04:00:00.000Z");
});

test("nextSundayValueUpdateUTC: en lørdag → i morgen søndag 06:00 CEST", () => {
  // 2026-05-09 er en lørdag.
  const now = new Date("2026-05-09T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-10T04:00:00.000Z");
});

test("nextSundayValueUpdateUTC: virker hen over CET/CEST-skiftet (vinter, UTC+1)", () => {
  // 2026-01-06 er en tirsdag, midt i CET-perioden.
  const now = new Date("2026-01-06T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  // 2026-01-11 er søndagen samme uge, 06:00 CET = 05:00 UTC.
  assert.equal(result.toISOString(), "2026-01-11T05:00:00.000Z");
});

test("auctionSettlesAfterValueUpdate: auktion slutter FØR næste søndags refresh → false", () => {
  const now = new Date("2026-05-05T10:00:00.000Z"); // tirsdag
  const end = new Date("2026-05-07T10:00:00.000Z"); // torsdag samme uge
  assert.equal(auctionSettlesAfterValueUpdate(end, now), false);
});

test("auctionSettlesAfterValueUpdate: auktion slutter EFTER næste søndags refresh → true", () => {
  const now = new Date("2026-05-05T10:00:00.000Z"); // tirsdag
  const end = new Date("2026-05-11T08:00:00.000Z"); // mandag ugen efter
  assert.equal(auctionSettlesAfterValueUpdate(end, now), true);
});

test("auctionSettlesAfterValueUpdate: auktion der lukker søndag MIDT PÅ DAGEN varsles nu (#4419)", () => {
  // Regressionstest for review-fundet: med det gamle kl.-22-vindue gav denne
  // auktion false, selvom værdierne reelt var genberegnet kl. 06 samme morgen.
  const now = new Date("2026-05-08T10:00:00.000Z"); // fredag
  const end = new Date("2026-05-10T10:00:00.000Z"); // søndag kl. 12 CEST
  assert.equal(auctionSettlesAfterValueUpdate(end, now), true);
});

test("auctionSettlesAfterValueUpdate: grænsen er inklusiv — slut PRÆCIS på refresh-tidspunktet tæller som 'efter'", () => {
  const now = new Date("2026-05-05T10:00:00.000Z");
  const end = new Date("2026-05-10T04:00:00.000Z"); // præcis søndag 06:00 CEST
  assert.equal(auctionSettlesAfterValueUpdate(end, now), true);
});

test("auctionSettlesAfterValueUpdate: manglende/ugyldig end → false (fail-open, ingen falsk varsel)", () => {
  assert.equal(auctionSettlesAfterValueUpdate(null), false);
  assert.equal(auctionSettlesAfterValueUpdate("ikke en dato"), false);
});
