import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3213 (fundet under #3148) — forward-guard: viewer-holdets ÆGTE spejder skal
// ind i alle viste bånd-beregninger. buildScoutEstimate/buildTypeCeilingBands
// tager et scout-parameter (#2244 Task A3), men falder TAVST tilbage til
// DEFAULT_SCOUT (overall 40) hvis call sitet udelader det — så har en hyret
// topspejder ingen effekt på de viste bånd. Kildetekst-scan af routes/api.js
// (samme mønster som potentialeHiding.routes.test.js) så en regression fanges
// uden live DB.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

test("#3213: alle buildScoutEstimate-kald i api.js sender viewer-holdets spejder med", () => {
  const calls = apiSource.match(/buildScoutEstimate\([^)]*\)/g) ?? [];
  assert.ok(
    calls.length >= 3,
    `forventede mindst 3 buildScoutEstimate-kald i api.js (estimates, :riderId, scouting-report), fandt ${calls.length}`,
  );
  for (const call of calls) {
    assert.match(
      call,
      /,\s*scout\s*\)$/,
      `buildScoutEstimate-kald mangler scout som sidste argument (falder tavst tilbage til DEFAULT_SCOUT): ${call}`,
    );
  }
});

test("#3213: alle buildTypeCeilingBands-kald i api.js sender viewer-holdets spejder med", () => {
  const calls = apiSource.match(/buildTypeCeilingBands\(\{[\s\S]*?\}\)/g) ?? [];
  assert.ok(
    calls.length >= 2,
    `forventede mindst 2 buildTypeCeilingBands-kald i api.js (scouting-report, development-projection), fandt ${calls.length}`,
  );
  for (const call of calls) {
    assert.match(
      call,
      /\bscout\b/,
      `buildTypeCeilingBands-kald mangler scout-feltet (falder tavst tilbage til DEFAULT_SCOUT): ${call}`,
    );
  }
});

test("#3213: scout-opslaget sker via scoutAssignmentService.loadScout (staff-SSOT)", () => {
  // Spejder-opslag (team_staff role='scouting' + staff_derived_abilities) må ikke
  // duplikeres i api.js — loadScout er SSOT og bruges allerede af job-service +
  // missions-sweep.
  assert.match(
    apiSource,
    /import\s*\{[^}]*\bloadScout\b[^}]*\}\s*from\s*"\.\.\/lib\/scoutAssignmentService\.js"/,
    "api.js skal importere loadScout fra scoutAssignmentService.js",
  );
});
