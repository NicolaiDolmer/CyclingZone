import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #950 — Ryttersiden viser kommende hold ("på vej til holdskifte"-chip) når en
// handel er parkeret (pending_team_id sat). Chippen rendres af TeamCell, men
// kræver at RidersPage-querien faktisk joiner pending-holdet — fjernes joinet,
// forsvinder chippen stille (samme fælde som #231 på AuctionsPage).

const __dirname = dirname(fileURLToPath(import.meta.url));
const ridersPageSource = readFileSync(join(__dirname, "RidersPage.jsx"), "utf8");
const teamCellSource = readFileSync(
  join(__dirname, "..", "components", "rider", "TeamCell.jsx"),
  "utf8",
);

test("RidersPage-select joiner pending-holdet (#950)", () => {
  assert.match(
    ridersPageSource,
    /pending_team:pending_team_id\([^)]*\bname\b[^)]*\)/,
    "select mangler 'pending_team:pending_team_id(...name...)' — holdskifte-chippen kan ikke rendere kommende holdnavn uden joinet",
  );
});

test("RidersPage giver pending-holdet videre til TeamCell (#950)", () => {
  assert.match(
    ridersPageSource,
    /pendingTeam=\{rider\.pending_team\}/,
    "RiderRow skal sende rider.pending_team som pendingTeam-prop til TeamCell",
  );
});

test("TeamCell skjuler chip ved self-pending (intern handel) (#950)", () => {
  assert.match(
    teamCellSource,
    /pendingTeam\.id !== team\?\.id/,
    "self-pending (pending_team == nuværende hold) er ikke et holdskifte og må ikke vise chip — jf. dashboardSquadStats self-pending-edge",
  );
});
