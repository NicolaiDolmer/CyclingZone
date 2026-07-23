import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

// #2849 bølge 0 — de kanoniske side-primitiver (docs/design/PAGE_TEMPLATES.md).

test("PageHeader: 20px/700 Inter Tight-titel + 13px subtitle + mb-6 + mobil-wrap", () => {
  const src = read("PageHeader.jsx");
  assert.match(src, /font-data text-\[20px\] font-bold tracking-\[-0\.01em\]/);
  assert.match(src, /mt-1 text-\[13px\] text-cz-2/);
  assert.match(src, /mb-6/);
  assert.match(src, /flex-wrap/, "action-cluster skal wrappe under titlen på mobil");
  assert.match(src, /<h1/);
});

test("Section: komponerer Card med 20px padding (16px mobil)", () => {
  const src = read("Section.jsx");
  assert.match(src, /import Card from "\.\/Card\.jsx"/, "recipen genbruger Card, ikke en håndkopi");
  assert.match(src, /p-4 sm:p-5/);
});

test("SectionStack: sibling-gap 14px", () => {
  const src = read("Section.jsx");
  assert.match(src, /gap-\[14px\]/);
});

test("SectionHeader: 15px/600-titel; quiet action XOR uppercase meta", () => {
  const src = read("Section.jsx");
  assert.match(src, /text-\[15px\] font-semibold/);
  assert.match(src, /tracking-\[\.08em\]/);
  assert.match(src, /!action && meta/, "meta må aldrig rendere sammen med action");
});

test("SectionAction: 12px/500 accent-t + chevron 13px", () => {
  const src = read("Section.jsx");
  assert.match(src, /text-xs font-medium text-cz-accent-t/);
  assert.match(src, /ChevronRightIcon size=\{13\}/);
});

test("DataTable: sticky-underlinje 10.5px uppercase + mobil-fold + sort-aria", () => {
  const src = read("DataTable.jsx");
  assert.match(src, /text-\[10\.5px\] uppercase/);
  assert.match(src, /text-\[13\.5px\] font-medium/);
  assert.match(src, /hidden sm:table-cell/, "fold-kolonner skjules ≤640px");
  assert.match(src, /sm:hidden/, "foldede værdier vises kun i mobil-underlinjen");
  assert.match(src, /aria-sort/);
  assert.match(src, /SortIndicator/);
});
