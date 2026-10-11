import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSundayValueUpdateUTC, auctionSettlesAfterValueUpdate } from "./auctionValueUpdateWindow.js";

// Alle tidspunkter er i CEST-perioden (maj-sep, Copenhagen = UTC+2), undtagen
// vintertesten. Vinduet er søndag kl. 14 dansk tid (#5842, ejer 28/9: kl. 14-20,
// 14 er pladsholderen) = 12:00 UTC i CEST og 13:00 UTC i CET.

test("nextSundayValueUpdateUTC: en tirsdag → kommende søndag 14:00 CEST (12:00 UTC)", () => {
  // 2026-05-05 er en tirsdag.
  const now = new Date("2026-05-05T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  // 2026-05-10 er søndagen samme uge.
  assert.equal(result.toISOString(), "2026-05-10T12:00:00.000Z");
});

test("nextSundayValueUpdateUTC: søndag morgen (FØR kl. 14) → samme dags refresh", () => {
  // 2026-05-10 (søndag) kl. 04:45 UTC = 06:45 CEST, det gamle morgentidspunkt.
  const now = new Date("2026-05-10T04:45:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-10T12:00:00.000Z");
});

test("nextSundayValueUpdateUTC: søndag EFTER kl. 14 dansk tid → næste uges søndag", () => {
  // 2026-05-10 (søndag) kl. 15:00 UTC = 17:00 CEST, allerede forbi refreshen.
  const now = new Date("2026-05-10T15:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-17T12:00:00.000Z");
});

test("nextSundayValueUpdateUTC: præcis på grænsen (søndag 14:00:00 CEST) → tæller som allerede passeret", () => {
  const now = new Date("2026-05-10T12:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-17T12:00:00.000Z");
});

test("nextSundayValueUpdateUTC: en lørdag → i morgen søndag 14:00 CEST", () => {
  // 2026-05-09 er en lørdag.
  const now = new Date("2026-05-09T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-05-10T12:00:00.000Z");
});

test("nextSundayValueUpdateUTC: virker hen over CET/CEST-skiftet (vinter, UTC+1)", () => {
  // 2026-01-06 er en tirsdag, midt i CET-perioden.
  const now = new Date("2026-01-06T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  // 2026-01-11 er søndagen samme uge, 14:00 CET = 13:00 UTC.
  assert.equal(result.toISOString(), "2026-01-11T13:00:00.000Z");
});

test("nextSundayValueUpdateUTC: skiftedagen 25/10 (sommertiden slutter om natten) → 14:00 CET", () => {
  // 2026-10-24 er en lørdag i CEST; søndagen efter er i CET.
  const now = new Date("2026-10-24T10:00:00.000Z");
  const result = nextSundayValueUpdateUTC(now);
  assert.equal(result.toISOString(), "2026-10-25T13:00:00.000Z");
});

test("auctionSettlesAfterValueUpdate: auktion slutter FØR næste søndags refresh → false", () => {
  const now = new Date("2026-05-05T10:00:00.000Z"); // tirsdag
  const end = new Date("2026-05-07T10:00:00.000Z"); // torsdag samme uge
  assert.equal(auctionSettlesAfterValueUpdate(end, now), false);
});

test("auctionSettlesAfterValueUpdate: auktion der lukker søndag FORMIDDAG → false (før kl. 14)", () => {
  const now = new Date("2026-05-08T10:00:00.000Z"); // fredag
  const end = new Date("2026-05-10T08:00:00.000Z"); // søndag kl. 10 CEST
  assert.equal(auctionSettlesAfterValueUpdate(end, now), false);
});

test("auctionSettlesAfterValueUpdate: auktion der lukker søndag AFTEN → true", () => {
  const now = new Date("2026-05-08T10:00:00.000Z"); // fredag
  const end = new Date("2026-05-10T18:00:00.000Z"); // søndag kl. 20 CEST
  assert.equal(auctionSettlesAfterValueUpdate(end, now), true);
});

test("auctionSettlesAfterValueUpdate: auktion slutter EFTER næste søndags refresh → true", () => {
  const now = new Date("2026-05-05T10:00:00.000Z"); // tirsdag
  const end = new Date("2026-05-11T08:00:00.000Z"); // mandag ugen efter
  assert.equal(auctionSettlesAfterValueUpdate(end, now), true);
});

test("auctionSettlesAfterValueUpdate: grænsen er inklusiv — slut PRÆCIS på refresh-tidspunktet tæller som 'efter'", () => {
  const now = new Date("2026-05-05T10:00:00.000Z");
  const end = new Date("2026-05-10T12:00:00.000Z"); // præcis søndag 14:00 CEST
  assert.equal(auctionSettlesAfterValueUpdate(end, now), true);
});

test("auctionSettlesAfterValueUpdate: manglende/ugyldig end → false (fail-open, ingen falsk varsel)", () => {
  assert.equal(auctionSettlesAfterValueUpdate(null), false);
  assert.equal(auctionSettlesAfterValueUpdate("ikke en dato"), false);
});
