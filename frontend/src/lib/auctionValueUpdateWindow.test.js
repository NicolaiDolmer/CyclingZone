import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSundayValueUpdateUTC, auctionSettlesAfterValueUpdate } from "./auctionValueUpdateWindow.js";

// Alle tidspunkter er i CEST-perioden (maj-sep, Copenhagen = UTC+2).

test("nextSundayValueUpdateUTC: en tirsdag → kommende søndag 22:00 CEST (20:00 UTC)", () => {
  // 2026-05-05 er en tirsdag.
  const now = new Date("2026-05-05T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  // 2026-05-10 er søndagen samme uge.
  assert.equal(result.toISOString(), "2026-05-10T20:00:00.000Z");
});

test("nextSundayValueUpdateUTC: søndag FØR kl. 22 dansk tid → samme dags refresh", () => {
  // 2026-05-10 (søndag) kl. 12:00 UTC = 14:00 CEST.
  const now = new Date("2026-05-10T12:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-10T20:00:00.000Z");
});

test("nextSundayValueUpdateUTC: søndag EFTER kl. 22 dansk tid → næste uges søndag", () => {
  // 2026-05-10 (søndag) kl. 21:00 UTC = 23:00 CEST — allerede forbi refreshen.
  const now = new Date("2026-05-10T21:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-17T20:00:00.000Z");
});

test("nextSundayValueUpdateUTC: præcis på grænsen (søndag 22:00:00 CEST) → tæller som allerede passeret", () => {
  const now = new Date("2026-05-10T20:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-17T20:00:00.000Z");
});

test("nextSundayValueUpdateUTC: en lørdag → i morgen søndag 22:00 CEST", () => {
  // 2026-05-09 er en lørdag.
  const now = new Date("2026-05-09T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-10T20:00:00.000Z");
});

test("nextSundayValueUpdateUTC: virker hen over CET/CEST-skiftet (vinter, UTC+1)", () => {
  // 2026-01-06 er en tirsdag, midt i CET-perioden.
  const now = new Date("2026-01-06T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  // 2026-01-11 er søndagen samme uge, 22:00 CET = 21:00 UTC.
  assert.equal(result.toISOString(), "2026-01-11T21:00:00.000Z");
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

test("auctionSettlesAfterValueUpdate: grænsen er inklusiv — slut PRÆCIS på refresh-tidspunktet tæller som 'efter'", () => {
  const now = new Date("2026-05-05T10:00:00.000Z");
  const end = new Date("2026-05-10T20:00:00.000Z"); // præcis søndag 22:00 CEST
  assert.equal(auctionSettlesAfterValueUpdate(end, now), true);
});

test("auctionSettlesAfterValueUpdate: manglende/ugyldig end → false (fail-open, ingen falsk varsel)", () => {
  assert.equal(auctionSettlesAfterValueUpdate(null), false);
  assert.equal(auctionSettlesAfterValueUpdate("ikke en dato"), false);
});
