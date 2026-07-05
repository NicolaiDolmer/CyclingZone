import test from "node:test";
import assert from "node:assert/strict";
import { facilitiesNavItem } from "./facilitiesNavVisibility.js";

const t = (k) => k; // identitets-oversætter til test

test("facilitiesNavItem: [] når disabled, ét item når enabled", () => {
  assert.deepEqual(facilitiesNavItem(false, t), []);
  const items = facilitiesNavItem(true, t);
  assert.equal(items.length, 1);
  assert.equal(items[0].to, "/klub");
  assert.equal(items[0].label, "nav.item.klub");
});
