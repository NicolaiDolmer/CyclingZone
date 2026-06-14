import { test } from "node:test";
import assert from "node:assert/strict";
import { statusBadgeClass, categoryTagClass, STATUS_TONE } from "./badgeStyles.js";

test("status er broadcast: ingen pille-baggrund som default", () => {
  const c = statusBadgeClass("live");
  assert.ok(!c.includes("rounded-cz-pill"), "status maa ikke vaere en pille");
  assert.ok(c.includes("text-cz-info"), "live skal bruge info-tonen");
});

test("emphasis-status faar skarp tonet blok (ikke pille)", () => {
  const c = statusBadgeClass("closing", { emphasis: true });
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("bg-cz-warning/10"));
});

test("category-tag er skarp data-tag; dense er borderless keyline", () => {
  assert.ok(categoryTagClass().includes("rounded-cz"));
  assert.ok(categoryTagClass().includes("border-cz-border"));
  const dense = categoryTagClass({ dense: true });
  assert.ok(dense.includes("border-l-2"), "dense = venstre guld-keyline");
  assert.ok(!dense.includes("border-cz-border"));
});

test("STATUS_TONE mapper kendte states", () => {
  assert.equal(STATUS_TONE.won, "success");
  assert.equal(STATUS_TONE.outbid, "danger");
});
