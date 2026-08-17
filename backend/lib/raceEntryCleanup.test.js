// #3805: countFutureRaceEntries + countOngoingRaceEntries — read-only preview-
// tællere brugt af BÅDE academy-demote-quote-routen (dialog-preview, FØR
// bekræftelse) og academyTransfer.js's demote() (den faktiske konsekvens,
// EFTER bekræftelse). Samme funktion begge steder — ingen JS-kopi der kan
// drive fra virkeligheden (det var netop #3805-bug'en: dialogen talte kun
// "kommende løb ryddet" og viste 0 for en rytter der faktisk faldt ud af et
// IGANGVÆRENDE løb).
import test from "node:test";
import assert from "node:assert/strict";

import { countFutureRaceEntries, countOngoingRaceEntries, clearFutureRaceEntries } from "./raceEntryCleanup.js";

// Minimal mock: race_entries!inner(races) — filtrerer i JS ud fra de samme
// eq/gt-kald den ægte kode foretager, så testen beviser PRÆDIKATET, ikke bare
// at funktionen kalder supabase. .delete() understøttes også (best-effort, no-op)
// så clearFutureRaceEntries kan køre igennem uden en ægte delete-backend.
function makeSupabase(rows, { onDelete } = {}) {
  return {
    from(table) {
      assert.equal(table, "race_entries");
      const filters = [];
      const api = {
        select() { return api; },
        eq(col, val) { filters.push({ col, op: "eq", val }); return api; },
        gt(col, val) { filters.push({ col, op: "gt", val }); return api; },
        delete() {
          return {
            eq() {
              return {
                in(_col, raceIds) {
                  onDelete?.(raceIds);
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
        then(resolve, reject) {
          const data = rows.filter((row) => filters.every((f) => {
            const actual = f.col === "rider_id" ? row.rider_id
              : f.col === "races.status" ? row.races.status
              : f.col === "races.stages_completed" ? row.races.stages_completed
              : undefined;
            return f.op === "eq" ? actual === f.val : actual > f.val;
          }));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

const FIXTURE = [
  { rider_id: "r1", race_id: "future-1", races: { status: "scheduled", stages_completed: 0 } },
  { rider_id: "r1", race_id: "ongoing-1", races: { status: "scheduled", stages_completed: 2 } },
  { rider_id: "r1", race_id: "completed-1", races: { status: "completed", stages_completed: 5 } },
  { rider_id: "other-rider", race_id: "future-2", races: { status: "scheduled", stages_completed: 0 } },
];

test("countFutureRaceEntries: tæller kun status=scheduled + stages_completed=0 for rytteren", async () => {
  const supabase = makeSupabase(FIXTURE);
  assert.equal(await countFutureRaceEntries(supabase, "r1"), 1);
});

test("countOngoingRaceEntries: tæller kun status=scheduled + stages_completed>0 for rytteren", async () => {
  const supabase = makeSupabase(FIXTURE);
  assert.equal(await countOngoingRaceEntries(supabase, "r1"), 1);
});

test("countFutureRaceEntries/countOngoingRaceEntries: 0 uden riderId eller uden matchende rækker", async () => {
  const supabase = makeSupabase(FIXTURE);
  assert.equal(await countFutureRaceEntries(supabase, null), 0);
  assert.equal(await countOngoingRaceEntries(supabase, null), 0);
  assert.equal(await countFutureRaceEntries(supabase, "no-such-rider"), 0);
  assert.equal(await countOngoingRaceEntries(supabase, "no-such-rider"), 0);
});

// #3805: countFutureRaceEntries's SELECT-prædikat skal matche
// clearFutureRaceEntries's SELECT-prædikat 1:1 (den bruges til selve
// sletningen) — ellers kan preview-tallet (denne fil) og det faktisk ryddede
// antal (raceEntryCleanup.clearFutureRaceEntries, kaldt af andre afgangs-
// stier end demote) drive fra hinanden.
test("countFutureRaceEntries og clearFutureRaceEntries er enige om hvad der er 'fremtidigt'", async () => {
  const count = await countFutureRaceEntries(makeSupabase(FIXTURE), "r1");
  const { cleared } = await clearFutureRaceEntries({ supabase: makeSupabase(FIXTURE), riderId: "r1" });
  assert.equal(cleared, count);
});
