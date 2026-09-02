import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "DataTable.jsx"), "utf8");

// #4625 (slice 3 af #4622, TASTE fork 6 / P10) — pinned navnekolonne + vandret
// scroll er mobil-standarden for T2. SCROLLER er ubetinget; DataTable advarer
// nu (dev-only) naar ingen kolonne er markeret sticky.
test("DataTable's mobil-scroller er ubetinget, og tabellen advarer uden en sticky-kolonne", () => {
  assert.match(src, /SCROLLER\b/);
  assert.match(src, /columns\.some\(\(c\) => c\.sticky\)/);
  assert.match(src, /console\.error/);
});

// #4625 — raekkeknapper er ALTID secondary (PAGE_TEMPLATES T2). DataTable
// wrapper <tbody> i TableRowContext saa Button kan haandhaeve det.
test("DataTable wrapper tbody i TableRowContext.Provider", () => {
  assert.match(src, /TableRowContext\.Provider value=\{true\}/);
  assert.match(src, /<TableRowContext\.Provider[\s\S]*<tbody>[\s\S]*<\/tbody>[\s\S]*<\/TableRowContext\.Provider>/);
});
