import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonClass } from "./buttonStyles.js";

test("primary er guld-fyld med skarp radius", () => {
  const c = buttonClass({ variant: "primary" });
  assert.ok(c.includes("bg-cz-accent"));
  assert.ok(c.includes("text-cz-on-accent"));
  assert.ok(c.includes("rounded-cz"));
});

test("secondary er neutral outline (laast valg A)", () => {
  const c = buttonClass({ variant: "secondary" });
  assert.ok(c.includes("border-cz-border"));
  assert.ok(!c.includes("border-cz-accent"), "secondary maa ikke vaere guld-outline");
});

test("ukendt variant falder tilbage til primary; size styrer padding; fullWidth", () => {
  assert.equal(buttonClass({ variant: "xx" }), buttonClass({ variant: "primary" }));
  assert.ok(buttonClass({ size: "sm" }).includes("px-3"));
  assert.ok(buttonClass({ size: "lg" }).includes("px-5"));
  assert.ok(buttonClass({ fullWidth: true }).includes("w-full"));
});
