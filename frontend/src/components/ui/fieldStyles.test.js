import { test } from "node:test";
import assert from "node:assert/strict";
import { controlClass, labelClass, helperClass } from "./fieldStyles.js";

test("control er fuld-bredde, skarp radius, hairline border som default", () => {
  const c = controlClass();
  assert.ok(c.includes("w-full"));
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(!c.includes("border-cz-danger"), "default maa ikke vaere error");
});

test("error-state giver danger-border (laast)", () => {
  const c = controlClass({ error: true });
  assert.ok(c.includes("border-cz-danger"));
  assert.ok(!c.includes("border-cz-border"));
});

test("size styrer padding; ukendt size falder tilbage til md", () => {
  assert.ok(controlClass({ size: "sm" }).includes("px-2.5"));
  assert.ok(controlClass({ size: "lg" }).includes("px-3.5"));
  assert.equal(controlClass({ size: "xx" }), controlClass({ size: "md" }));
});

test("label er versal Inter Tight; helper bliver danger ved error", () => {
  assert.ok(labelClass().includes("uppercase"));
  assert.ok(labelClass().includes("font-data"));
  assert.ok(helperClass().includes("text-cz-3"));
  assert.ok(helperClass({ error: true }).includes("text-cz-danger"));
});
