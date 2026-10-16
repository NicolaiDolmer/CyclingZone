// #6710: dry-run'ens rene simulering (planPromotionPending) + holdaliaser.
import test from "node:test";
import assert from "node:assert/strict";

import { planPromotionPending, teamAlias } from "./dryrun-6710-promotion-pending.js";

// Saeson 5 = referenceaar 2030 (riderSeasonAge.js, S3 = 2028).
const born = (ageInS5) => `${2030 - ageInS5}-06-15`;
const junior = (id, team, age = 19) => ({ id, team_id: team, birthdate: born(age), squad: "junior", is_academy: true });
const u23 = (id, team, age = 21) => ({ id, team_id: team, birthdate: born(age), squad: "u23", is_academy: true });

const twelveU23 = (team) => Array.from({ length: 12 }, (_, i) => u23(`${team}-u${String(i).padStart(2, "0")}`, team));

test("#6710 dry-run: fuld U23-trup → juniorerne afventer i stedet for at blive solgt", () => {
  const riders = [...twelveU23("A"), junior("A-j1", "A"), junior("A-j2", "A"), junior("A-j3", "A", 17)];
  const teams = new Map([["A", { seniorFuture: 20, seniorCap: 30, balance: 1000 }]]);
  const { totals, perTeam } = planPromotionPending({ riders, teams, seasonNumber: 5 });
  assert.deepEqual(totals["junior->u23"], { promote: 0, sell: 0, pending: 2 });
  assert.equal(perTeam[0].juniorPending, 2);
});

test("#6710 dry-run: en u23 -> senior-oprykning frigiver plads til en senere junior (id-orden)", () => {
  // Aa-u23 (23 aar) sorterer FOER Ab-junior; han rykker op i en ikke-fuld seniortrup
  // og efterlader en U23-plads som junioren tager.
  const riders = [
    ...twelveU23("B").slice(0, 11),
    u23("B-a-old", "B", 23),
    junior("B-b-junior", "B"),
  ];
  const teams = new Map([["B", { seniorFuture: 25, seniorCap: 30, balance: 1000 }]]);
  const { totals } = planPromotionPending({ riders, teams, seasonNumber: 5 });
  assert.deepEqual(totals["u23->senior"], { promote: 1, sell: 0, pending: 0 });
  assert.deepEqual(totals["junior->u23"], { promote: 1, sell: 0, pending: 0 });
});

test("#6710 dry-run: fuld seniortrup → U23-rytteren afventer; plads + negativ saldo saelges som i dag", () => {
  const riders = [u23("C-old", "C", 23), junior("D-j", "D")];
  const teams = new Map([
    ["C", { seniorFuture: 30, seniorCap: 30, balance: 1000 }],
    ["D", { seniorFuture: 10, seniorCap: 30, balance: -5 }],
  ]);
  const { totals } = planPromotionPending({ riders, teams, seasonNumber: 5 });
  assert.deepEqual(totals["u23->senior"], { promote: 0, sell: 0, pending: 1 });
  assert.deepEqual(totals["junior->u23"], { promote: 0, sell: 1, pending: 0 });
});

test("#6710 dry-run: AI-hold (ikke i teams-kortet) taelles ikke", () => {
  const riders = [...twelveU23("AI"), junior("AI-j", "AI")];
  const { totals, perTeam } = planPromotionPending({ riders, teams: new Map(), seasonNumber: 5 });
  assert.equal(totals["junior->u23"].pending, 0);
  assert.equal(perTeam.length, 0);
});

test("#6710 teamAlias: Hold A..Z, AA", () => {
  assert.equal(teamAlias(0), "Hold A");
  assert.equal(teamAlias(25), "Hold Z");
  assert.equal(teamAlias(26), "Hold AA");
});
