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
  assert.equal(r.academyMax, SQUAD_CAPS.u23);
});

test("full age-eligible squad and full senior squad block the bid", () => {
  const r = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: SQUAD_CAPS.u23, junior: 0 }, birthdate: U23_BIRTHDATE });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "both_full");
  assert.equal(r.academySquad, "u23");
  assert.equal(r.academyMax, SQUAD_CAPS.u23);
});

test("junior squad allows its last place and stops at the limit", () => {
  const below = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 0, junior: SQUAD_CAPS.junior - 1 }, birthdate: JUNIOR_BIRTHDATE });
  assert.equal(below.blocked, false);
  assert.equal(below.academySquad, "junior");
  const full = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 0, junior: SQUAD_CAPS.junior }, birthdate: JUNIOR_BIRTHDATE });
  assert.equal(full.blocked, true);
  assert.equal(full.academyMax, SQUAD_CAPS.junior);
});

test("#5568: kun MÅL-truppen tæller — fuld junior spærrer ikke en U23-rytter", () => {
  const r = youth({ seniorCount: SENIOR_CAP, academySquadCounts: { u23: 3, junior: SQUAD_CAPS.junior }, birthdate: U23_BIRTHDATE });
  assert.equal(r.blocked, false);
  assert.equal(r.destination, "academy");
});

test("youth: senior plads -> tilladt, destination senior (senior-først)", () => {
  const r = youth({ seniorCount: 20, academySquadCounts: { u23: SQUAD_CAPS.u23, junior: SQUAD_CAPS.junior }, birthdate: U23_BIRTHDATE });
  assert.equal(r.blocked, false);
  assert.equal(r.destination, "senior");
});

test("null counts / ukendt sæson behandles som ikke-fuld -> ikke blokeret", () => {
  assert.equal(computeBidRoom({ isYouth: true, seniorCount: null, academySquadCounts: null }).blocked, false);
  assert.equal(computeBidRoom({ isYouth: false, seniorCount: null, academySquadCounts: null }).blocked, false);
  // Sæsonen er ikke hentet endnu: vi kender ikke truppen og spærrer derfor ikke.
  const noSeason = computeBidRoom({ isYouth: true, seniorCount: SENIOR_CAP, academySquadCounts: { u23: SQUAD_CAPS.u23, junior: SQUAD_CAPS.junior }, birthdate: U23_BIRTHDATE });
  assert.equal(noSeason.blocked, false);
  assert.equal(noSeason.academySquad, null);
});
