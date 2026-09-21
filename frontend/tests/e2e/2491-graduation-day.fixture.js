// #2491 — delt fixture for Graduation Day-siden.
//
// Den samme payload foeder BAADE CI-spec'en (2491-graduation-day.spec.js) og
// screenshot-scriptet (2491-graduation-day.shots.mjs), saa billedet ejeren
// godkender viser praecis den tilstand testen paastaar noget om.
//
// Formen er GET /api/academy/me's `graduations` (backend/routes/api.js) EFTER
// #2491: `from_squad`/`to_squad` fra academy_graduation-raekken (#4619),
// evne-raekken til rating-pladen, kontraktfelterne og maal-truppens taeller.
// Tallene er realistiske ungdoms-tal, ikke pynt: to ryttere i den ene overgang
// og én i den anden, og U23-truppen er FULD saa den blokerede "Move up" er med
// paa billedet.

import { TEST_TEAM } from "./fixtures.js";

const DEADLINE = new Date(Date.now() + 5 * 86_400_000).toISOString();

function abilities(over = {}) {
  return {
    climbing: 38, time_trial: 30, flat: 33, tempo: 36, sprint: 22, acceleration: 31,
    punch: 34, endurance: 37, recovery: 35, durability: 33, descending: 32,
    cobblestone: 24, positioning: 30, aggression: 29, tactics: 28,
    teamwork: 31, leadership: 26,
    ...over,
  };
}

// Overgang 1: junior -> U23. U23-truppen er fuld (12/12), saa "Move up" er
// blokeret paa begge og "Sell" er forvalgt (mockup 3g).
const JUNIOR_TO_U23 = [
  {
    riderId: "grad-j1",
    name: "Mikkel Toft",
    firstname: "Mikkel",
    lastname: "Toft",
    age: 19,
    deadline: DEADLINE,
    nationality_code: "dk",
    primary_type: "climber",
    secondary_type: "gc",
    salary: 9400,
    contract_length: 2,
    contract_end_season: 5,
    current_production_value: 41000,
    market_value: 96000,
    fromSquad: "junior",
    toSquad: "u23",
    targetSquadCount: 12,
    targetSquadMax: 12,
    rider_derived_abilities: abilities(),
  },
  {
    riderId: "grad-j2",
    name: "Nuno Fialho",
    firstname: "Nuno",
    lastname: "Fialho",
    age: 19,
    deadline: DEADLINE,
    nationality_code: "pt",
    primary_type: "sprinter",
    secondary_type: "puncheur",
    salary: 8200,
    contract_length: 1,
    contract_end_season: 4,
    current_production_value: 36000,
    market_value: 74000,
    fromSquad: "junior",
    toSquad: "u23",
    targetSquadCount: 12,
    targetSquadMax: 12,
    rider_derived_abilities: abilities({ sprint: 46, acceleration: 42, climbing: 21, endurance: 29 }),
  },
];

// Overgang 2: U23 -> senior. Seniortruppen har plads (18/30), saa "Move up" er
// valgt som default.
const U23_TO_SENIOR = [
  {
    riderId: "grad-u1",
    name: "Aksel Berg",
    firstname: "Aksel",
    lastname: "Berg",
    age: 23,
    deadline: DEADLINE,
    nationality_code: "no",
    primary_type: "tt",
    secondary_type: "rouleur",
    salary: 21500,
    contract_length: 2,
    contract_end_season: 6,
    current_production_value: 88000,
    market_value: 205000,
    fromSquad: "u23",
    toSquad: "senior",
    targetSquadCount: 18,
    targetSquadMax: 30,
    rider_derived_abilities: abilities({ time_trial: 52, tempo: 49, flat: 47, endurance: 44, climbing: 26 }),
  },
];

export const GRADUATES = [...JUNIOR_TO_U23, ...U23_TO_SENIOR];

// Scout-estimater for netop disse ryttere. Uden dem svarer fixtures.js's
// generiske mock ikke (den slaar op i RIDERS), og potentiale-baandet ville staa
// tomt paa billedet. `prog` er prognose-baandet, samme felt som prod sender.
export const GRADUATE_ESTIMATES = {
  "grad-j1": { lo: 4, hi: 5, level: 3, role: "climber", now: 33, prog: { lo: 44, hi: 52 }, ceil: { lo: 44, hi: 52 }, loft: 88, pastPeak: false },
  // Level 1 af 3: fog-gaten skal give den hedgede traener-saetning her.
  "grad-j2": { lo: 3, hi: 5, level: 1, role: "sprinter", now: 31, prog: { lo: 38, hi: 50 }, ceil: { lo: 38, hi: 50 }, loft: 84, pastPeak: false },
  "grad-u1": { lo: 4.5, hi: 5, level: 3, role: "tt", now: 45, prog: { lo: 46, hi: 50 }, ceil: { lo: 46, hi: 50 }, loft: 91, pastPeak: false },
};

export const ESTIMATES_PAYLOAD = {
  teamId: TEST_TEAM.id,
  maxLevel: 3,
  estimates: GRADUATE_ESTIMATES,
};
