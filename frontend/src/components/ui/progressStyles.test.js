import { test } from "node:test";
import assert from "node:assert/strict";
import { trackClass, fillClass, clampPercent } from "./progressStyles.js";

test("track er hairline-pille der clipper fyldet", () => {
  const c = trackClass();
  assert.ok(c.includes("w-full"));
  assert.ok(c.includes("overflow-hidden"));
  assert.ok(c.includes("rounded-cz-pill"));
  assert.ok(c.includes("bg-cz-subtle"));
});

test("fyld er accent som default (noegle-accent) + cz-progress-fill-klasse", () => {
  const c = fillClass();
  assert.ok(c.includes("cz-progress-fill"));
  assert.ok(c.includes("bg-cz-accent"));
});

test("tone styrer fyld-farve; ukendt falder tilbage til accent", () => {
  assert.ok(fillClass({ tone: "danger" }).includes("bg-cz-danger"));
  assert.ok(fillClass({ tone: "success" }).includes("bg-cz-success"));
  assert.equal(fillClass({ tone: "zz" }), fillClass({ tone: "accent" }));
});

test("clampPercent normaliserer value/max til 0-100 og er robust", () => {
  assert.equal(clampPercent(50, 100), 50);
  assert.equal(clampPercent(1, 4), 25);
  assert.equal(clampPercent(150, 100), 100);
  assert.equal(clampPercent(-5, 100), 0);
  assert.equal(clampPercent(Number.NaN, 100), 0);
  assert.equal(clampPercent(5, 0), 0);
});
