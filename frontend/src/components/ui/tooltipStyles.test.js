import { test } from "node:test";
import assert from "node:assert/strict";
import { tooltipClass } from "./tooltipStyles.js";

test("tooltip-boble er over indhold, pointer-transparent, reveal paa hover+fokus", () => {
  const c = tooltipClass();
  assert.ok(c.includes("cz-tooltip"));
  assert.ok(c.includes("z-overlay"));
  assert.ok(c.includes("pointer-events-none"));
  assert.ok(c.includes("group-hover:opacity-100"));
  assert.ok(c.includes("group-focus-within:opacity-100"));
  assert.ok(c.includes("shadow-overlay"));
});

test("side styrer placering; ukendt falder tilbage til top", () => {
  assert.ok(tooltipClass({ side: "bottom" }).includes("top-full"));
  assert.ok(tooltipClass({ side: "top" }).includes("bottom-full"));
  assert.equal(tooltipClass({ side: "zz" }), tooltipClass({ side: "top" }));
});
