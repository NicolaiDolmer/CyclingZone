import test from "node:test";
import assert from "node:assert/strict";
import { planContractWarningBackfill } from "./backfill-7246-contract-warnings.js";

test("#7246 backfill: sender kun til (manager, rytter) uden varsel for sæsonen", () => {
  const owned = [
    { id: "r1", user_id: "u1" }, { id: "r2", user_id: "u1" }, { id: "r3", user_id: "u2" },
    { id: "r4", user_id: null },
  ];
  const plan = planContractWarningBackfill({ owned, existingKeys: new Set(["u1|r1"]) });
  assert.equal(plan.eligible, 3, "rytter uden manager tælles ikke");
  assert.equal(plan.alreadyWarned, 1);
  assert.deepEqual(plan.missing.map((r) => r.id), ["r2", "r3"]);
  assert.equal(plan.managers, 2);
});

test("#7246 backfill: et varsel til en tidligere ejer tæller ikke for den nye", () => {
  const plan = planContractWarningBackfill({ owned: [{ id: "r1", user_id: "u2" }], existingKeys: new Set(["u1|r1"]) });
  assert.deepEqual(plan.missing.map((r) => r.id), ["r1"]);
});
