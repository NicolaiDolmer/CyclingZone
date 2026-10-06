import { test } from "node:test";
import assert from "node:assert/strict";
import { panelClass, backdropClass } from "./modalStyles.js";

test("panel er fuld-bredde hairline-kort med soft-lift overlay-skygge", () => {
  const c = panelClass();
  assert.ok(c.includes("w-full"));
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(c.includes("bg-cz-card"));
  assert.ok(c.includes("shadow-overlay"));
  assert.ok(!/shadow-\[0_0/.test(c), "ingen glow");
});

test("size styrer max-bredde; ukendt falder tilbage til md", () => {
  assert.ok(panelClass({ size: "sm" }).includes("max-w-sm"));
  assert.ok(panelClass({ size: "lg" }).includes("max-w-2xl"));
  assert.equal(panelClass({ size: "zz" }), panelClass({ size: "md" }));
});

test("backdrop er scrim uden blur (anti-slop A9)", () => {
  const b = backdropClass();
  assert.ok(b.includes("inset-0"));
  assert.ok(b.includes("bg-black/60"));
  assert.ok(!b.includes("backdrop-blur"), "ingen backdrop-blur");
});
