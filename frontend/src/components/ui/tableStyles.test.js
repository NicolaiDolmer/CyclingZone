import { test } from "node:test";
import assert from "node:assert/strict";
import { cellClass } from "./tableStyles.js";

test("data-celle er venstrestillet med hairline-toplinje", () => {
  const c = cellClass();
  assert.ok(c.includes("text-left"));
  assert.ok(c.includes("border-t"));
  assert.ok(c.includes("border-cz-border"));
});

test("numerisk celle er hoejrestillet + tabular", () => {
  const c = cellClass({ numeric: true });
  assert.ok(c.includes("text-right"));
  assert.ok(c.includes("tabular-nums"));
  assert.ok(c.includes("font-data"));
});

test("header er versal label-stil uden raekke-border", () => {
  const c = cellClass({ header: true });
  assert.ok(c.includes("uppercase"));
  assert.ok(c.includes("text-cz-3"));
  assert.ok(!c.includes("border-t"), "header skal ikke have raekke-toplinje");
});
