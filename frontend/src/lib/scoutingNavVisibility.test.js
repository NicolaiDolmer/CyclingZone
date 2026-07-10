import test from "node:test";
import assert from "node:assert/strict";
import { scoutingNavItem } from "./scoutingNavVisibility.js";

const t = (k) => k; // identitets-oversætter til test

test("scoutingNavItem: [] når scout_system_enabled er slukket, ét item når tændt", () => {
  assert.deepEqual(scoutingNavItem(false, t), []);
  const items = scoutingNavItem(true, t);
  assert.equal(items.length, 1);
  assert.equal(items[0].to, "/scouting");
  assert.equal(items[0].label, "nav.item.scouting");
});
