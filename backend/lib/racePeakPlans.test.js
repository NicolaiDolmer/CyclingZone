// Race Engine v3 (#2224), slice S5 — racePeakPlans I/O + ordinal-konvertering.
import test from "node:test";
import assert from "node:assert/strict";

import {
  dateStringToOrdinal,
  scheduledAtToOrdinal,
  resolvePeakTrainingQuality,
  loadStageDayOrdinals,
  loadPeakPlans,
  serializePeakInputs,
} from "./racePeakPlans.js";

const DAY_MS = 86_400_000;

// ── dateStringToOrdinal ───────────────────────────────────────────────────────

test("dateStringToOrdinal: epoch-dagen 1970-01-01 = 0, efterfølgende dage +1", () => {
  assert.equal(dateStringToOrdinal("1970-01-01"), 0);
  assert.equal(dateStringToOrdinal("1970-01-02"), 1);
  assert.equal(dateStringToOrdinal("2026-07-13"), Date.parse("2026-07-13T00:00:00Z") / DAY_MS);
});

test("dateStringToOrdinal: to nabo-datoer er præcis 1 fra hinanden", () => {
  assert.equal(dateStringToOrdinal("2026-07-14") - dateStringToOrdinal("2026-07-13"), 1);
});

test("dateStringToOrdinal: accepterer timestamptz-lignende input (slicer til 10 tegn)", () => {
  assert.equal(dateStringToOrdinal("2026-07-13T23:59:00Z"), dateStringToOrdinal("2026-07-13"));
});

test("dateStringToOrdinal: null/tom/ugyldig → null", () => {
  assert.equal(dateStringToOrdinal(null), null);
  assert.equal(dateStringToOrdinal(undefined), null);
  assert.equal(dateStringToOrdinal(""), null);
  assert.equal(dateStringToOrdinal("ikke-en-dato"), null);
});

// ── scheduledAtToOrdinal ──────────────────────────────────────────────────────

test("scheduledAtToOrdinal: et sent CET-tidspunkt lander på den DANSKE kalenderdag", () => {
  // 2026-07-13 22:30 UTC = 2026-07-14 00:30 CEST (dansk sommertid, +2) → dansk dag 14/7.
  assert.equal(scheduledAtToOrdinal("2026-07-13T22:30:00Z"), dateStringToOrdinal("2026-07-14"));
  // Midt på dagen UTC = samme danske dag.
  assert.equal(scheduledAtToOrdinal("2026-07-13T10:00:00Z"), dateStringToOrdinal("2026-07-13"));
});

test("scheduledAtToOrdinal: ugyldig → null", () => {
  assert.equal(scheduledAtToOrdinal("nope"), null);
  assert.equal(scheduledAtToOrdinal(null), null);
});

// ── resolvePeakTrainingQuality (dormant seam) ─────────────────────────────────

test("resolvePeakTrainingQuality: dormant seam returnerer loft (1) indtil koblings-resolveren lander", () => {
  assert.equal(resolvePeakTrainingQuality({ riderId: "r1" }), 1);
  assert.equal(resolvePeakTrainingQuality(), 1);
});

// ── Fake supabase (samme mønster som raceFatigue.test.js) ─────────────────────
// Bygger en thenable query-builder; det sidste led i kæden resolves med { data }.
function makeSupabase(tables = {}) {
  function from(table) {
    const rows = tables[table] ?? [];
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      then(resolve, reject) {
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

// ── loadStageDayOrdinals ──────────────────────────────────────────────────────

test("loadStageDayOrdinals: mapper stage_number → CET-ordinal, springer ugyldige datoer over", async () => {
  const supabase = makeSupabase({
    race_stage_schedule: [
      { stage_number: 1, scheduled_at: "2026-07-13T10:00:00Z" },
      { stage_number: 2, scheduled_at: "2026-07-14T10:00:00Z" },
      { stage_number: 3, scheduled_at: null }, // udelades
    ],
  });
  const map = await loadStageDayOrdinals({ supabase, raceId: "race-1" });
  assert.equal(map.get(1), dateStringToOrdinal("2026-07-13"));
  assert.equal(map.get(2), dateStringToOrdinal("2026-07-14"));
  assert.equal(map.has(3), false);
});

test("loadStageDayOrdinals: DB-fejl → throw", async () => {
  const supabase = {
    from() {
      return { select() { return this; }, eq() { return this; },
        then(res) { return Promise.resolve({ data: null, error: { message: "boom" } }).then(res); } };
    },
  };
  await assert.rejects(() => loadStageDayOrdinals({ supabase, raceId: "r" }), /race_stage_schedule.*boom/);
});

// ── loadPeakPlans ─────────────────────────────────────────────────────────────

test("loadPeakPlans: grupperer pr. rytter, konverterer datoer → ordinaler", async () => {
  const supabase = makeSupabase({
    rider_peak_plans: [
      { rider_id: "r1", window_start: "2026-07-10", window_end: "2026-07-14", target_race_id: "tdf" },
      { rider_id: "r1", window_start: "2026-08-01", window_end: "2026-08-05", target_race_id: "vuelta" },
      { rider_id: "r2", window_start: "2026-07-12", window_end: "2026-07-16", target_race_id: null },
    ],
  });
  const map = await loadPeakPlans({ supabase, seasonId: "s1", riderIds: ["r1", "r2"] });
  assert.equal(map.get("r1").length, 2);
  assert.deepEqual(map.get("r1")[0], {
    start: dateStringToOrdinal("2026-07-10"),
    end: dateStringToOrdinal("2026-07-14"),
    targetRaceId: "tdf",
  });
  assert.equal(map.get("r2")[0].targetRaceId, null);
});

test("loadPeakPlans: tom sæson/rytterliste → tom map (ingen DB-kald nødvendigt)", async () => {
  const supabase = makeSupabase({});
  assert.equal((await loadPeakPlans({ supabase, seasonId: null, riderIds: ["r1"] })).size, 0);
  assert.equal((await loadPeakPlans({ supabase, seasonId: "s1", riderIds: [] })).size, 0);
});

test("loadPeakPlans: ugyldig dato på en plan → planen udelades", async () => {
  const supabase = makeSupabase({
    rider_peak_plans: [{ rider_id: "r1", window_start: "kaputt", window_end: "2026-07-14", target_race_id: null }],
  });
  const map = await loadPeakPlans({ supabase, seasonId: "s1", riderIds: ["r1"] });
  assert.equal(map.has("r1"), false);
});

// ── serializePeakInputs (checksum-determinisme) ───────────────────────────────

test("serializePeakInputs: kun entrants med vinduer, sorteret deterministisk", () => {
  const a = serializePeakInputs([
    { rider_id: "r2", peakWindows: [{ start: 5, end: 9 }], peakTrainingQuality: 1 },
    { rider_id: "r1", peakWindows: [{ start: 20, end: 24 }, { start: 3, end: 7 }], peakTrainingQuality: 0.5 },
    { rider_id: "r3", peakWindows: [] }, // udelades
  ]);
  assert.deepEqual(a, [
    ["r1", [[3, 7], [20, 24]], 0.5],
    ["r2", [[5, 9]], 1],
  ]);
  // Input-orden må ikke ændre output (deterministisk nøgle).
  const b = serializePeakInputs([
    { rider_id: "r1", peakWindows: [{ start: 3, end: 7 }, { start: 20, end: 24 }], peakTrainingQuality: 0.5 },
    { rider_id: "r2", peakWindows: [{ start: 5, end: 9 }], peakTrainingQuality: 1 },
  ]);
  assert.deepEqual(a, b);
});
