import test from "node:test";
import assert from "node:assert/strict";
import { seasonWrapDismissKey } from "./seasonWrapNudge.js";

test("seasonWrapDismissKey: keyed on the completed season id", () => {
  assert.equal(seasonWrapDismissKey("s1"), "cz-dashboard-season-wrap-dismissed-s1");
  assert.equal(seasonWrapDismissKey("s2"), "cz-dashboard-season-wrap-dismissed-s2");
});
