import test from "node:test";
import assert from "node:assert/strict";

import {
  TIMING_HOLE_WINDOW_START,
  TIMING_HOLE_WINDOW_END,
  isInTimingHoleWindow,
  detectTimingHoleContracts,
  correctedSafeGuaranteedBase,
  buildTimingHoleCorrections,
  buildDivisionAdjustments,
  findNegativeBalanceRisk,
} from "./repair-4376-sponsor-division-correction.js";
import { generateOffers } from "../lib/sponsorOffers.js";
import { renownTarget } from "../lib/renownEngine.js";

// ─── isInTimingHoleWindow ───────────────────────────────────────────────────

test("isInTimingHoleWindow: inden for batch-vinduet (inklusive grænser)", () => {
  assert.equal(isInTimingHoleWindow(TIMING_HOLE_WINDOW_START), true);
  assert.equal(isInTimingHoleWindow(TIMING_HOLE_WINDOW_END), true);
  assert.equal(isInTimingHoleWindow("2026-08-23T18:22:19Z"), true);
});

test("isInTimingHoleWindow: uden for vinduet eller ugyldig dato", () => {
  assert.equal(isInTimingHoleWindow("2026-08-23T18:21:47Z"), false); // 1s FØR
  assert.equal(isInTimingHoleWindow("2026-08-23T18:23:02Z"), false); // 1s EFTER
  assert.equal(isInTimingHoleWindow("2026-07-27T17:39:39Z"), false); // manuelt valgt aftale, ugerne før
  assert.equal(isInTimingHoleWindow("not-a-date"), false);
  assert.equal(isInTimingHoleWindow(null), false);
});

// ─── detectTimingHoleContracts ──────────────────────────────────────────────

function makeContract(overrides = {}) {
  return {
    id: "c1", team_id: "t1", status: "active", variant: "safe", length_seasons: 1,
    guaranteed_base: 772800, signed_division: 1, created_at: "2026-08-23T18:22:19Z",
    ...overrides,
  };
}

test("detectTimingHoleContracts: rammer et auto-'safe'-hold oprettet i batch-vinduet der ER oprykket (Bad At Names-mønstret: D2→D1)", () => {
  const contracts = [makeContract()];
  const teamById = new Map([["t1", { id: "t1", name: "Bad At Names", division: 1 }]]);
  const oldDivisionByTeamId = new Map([["t1", 2]]); // S2: D2, nu D1 → oprykket
  const hits = detectTimingHoleContracts({ contracts, teamById, oldDivisionByTeamId });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].oldDivision, 2);
});

test("detectTimingHoleContracts: IKKE ramt hvis kontrakten ligger UDEN for batch-vinduet (manuelt valgt aftale)", () => {
  const contracts = [makeContract({ created_at: "2026-07-27T17:39:39Z" })];
  const teamById = new Map([["t1", { id: "t1", name: "Vallados del Sur", division: 1 }]]);
  const oldDivisionByTeamId = new Map([["t1", 2]]);
  const hits = detectTimingHoleContracts({ contracts, teamById, oldDivisionByTeamId });
  assert.equal(hits.length, 0);
});

test("detectTimingHoleContracts: IKKE ramt hvis holdet IKKE er oprykket (samme eller lavere division)", () => {
  const contracts = [makeContract()];
  const teamById = new Map([["t1", { id: "t1", name: "Team", division: 2 }]]);
  const oldDivisionByTeamId = new Map([["t1", 2]]); // uændret division
  const hits = detectTimingHoleContracts({ contracts, teamById, oldDivisionByTeamId });
  assert.equal(hits.length, 0);
});

test("detectTimingHoleContracts: IKKE ramt for andre varianter end 1-sæsons 'safe' (manuelt valg, ikke #2914-default)", () => {
  const contracts = [makeContract({ variant: "loyal", length_seasons: 3 })];
  const teamById = new Map([["t1", { id: "t1", name: "Team", division: 1 }]]);
  const oldDivisionByTeamId = new Map([["t1", 2]]);
  const hits = detectTimingHoleContracts({ contracts, teamById, oldDivisionByTeamId });
  assert.equal(hits.length, 0);
});

test("detectTimingHoleContracts: IKKE ramt hvis holdet mangler en S2-standing (nyoprettet hold, intet at rekonstruere)", () => {
  const contracts = [makeContract()];
  const teamById = new Map([["t1", { id: "t1", name: "Team", division: 1 }]]);
  const oldDivisionByTeamId = new Map(); // ingen standing
  const hits = detectTimingHoleContracts({ contracts, teamById, oldDivisionByTeamId });
  assert.equal(hits.length, 0);
});

