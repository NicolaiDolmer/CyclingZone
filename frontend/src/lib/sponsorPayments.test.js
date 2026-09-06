import test from "node:test";
import assert from "node:assert/strict";

import { buildSponsorPayments, projectRemainingStages } from "./sponsorPayments.js";
import { projectOffer } from "./sponsorOfferProjection.js";

// #4265 — Sponsors-sidens Payments-fane + Overview-tal. Fixturen spejler
// mockuppens tal (docs/design/mockups-sponsors-2026-09-06/sponsors-page-tabs.html)
// så en drift i grupperingen bliver synlig mod den godkendte flade.
const CONTRACT = {
  sponsor_name: "Corvus Aviation",
  variant: "results",
  guaranteed_base: 214200,
  per_race_day_rate: 345,
  length_seasons: 2,
  start_season: 2,
  expires_after_season: 3,
  signed_division: 3,
  results_bonus_paid: 22491,
  bonus_clauses: [
    { type: "stage_win", amount: 12495 },
    { type: "podium", amount: 4998 },
    { type: "results_cap", amount: 189210 },
  ],
};

const TX = [
  { id: "t1", type: "sponsor", amount: 214200, createdAt: "2026-08-28T00:00:00Z" },
  { id: "t2", type: "division_adjustment", amount: 30000, createdAt: "2026-08-28T00:01:00Z" },
  { id: "t3", type: "sponsor_race_day", amount: 6210, raceId: "r1", raceName: "Giro della Penisola", createdAt: "2026-08-30T00:00:00Z" },
  { id: "t4", type: "sponsor_race_day", amount: 2070, raceId: "r2", raceName: "Vuelta a los Pirineos", createdAt: "2026-08-31T00:00:00Z" },
  {
    id: "t5",
    type: "sponsor_result_bonus",
    amount: 12495,
    raceId: "r1",
    raceName: "Giro della Penisola",
    createdAt: "2026-08-30T01:00:00Z",
    metadata: { params: { wins: 1, podiums: 0 } },
  },
];

test("buildSponsorPayments — Guaranteed rummer BÅDE base og divisions-tillæg (#4376)", () => {
  const model = buildSponsorPayments({ contract: CONTRACT, seasonNumber: 3, transactions: TX, stagesTotal: 124 });

  assert.equal(model.guaranteed.total, 244200);
  assert.deepEqual(
    model.guaranteed.rows.map((r) => r.kind),
    ["base", "divisionAdjustment"],
  );
  assert.equal(model.guaranteed.rows[1].amount, 30000);
});

test("buildSponsorPayments — etaper grupperes pr. løb med udledt etapetal, og totalen summer", () => {
  const model = buildSponsorPayments({ contract: CONTRACT, seasonNumber: 3, transactions: TX, stagesTotal: 124 });

  assert.equal(model.stages.total, 8280);
  assert.equal(model.stages.rows.length, 2);
  const byRace = Object.fromEntries(model.stages.rows.map((r) => [r.raceName, r.days]));
  assert.equal(byRace["Giro della Penisola"], 18);
  assert.equal(byRace["Vuelta a los Pirineos"], 6);
  assert.equal(model.stagesRidden, 24);
  assert.equal(model.total, 244200 + 8280 + 12495);
  assert.equal(model.earnedOnTop, 8280 + 12495);
});

test("buildSponsorPayments — bonusrækker og loft-forbrug kommer med", () => {
  const model = buildSponsorPayments({ contract: CONTRACT, seasonNumber: 3, transactions: TX, stagesTotal: 124 });

  assert.equal(model.bonuses.total, 12495);
  assert.equal(model.bonuses.rows.length, 1);
  assert.equal(model.bonuses.rows[0].kind, "stageWin");
  assert.deepEqual(model.cap, { used: 22491, limit: 189210 });
});

test("buildSponsorPayments — ukendt etapetal gætter aldrig (rate 0 → stagesRidden null)", () => {
  const model = buildSponsorPayments({
    contract: { ...CONTRACT, per_race_day_rate: 0 },
    transactions: TX,
    stagesTotal: null,
  });

  assert.equal(model.stagesRidden, null);
  assert.equal(model.stagesTotal, null);
  assert.equal(model.stages.rows.every((r) => r.days === null), true);
});

test("buildSponsorPayments — tom sæson er tom, ikke nul-rækker", () => {
  const model = buildSponsorPayments({ contract: null, transactions: [] });

  assert.equal(model.isEmpty, true);
  assert.equal(model.total, 0);
  assert.equal(model.cap, null);
});

test("projectRemainingStages — resterende etaper og deres værdi", () => {
  assert.deepEqual(projectRemainingStages({ stagesTotal: 124, stagesRidden: 33, rate: 345 }), {
    left: 91,
    worth: 31395,
  });
});

test("projectRemainingStages — mangler et tal, findes linjen ikke (P11)", () => {
  assert.equal(projectRemainingStages({ stagesTotal: null, stagesRidden: 33, rate: 345 }), null);
  assert.equal(projectRemainingStages({ stagesTotal: 124, stagesRidden: null, rate: 345 }), null);
  assert.equal(projectRemainingStages({ stagesTotal: 124, stagesRidden: 33, rate: 0 }), null);
});

test("projectOffer — frosne andele projicerer rate + 'hvis du starter hver etape'", () => {
  const offer = {
    variant: "results",
    guaranteedBase: 268800,
    guaranteedFraction: 0.55,
    raceDayShare: 0.11,
    perRaceDayRate: 1708,
    lengthSeasons: 2,
    clauses: [
      { type: "stage_win", amount: 15680 },
      { type: "results_cap", amount: 237440 },
    ],
  };
  const p = projectOffer(offer, 124);

  const target = Math.round(268800 / 0.55);
  const pool = Math.round(target * 0.11);
  assert.equal(p.raceDayPool, pool);
  assert.equal(p.rate, Math.round(pool / 124));
  assert.equal(p.certain, 268800 + pool);
  assert.equal(p.signing, 0);
  assert.equal(p.upside, 237440);
});

test("projectOffer — underskriftsbonus holdes UDE af det sikre beløb (#4416)", () => {
  const offer = {
    variant: "loyal",
    guaranteedBase: 349440,
    guaranteedFraction: 0.78,
    raceDayShare: 0.18,
    lengthSeasons: 3,
    clauses: [{ type: "signing", amount: 35840 }],
  };
  const p = projectOffer(offer, 124);

  assert.equal(p.signing, 35840);
  assert.equal(p.certain, 349440 + p.raceDayPool);
});

test("projectOffer — legacy-payload uden andele falder tilbage på den lagrede rate", () => {
  const p = projectOffer({ perRaceDayRate: 2400, clauses: [] }, 124);

  assert.equal(p.rate, 2400);
  assert.equal(p.raceDayPool, null);
  assert.equal(p.certain, null);
});

test("projectOffer — ukendt etapetal projicerer ikke", () => {
  const p = projectOffer({ guaranteedBase: 100, guaranteedFraction: 0.5, raceDayShare: 0.5, perRaceDayRate: 7 }, null);

  assert.equal(p.certain, null);
  assert.equal(p.rate, 7);
});
