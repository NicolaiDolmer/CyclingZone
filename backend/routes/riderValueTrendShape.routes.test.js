// #2597 — regressionstest: bulk-endpointet (POST /api/riders/value-trend)
// mistede sit {windows}-wrap og matchede derfor ALDRIG single-endpointets
// (GET /api/riders/:id/value-trend) response-shape. Frontend læser
// `valueTrends[r.id]?.windows` (TeamPage.jsx) — uden wrap: altid undefined,
// og værdi-trend-pilene renderede derfor ALDRIG på holdlisten i prod.
//
// api.js kaldes ikke direkte her (kræver live Supabase-client, samme
// begrænsning som scoutAssignments.routes.test.js) — i stedet:
// 1. behavioral test af de DELTE, rene beregningsfunktioner
//    (computeRiderValueTrend + groupSnapshotsByRider fra lib/riderValueTrend.js)
//    der beviser single- og batch-stien regner PRÆCIS samme windows-indhold
//    for samme rytter.
// 2. kildetekst-scan der låser at BEGGE routes wrapper resultatet i
//    `{ windows }` — den faktiske linje der brækkede i #2597.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeRiderValueTrend, groupSnapshotsByRider } from "../lib/riderValueTrend.js";
import { recomputeRiderValue } from "../lib/riderValueRefresh.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "./api.js"), "utf8");

// Samme ægte fixtures som lib/riderValueTrend.test.js — ikke opfundne tal.
const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

const WEAK = { climbing: 40, time_trial: 38, prolog: 35, flat: 39, tempo: 38, sprint: 30, acceleration: 32, punch: 33, endurance: 41, recovery: 38, durability: 37, descending: 35, cobblestone: 28, positioning: 33, aggression: 33, tactics: 33 };
const STRONG = { climbing: 70, time_trial: 66, prolog: 60, flat: 68, tempo: 67, sprint: 50, acceleration: 55, punch: 58, endurance: 72, recovery: 68, durability: 65, descending: 62, cobblestone: 48, positioning: 60, aggression: 58, tactics: 58 };

const NOW = new Date("2026-07-16T00:00:00Z");
function isoDaysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);
}

test("#2597 — computeRiderValueTrend giver IDENTISK windows for single- og batch-stien (samme rytter, samme data)", () => {
  const riderId = "rider-a";
  const currentBaseValue = recomputeRiderValue({}, STRONG, baseline, model).base_value;
  const snaps = [
    { rider_id: riderId, snapshot_date: isoDaysAgo(20), abilities: WEAK },
    { rider_id: riderId, snapshot_date: isoDaysAgo(7), abilities: STRONG },
  ];

  // Single-stien (GET): snapshotsAsc leveres direkte for ÉN rytter.
  const singleWindows = computeRiderValueTrend({
    currentBaseValue,
    snapshotsAsc: snaps,
    baseline,
    model,
    now: NOW,
  });

  // Batch-stien (POST): flade rækker for FLERE ryttere, grupperet i memory
  // via groupSnapshotsByRider — præcis samme kode-sti som den rigtige route kører.
  const otherRiderSnaps = [{ rider_id: "rider-b", snapshot_date: isoDaysAgo(5), abilities: WEAK }];
  const grouped = groupSnapshotsByRider([...snaps, ...otherRiderSnaps]);
  const batchWindows = computeRiderValueTrend({
    currentBaseValue,
    snapshotsAsc: grouped.get(riderId) || [],
    baseline,
    model,
    now: NOW,
  });

  assert.deepEqual(
    batchWindows,
    singleWindows,
    "batch-stien (groupSnapshotsByRider + computeRiderValueTrend) skal give samme windows-indhold som single-stien for samme rytter",
  );
  // Sanity: der er faktisk noget at sammenligne (ikke bare {7:null,14:null} begge veje).
  assert.ok(singleWindows["7"] || singleWindows["14"], "test-fixturen skal producere mindst ét ikke-null vindue");
});

test("#2597 — GET /riders/:id/value-trend svarer res.json({ windows }) (single-shape)", () => {
  const idx = apiSource.indexOf('router.get("/riders/:id/value-trend"');
  assert.ok(idx !== -1, "GET /riders/:id/value-trend skal findes");
  const block = apiSource.slice(idx, idx + 1200);
  assert.match(block, /res\.json\(\{\s*windows\s*\}\)/, "GET skal wrappe svaret i { windows }");
});

test("#2597 — POST /riders/value-trend wrapper HVER rytters resultat i { windows } (bulk-shape parity)", () => {
  const idx = apiSource.indexOf('router.post("/riders/value-trend"');
  assert.ok(idx !== -1, "POST /riders/value-trend skal findes");
  const block = apiSource.slice(idx, idx + 1500);

  // Selve regressionen fra #2597: result[r.id] SKAL wrappe computeRiderValueTrend
  // i { windows: ... } — ikke tildele det rå windows-objekt direkte.
  assert.match(
    block,
    /result\[r\.id\]\s*=\s*\{\s*windows:\s*computeRiderValueTrend\(/,
    "bulk-svaret skal wrappe pr.-rytter resultatet som { windows: computeRiderValueTrend(...) } — matcher GET-shapen",
  );
  // Forward-guard: den gamle, brækkede form (uden wrap) må ALDRIG stå der igen.
  assert.doesNotMatch(
    block,
    /result\[r\.id\]\s*=\s*computeRiderValueTrend\(/,
    "bulk-svaret må IKKE tildele computeRiderValueTrend(...) direkte til result[r.id] — det er #2597-regressionen (mangler {windows}-wrap)",
  );
});
