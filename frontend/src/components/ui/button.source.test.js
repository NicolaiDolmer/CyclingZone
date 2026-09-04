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

// #4625 (slice 3 af #4622) — PAGE_TEMPLATES T2: raekkeknapper er ALTID secondary.
// Blødgjort 2/9 (PR #4657 opfølgning): logger console.error i dev i stedet
// for at kaste, og tvinger variant til secondary i raekken, indtil
// migrationen af eksisterende kald er gjort.
test("Button logger console.error i dev og tvinger secondary naar variant=primary bruges inde i en DataTable-raekke", () => {
  assert.match(src, /TableRowContext/, "Button skal laese TableRowContext");
  assert.match(src, /useContext\(TableRowContext\)/);
  assert.match(src, /inTableRow && variant === "primary"/);
  assert.match(src, /console\.error/, "Button skal logge console.error i stedet for at kaste");
  assert.doesNotMatch(src, /throw new Error/, "Button maa ikke laengere kaste i dev");
  assert.match(src, /effectiveVariant/, "Button skal rendere med en tvunget secondary-variant i raekken");
});