test("detectTimingHoleContracts: IKKE ramt for en udløbet/erstattet kontrakt", () => {
  const contracts = [makeContract({ status: "expired" })];
  const teamById = new Map([["t1", { id: "t1", name: "Team", division: 1 }]]);
  const oldDivisionByTeamId = new Map([["t1", 2]]);
  const hits = detectTimingHoleContracts({ contracts, teamById, oldDivisionByTeamId });
  assert.equal(hits.length, 0);
});

// ─── correctedSafeGuaranteedBase ────────────────────────────────────────────

test("correctedSafeGuaranteedBase: D2→D1 rank-1-hold (Bad At Names-mønstret) giver 515.200, IKKE 772.800", () => {
  // Rank 1 i D2 sidste sæson → renownMultiplier ceiling (1,40, jf. #8.7-mønstret).
  const lastSeasonStanding = { team_id: "t1", division: 2, rank_in_division: 1, total_points: 900 };
  const divisionStandings = [
    lastSeasonStanding,
    { team_id: "t2", division: 2, rank_in_division: 2, total_points: 200 },
  ];
  const base = correctedSafeGuaranteedBase({ oldDivision: 2, lastSeasonStanding, divisionStandings, seasonNumber: 3 });
  assert.equal(base, 515200); // 400.000 × 1,40 × 0,92 — jf. auto-sponsor-aftaler-audit
  assert.notEqual(base, 772800); // det forkerte, timing-hul-ramte D1-beløb
});

test("correctedSafeGuaranteedBase: D3→D2 rank-1-hold giver 437.920 (docs/audits/sponsor-timing-hul-alle-divisioner-2026-09-04.md)", () => {
  const lastSeasonStanding = { team_id: "t1", division: 3, rank_in_division: 1, total_points: 900 };
  const divisionStandings = [lastSeasonStanding];
  const base = correctedSafeGuaranteedBase({ oldDivision: 3, lastSeasonStanding, divisionStandings, seasonNumber: 3 });
  assert.equal(base, 437920);
});

test("correctedSafeGuaranteedBase: D4→D3 rank-1-hold giver 405.720 (docs/audits/sponsor-timing-hul-alle-divisioner-2026-09-04.md)", () => {
  const lastSeasonStanding = { team_id: "t1", division: 4, rank_in_division: 1, total_points: 900 };
  const divisionStandings = [lastSeasonStanding];
  const base = correctedSafeGuaranteedBase({ oldDivision: 4, lastSeasonStanding, divisionStandings, seasonNumber: 3 });
  assert.equal(base, 405720);
});

test("correctedSafeGuaranteedBase: matcher PRÆCIS renownTarget/generateOffers-kæden (ingen hardkodet 1,40)", () => {
  const lastSeasonStanding = { team_id: "t1", division: 2, rank_in_division: 3, total_points: 400 };
  const divisionStandings = [
    lastSeasonStanding,
    { team_id: "t2", division: 2, rank_in_division: 1, total_points: 900 },
    { team_id: "t3", division: 2, rank_in_division: 2, total_points: 700 },
  ];
  const expectedTarget = renownTarget({ division: 2, lastSeasonStanding, divisionStandings });
  const expectedSafe = generateOffers({ teamId: "x", seasonNumber: 3, renownTargetValue: expectedTarget }).find((o) => o.variant === "safe");
  const base = correctedSafeGuaranteedBase({ oldDivision: 2, lastSeasonStanding, divisionStandings, seasonNumber: 3 });
  assert.equal(base, expectedSafe.guaranteedBase);
});

// ─── buildTimingHoleCorrections ─────────────────────────────────────────────

test("buildTimingHoleCorrections: needsUpdate=true når den lagrede base afviger fra den korrigerede", () => {
  const hits = [{
    contract: makeContract({ guaranteed_base: 772800, signed_division: 1 }),
    team: { id: "t1", name: "Bad At Names", division: 1 },
    oldDivision: 2,
  }];
  const standingByTeamId = new Map([["t1", { team_id: "t1", division: 2, rank_in_division: 1, total_points: 900 }]]);
  const allStandings = [...standingByTeamId.values()];
  const out = buildTimingHoleCorrections(hits, standingByTeamId, allStandings, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].needsUpdate, true);
  assert.equal(out[0].guaranteed_base_after, 515200);
  assert.equal(out[0].signed_division_after, 2);
  assert.equal(out[0].signed_division_before, 1);
});

