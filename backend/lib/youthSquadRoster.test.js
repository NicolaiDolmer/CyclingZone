// #5519 — U23 team- og Junior team-sidernes trup-afgoerelse.
//
// Den vigtige egenskab: siden viser samme trup som motoren tror paa. Derfor
// testes groupYouthSquads mod effectiveSquad's to faser:
//   • FOER backfill (#4619): alle staar squad='senior'; akademiryttere placeres
//     efter saesonalder, og en 23-aarig akademirytter er stadig U23.
//   • EFTER backfill: en eksplicit ungdomstrup paa raekken vinder altid.

import test from "node:test";
import assert from "node:assert/strict";

import { SQUAD_CAPS } from "./squads.js";
import { LAUNCH_REFERENCE_YEAR } from "./riderSeasonAge.js";
import {
  YOUTH_SQUAD_PAGE_KEYS,
  YOUTH_SQUAD_ROSTER_COLUMNS,
  groupYouthSquads,
  buildYouthSquadsPayload,
} from "./youthSquadRoster.js";

const SEASON = 3;
// Saesonens referenceaar — foedselsaaret regnes ud herfra, aldrig hardkodet,
// saa testen ikke raadner naar LAUNCH_REFERENCE_YEAR flytter sig.
const REF_YEAR = LAUNCH_REFERENCE_YEAR + (SEASON - 1);
const bornAged = (age) => `${REF_YEAR - age}-06-15`;

test("#5519: menu-raekkefoelgen er U23 team foer Junior team", () => {
  assert.deepEqual([...YOUTH_SQUAD_PAGE_KEYS], ["u23", "junior"]);
});

test("#5519: queryen projicerer de kolonner effectiveSquad kraever", () => {
  for (const col of ["id", "birthdate", "squad", "is_academy"]) {
    assert.ok(YOUTH_SQUAD_ROSTER_COLUMNS.includes(col), `mangler ${col}`);
  }
});

test("#5519 foer backfill: akademiryttere fordeles efter saesonalder", () => {
  const riders = [
    { id: "jun-16", birthdate: bornAged(16), squad: "senior", is_academy: true },
    { id: "jun-18", birthdate: bornAged(18), squad: "senior", is_academy: true },
    { id: "u23-19", birthdate: bornAged(19), squad: "senior", is_academy: true },
    { id: "u23-22", birthdate: bornAged(22), squad: "senior", is_academy: true },
    // Vokset ud af U23 men ikke gradueret endnu: staar stadig paa U23-siden.
    { id: "u23-23", birthdate: bornAged(23), squad: "senior", is_academy: true },
    { id: "senior-21", birthdate: bornAged(21), squad: "senior", is_academy: false },
  ];
  assert.deepEqual(groupYouthSquads(riders, SEASON), {
    u23: ["u23-19", "u23-22", "u23-23"],
    junior: ["jun-16", "jun-18"],
  });
});

test("#5519 efter backfill: eksplicit ungdomstrup vinder over alderen", () => {
  const riders = [
    // En 20-aarig flyttet ned i junior (eller en fejl) — raekken er sandheden.
    { id: "a", birthdate: bornAged(20), squad: "junior", is_academy: true },
    { id: "b", birthdate: bornAged(17), squad: "u23", is_academy: true },
    { id: "c", birthdate: bornAged(20), squad: "senior", is_academy: false },
  ];
  assert.deepEqual(groupYouthSquads(riders, SEASON), { u23: ["b"], junior: ["a"] });
});

test("#5519: en seniorrytter i U23-alder staar IKKE paa U23-siden", () => {
  const riders = [{ id: "s", birthdate: bornAged(20), squad: "senior", is_academy: false }];
  assert.deepEqual(groupYouthSquads(riders, SEASON), { u23: [], junior: [] });
});

test("#5519: ukendt alder paa en akademirytter gaettes aldrig ind i en trup", () => {
  const riders = [
    { id: "no-birth", birthdate: null, squad: "senior", is_academy: true },
    { birthdate: bornAged(17), squad: "junior", is_academy: true }, // uden id
  ];
  assert.deepEqual(groupYouthSquads(riders, SEASON), { u23: [], junior: [] });
  assert.deepEqual(groupYouthSquads(null, SEASON), { u23: [], junior: [] });
});

test("#5519 payload: loft = SQUAD_CAPS, id'er pr. trup, saesonnummer med", () => {
  const riders = [
    { id: "u", birthdate: bornAged(20), squad: "u23", is_academy: true },
    { id: "j", birthdate: bornAged(17), squad: "junior", is_academy: true },
  ];
  assert.deepEqual(buildYouthSquadsPayload(riders, SEASON), {
    seasonNumber: SEASON,
    squads: {
      u23: { cap: SQUAD_CAPS.u23, riderIds: ["u"] },
      junior: { cap: SQUAD_CAPS.junior, riderIds: ["j"] },
    },
  });
  assert.equal(buildYouthSquadsPayload([], undefined).seasonNumber, null);
});
