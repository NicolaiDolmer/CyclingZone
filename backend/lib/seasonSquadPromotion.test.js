import test from "node:test";
import assert from "node:assert/strict";
import { planSeasonSquadPromotions } from "./seasonSquadPromotion.js";

test("cutover advances owned youth riders to the age-eligible squad", () => {
  const riders = [
    { id: "junior", team_id: "a", squad: "junior", birthdate: "2012-12-31" },
    { id: "u23", team_id: "a", squad: "u23", birthdate: "2008-12-31" },
    { id: "too-young", team_id: "a", squad: "junior", birthdate: "2013-01-01" },
    { id: "already-up", team_id: "a", squad: "u23", birthdate: "2012-01-01" },
    { id: "offered", team_id: null, squad: "junior", birthdate: "2012-01-01" },
    { id: "retired", team_id: "a", squad: "u23", birthdate: "2008-01-01", is_retired: true },
    { id: "unknown", team_id: "a", squad: "u23", birthdate: null },
  ];
  assert.deepEqual(planSeasonSquadPromotions(riders, 6), [
    { rider_id: "junior", team_id: "a", from_squad: "junior", to_squad: "u23" },
    { rider_id: "u23", team_id: "a", from_squad: "u23", to_squad: "senior" },
  ]);
});
