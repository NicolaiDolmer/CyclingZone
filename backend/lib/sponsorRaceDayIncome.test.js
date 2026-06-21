import test from "node:test";
import assert from "node:assert/strict";
import { computeRaceDayCredits } from "./sponsorRaceDayIncome.js";

test("kreditér per_race_day_rate × stages for hvert deltagende hold", () => {
  const credits = computeRaceDayCredits({
    race: { id: "r1", stages: 3 },
    participatingTeamIds: ["t1", "t2"],
    contractsByTeam: { t1: { per_race_day_rate: 2000 }, t2: { per_race_day_rate: 0 } },
  });
  assert.deepEqual(credits, [
    { teamId: "t1", amount: 6000, idempotencyKey: "sponsor_race_day:r1:t1" },
  ]);
});

test("endagsløb (stages udefineret) tæller som 1 dag", () => {
  const credits = computeRaceDayCredits({
    race: { id: "r2" },
    participatingTeamIds: ["t1"],
    contractsByTeam: { t1: { per_race_day_rate: 1500 } },
  });
  assert.equal(credits[0].amount, 1500);
});
