import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Button.jsx"), "utf8");

test("Button bruger buttonClass og saetter aldrig outline:none", () => {
  assert.match(src, /buttonClass\(/, "Button skal komme sin styling fra buttonClass");
  assert.ok(!/outline:\s*none/.test(src), "Button maa ikke fjerne fokus-ringen");
});

test("Button har loading-state og forwarder rest-props", () => {
  assert.match(src, /loading/, "Button skal have loading-prop");
  assert.match(src, /\.\.\.rest/, "Button skal forwarde rest-props til <button>");
});