test("buildTimingHoleCorrections: needsUpdate=false hvis kontrakten allerede er rettet (idempotens ved gentagen kørsel)", () => {
  const hits = [{
    contract: makeContract({ guaranteed_base: 515200, signed_division: 2 }), // allerede korrekt
    team: { id: "t1", name: "Bad At Names", division: 1 },
    oldDivision: 2,
  }];
  const standingByTeamId = new Map([["t1", { team_id: "t1", division: 2, rank_in_division: 1, total_points: 900 }]]);
  const allStandings = [...standingByTeamId.values()];
  const out = buildTimingHoleCorrections(hits, standingByTeamId, allStandings, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].needsUpdate, false);
});

// ─── buildDivisionAdjustments ───────────────────────────────────────────────

test("buildDivisionAdjustments: bruger den EFFEKTIVE signed_division (korrigeret), ikke den lagrede, for et timing-hul-hold", () => {
  const contractByTeamId = new Map([["t1", makeContract({ guaranteed_base: 772800, signed_division: 1 })]]);
  const teamById = new Map([["t1", { id: "t1", name: "Bad At Names", division: 1 }]]);
  // Effektiv (korrigeret) signed_division = 2 (D2), IKKE 1 (den lagrede, forkerte).
  const effectiveSignedDivisionByTeamId = new Map([["t1", 2]]);
  const modifierByTeamId = new Map([["t1", 1.0]]);
  const out = buildDivisionAdjustments({ contractByTeamId, teamById, effectiveSignedDivisionByTeamId, modifierByTeamId, seasonNumber: 3 });
  assert.equal(out.length, 1);
  assert.equal(out[0].signed_division, 2);
  // D1 m. D2-aftale (ét trin op): gulv 0, 50% af hele forskellen (600.000-400.000).
  assert.equal(out[0].correction_cz, Math.round(0.5 * (600000 - 400000)));
  assert.ok(out[0].correction_cz > 0);
});

test("buildDivisionAdjustments: intet tillæg (springes over) når signed_division === current division", () => {
  const contractByTeamId = new Map([["t1", makeContract({ signed_division: 2 })]]);
  const teamById = new Map([["t1", { id: "t1", name: "Team", division: 2 }]]);
  const effectiveSignedDivisionByTeamId = new Map([["t1", 2]]);
  const modifierByTeamId = new Map([["t1", 1.0]]);
  const out = buildDivisionAdjustments({ contractByTeamId, teamById, effectiveSignedDivisionByTeamId, modifierByTeamId, seasonNumber: 3 });
  assert.equal(out.length, 0);
});

test("buildDivisionAdjustments: bestyrelsens modifier ganges på tillægget, samme som basen", () => {
  const contractByTeamId = new Map([["t1", makeContract({ signed_division: 3 })]]);
  const teamById = new Map([["t1", { id: "t1", name: "Team", division: 2 }]]);
  const effectiveSignedDivisionByTeamId = new Map([["t1", 3]]);
  const modifierByTeamId = new Map([["t1", 1.2]]);
  const out = buildDivisionAdjustments({ contractByTeamId, teamById, effectiveSignedDivisionByTeamId, modifierByTeamId, seasonNumber: 3 });
  assert.equal(out.length, 1);
  const raw = 0.5 * (400000 - 340000); // D2 m. D3-aftale
  assert.equal(out[0].correction_cz, Math.round(raw * 1.2));
});

// ─── findNegativeBalanceRisk ────────────────────────────────────────────────

test("findNegativeBalanceRisk: tom i sæson 3 — kun opadgående tillæg er mulige (DOWNWARD_ADJUSTMENT_ENABLED=false)", () => {
  const divisionAdjustments = [{ team_id: "t1", correction_cz: 100000 }];
  const teamById = new Map([["t1", { id: "t1", balance: 0 }]]);
  const risks = findNegativeBalanceRisk(divisionAdjustments, teamById);
  assert.equal(risks.length, 0);
});

test("findNegativeBalanceRisk: flager et hold hvis et (hypotetisk, fremtidig-sæson) negativt tillæg ville sende det under 0", () => {
  const divisionAdjustments = [{ team_id: "t1", correction_cz: -50000 }];
  const teamById = new Map([["t1", { id: "t1", balance: 10000 }]]);
  const risks = findNegativeBalanceRisk(divisionAdjustments, teamById);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].projectedBalance, -40000);
});
