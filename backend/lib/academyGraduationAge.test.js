import test from "node:test";
import assert from "node:assert/strict";
import { ageForSeason } from "./riderSeasonAge.js";
import { planSeasonSquadPromotions } from "./seasonSquadPromotion.js";

test("automatisk oprykning bruger den valgte saesons alder (#5943 #7323)", () => {
  const junior = { id: "r1", team_id: "team1", squad: "junior", birthdate: "2008-05-01" };
  assert.deepEqual(planSeasonSquadPromotions([junior], 1), []);
  assert.equal(planSeasonSquadPromotions([junior], 2)[0].to_squad, "u23");
  const u23 = { ...junior, squad: "u23" };
  assert.deepEqual(planSeasonSquadPromotions([u23], 5), []);
  assert.equal(planSeasonSquadPromotions([u23], 6)[0].to_squad, "senior");
});

test("saeson-alder foelger saesonen: samme rytter er aeldre i en senere saeson", () => {
  assert.equal(ageForSeason("2007-05-01", 1), 19);
  assert.equal(ageForSeason("2007-05-01", 4), 22);
  assert.equal(ageForSeason("2007-05-01", null), null);
});
