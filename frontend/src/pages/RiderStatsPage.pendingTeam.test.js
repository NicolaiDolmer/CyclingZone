import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1287 — Rytter-profilen viser BÅDE nuværende hold og det kommende hold når en
// rytter er handlet til næste sæson (pending_team_id sat). Chippen rendres i
// headeren, men kræver at loadRider-querien joiner pending-holdet — fjernes
// joinet, forsvinder kommende-hold-visningen stille (samme fælde som #950 på
// RidersPage).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderStatsPage.jsx"), "utf8");

test("RiderStatsPage loadRider joiner pending-holdet (#1287)", () => {
  assert.match(
    source,
    /pending_team:pending_team_id\([^)]*\bname\b[^)]*\)/,
    "loadRider-select mangler 'pending_team:pending_team_id(...name...)' — kommende-hold-visningen kan ikke rendere holdnavnet uden joinet",
  );
});

test("RiderStatsPage skjuler kommende-hold-chip ved self-pending (#1287)", () => {
  assert.match(
    source,
    /rider\.pending_team\.id !== rider\.team\?\.id/,
    "self-pending (pending_team == nuværende hold, fx intern handel) er ikke et holdskifte og må ikke vise chip — samme guard som TeamCell (#950)",
  );
});
