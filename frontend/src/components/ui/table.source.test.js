import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Table.jsx"), "utf8");

test("Table scroller horisontalt og eksporterer dele", () => {
  assert.match(src, /overflow-x-auto/);
  for (const part of ["function Table", "function Th", "function Td", "function Tr", "function JerseyDot"]) {
    assert.match(src, new RegExp(`export ${part}\\b`), `mangler ${part}`);
  }
});

test("Th sidder paa subtle-bg; sticky-prop giver sticky foerste kolonne", () => {
  assert.match(src, /bg-cz-subtle/);
  assert.match(src, /sticky left-0/);
});

test("Tr giver raekke-hover som group", () => {
  assert.match(src, /hover:bg-cz-subtle/);
  assert.match(src, /\bgroup\b/);
});

test("JerseyDot tager data-farve via style (ikke token)", () => {
  assert.match(src, /style=\{\{\s*backgroundColor/);
});
