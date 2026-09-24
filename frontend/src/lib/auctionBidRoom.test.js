import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBidRoom, SENIOR_CAP } from "./auctionBidRoom.js";
import { SQUAD_CAPS } from "./squadCaps.ts";

// Sæson-referenceår + fødselsdatoer der giver en entydig ungdomstrup.
const SEASON_YEAR = 2027;
const U23_BIRTHDATE = "2006-05-01"; // sæsonalder 21 -> u23
const JUNIOR_BIRTHDATE = "2010-05-01"; // sæsonalder 17 -> junior

const youth = (extra) => computeBidRoom({ isYouth: true, seasonYear: SEASON_YEAR, ...extra });

test("senior-auktion: blokeret når senior fuld", () => {
  const r = computeBidRoom({ isYouth: false, seniorCount: SENIOR_CAP, academySquadCounts: { u23: 0, junior: 0 } });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "senior_full");
});

test("senior-auktion: tilladt når senior har plads, uanset akademiet", () => {
  const r = computeBidRoom({ isYouth: false, seniorCount: 20, academySquadCounts: { u23: SQUAD_CAPS.u23, junior: SQUAD_CAPS.junior } });
  assert.equal(r.blocked, false);
});

test("#5568: 8 U23-ryttere er IKKE fuldt (det gamle flade loft) — buddet går igennem til U23", () => {
  const r = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 8, junior: 0 }, birthdate: U23_BIRTHDATE });
  assert.equal(r.blocked, false);
  assert.equal(r.destination, "academy");
  assert.equal(r.academySquad, "u23");
  assert.equal(r.academyMax, 12);
});

test("#5568: 12 U23-ryttere + fuld senior -> blokeret, begrundet med U23-loftet", () => {
  const r = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 12, junior: 0 }, birthdate: U23_BIRTHDATE });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "both_full");
  assert.equal(r.academySquad, "u23");
  assert.equal(r.academyMax, 12);
});

test("#5568: junior-loftet er 10 — 9 er plads, 10 er fuldt", () => {
  const nine = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 0, junior: 9 }, birthdate: JUNIOR_BIRTHDATE });
  assert.equal(nine.blocked, false);
  assert.equal(nine.academySquad, "junior");
  const ten = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 0, junior: 10 }, birthdate: JUNIOR_BIRTHDATE });
  assert.equal(ten.blocked, true);
  assert.equal(ten.academyMax, 10);
});

test("#5568: kun MÅL-truppen tæller — fuld junior spærrer ikke en U23-rytter", () => {
  const r = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 3, junior: 10 }, birthdate: U23_BIRTHDATE });
  assert.equal(r.blocked, false);
  assert.equal(r.destination, "academy");
});

test("youth: senior plads -> tilladt, destination senior (senior-først)", () => {
  const r = youth({ seniorCount: 20, academySquadCounts: { u23: 12, junior: 10 }, birthdate: U23_BIRTHDATE });
  assert.equal(r.blocked, false);
  assert.equal(r.destination, "senior");
});

test("null counts / ukendt sæson behandles som ikke-fuld -> ikke blokeret", () => {
  assert.equal(computeBidRoom({ isYouth: true, seniorCount: null, academySquadCounts: null }).blocked, false);
  assert.equal(computeBidRoom({ isYouth: false, seniorCount: null, academySquadCounts: null }).blocked, false);
  // Sæsonen er ikke hentet endnu: vi kender ikke truppen og spærrer derfor ikke.
  const noSeason = computeBidRoom({ isYouth: true, seniorCount: SENIOR_CAP, academySquadCounts: { u23: 12, junior: 10 }, birthdate: U23_BIRTHDATE });
  assert.equal(noSeason.blocked, false);
  assert.equal(noSeason.academySquad, null);
});
