import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Source-string-guard for de tre #1480-krav på træningssiden:
//   1) vis ryttertype  2) gruppér efter type  3) rediger flere ad gangen.
// Spejler StatBar-guard-mønstret (RidersPage.statBar.test.js).
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");

test("#1480.1 roster-query henter ryttertype-kolonnerne", () => {
  assert.match(
    src,
    /\.select\("id, firstname, lastname, primary_type, secondary_type"\)/,
    "querien skal hente primary_type/secondary_type så typen kan vises",
  );
});

test("#1480.1 hver række renderer en RiderTypeBadge", () => {
  assert.match(src, /import RiderTypeBadge from/);
  assert.match(
    src,
    /<RiderTypeBadge primaryType=\{rider\.primary_type\} secondaryType=\{rider\.secondary_type\} \/>/,
  );
});

test("#1480.2 group-by-type-toggle styrer grupperet visning via groupRidersByType", () => {
  assert.match(src, /import \{ groupRidersByType, UNTYPED_KEY \} from/);
  assert.match(src, /groupByType\s*\?\s*groupRidersByType\(riders\)/);
  assert.match(src, /t\("groupByType"\)/);
});

test("#1480.3 multi-select + bulk-apply via setPlanBulk", () => {
  assert.match(src, /setPlanBulk/, "skal bruge bulk-handleren");
  assert.match(src, /handleBulkApply/);
  assert.match(src, /t\("bulkApply"/);
  // Select-all + per-række checkbox.
  assert.match(src, /toggleSelectAll/);
  assert.match(src, /toggleSelect\(rider\.id\)/);
});
