import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("Field lader label/helper/error komme fra fieldStyles", () => {
  const src = read("Field.jsx");
  assert.match(src, /labelClass\(/);
  assert.match(src, /helperClass\(/);
  assert.match(src, /error/, "Field skal kunne vise error-besked");
});

test("Input/Textarea bruger controlClass, saetter aria-invalid, forwarder rest", () => {
  for (const f of ["Input.jsx", "Textarea.jsx"]) {
    const src = read(f);
    assert.match(src, /controlClass\(/, `${f} skal bruge controlClass`);
    assert.match(src, /aria-invalid/, `${f} skal saette aria-invalid`);
    assert.match(src, /\.\.\.rest/, `${f} skal forwarde rest-props`);
    assert.ok(!/outline:\s*none/.test(src), `${f} maa ikke fjerne fokus-ringen`);
  }
});

test("Select er chevron-baseret native select", () => {
  const src = read("Select.jsx");
  assert.match(src, /appearance-none/);
  assert.match(src, /ChevronDownIcon/);
});

test("Checkbox/Radio bruger native input + accent-color (guld-selektion)", () => {
  assert.match(read("Checkbox.jsx"), /type="checkbox"/);
  assert.match(read("Checkbox.jsx"), /accent-cz-accent/);
  assert.match(read("Radio.jsx"), /type="radio"/);
  assert.match(read("Radio.jsx"), /rounded-cz-pill|rounded-full/);
});

test("Toggle er en switch med peer-dreven thumb", () => {
  const src = read("Toggle.jsx");
  assert.match(src, /role="switch"/);
  assert.match(src, /peer-checked:translate-x-4/);
  assert.match(src, /peer-checked:bg-cz-accent/);
});
