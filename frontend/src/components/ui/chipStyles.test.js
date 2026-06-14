import { test } from "node:test";
import assert from "node:assert/strict";
import { chipClass } from "./chipStyles.js";

test("chip er en pille (999px) med hairline-border + subtle flade", () => {
  const c = chipClass();
  assert.ok(c.includes("rounded-cz-pill"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(c.includes("bg-cz-subtle"));
  assert.ok(c.includes("uppercase"));
});

test("chip er neutral - ALDRIG guld (guld-disciplin A9)", () => {
  const c = chipClass();
  assert.ok(!c.includes("cz-accent"), "chip maa ikke bruge guld");
});

test("chip er ikke et slop-badge (ingen rounded-xl/2xl)", () => {
  const c = chipClass();
  assert.ok(!/rounded-(xl|2xl)/.test(c));
});

test("ekstra className foejes til", () => {
  assert.ok(chipClass({ className: "w-40" }).includes("w-40"));
});
