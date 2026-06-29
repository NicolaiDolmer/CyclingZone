import test from "node:test";
import assert from "node:assert/strict";

import { runAbilityProgressCapsBackfill } from "./backfillAbilityProgressCaps.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";

// Mock for backfill-stien:
//   read:  rider_derived_abilities.select(cols).or(...).order().range()
//          → rækker, hver med joinet `riders`-objekt (riders!inner(...)).
//   write: rider_derived_abilities.update(patch).eq("rider_id", id)
function makeMock(rows) {
  const writes = { updates: [] };
  function from(table) {
    const b = {
      select() { return b; },
      or() { return b; },
      eq() { return b; },
      order() { return b; },
      range() {
        if (table === "rider_derived_abilities") return Promise.resolve({ data: rows, error: null });
        return Promise.resolve({ data: [], error: null });
      },
      update(patch) {
        return { eq(col, val) { writes.updates.push({ table, patch, col, val }); return Promise.resolve({ error: null }); } };
      },
    };
    return b;
  }
  return { from, writes };
}

// En abilities-række med joinet rytter. baseline-evner = 50 medmindre overstyret.
function makeRow(rider_id, { caps = null, progress = null, rider = {}, abilities = {} } = {}) {
  const row = {
    rider_id,
    ability_caps: caps,
    ability_progress: progress,
    riders: {
      id: rider_id,
      primary_type: "climber",
      secondary_type: "tt",
      potentiale: 4,
      birthdate: "1996-01-01", // voksen (30 ved asOfYear 2026)
      is_retired: false,
      ...rider,
    },
  };
  for (const k of VISIBLE_ABILITIES) row[k] = abilities[k] ?? 50;
  return row;
}

const noLog = () => {};

test("backfill (dry-run): finder NULL-rækker men skriver intet", async () => {
  const supabase = makeMock([makeRow("r1"), makeRow("r2")]);
  const res = await runAbilityProgressCapsBackfill({ supabase, dryRun: true, log: noLog });
  assert.equal(res.dryRun, true);
  assert.equal(res.candidates, 2);
  assert.equal(res.capsSet, 2);
  assert.equal(res.progressSet, 2);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0, "dry-run må ikke skrive");
});

test("backfill (live): sætter caps + progress for voksen rytter med begge NULL", async () => {
  const supabase = makeMock([makeRow("r1")]);
  const res = await runAbilityProgressCapsBackfill({ supabase, dryRun: false, log: noLog });
  assert.equal(res.written, 1);
  assert.equal(supabase.writes.updates.length, 1);
  const u = supabase.writes.updates[0];
  assert.equal(u.col, "rider_id");
  assert.equal(u.val, "r1");

  // caps: et objekt med en cap pr. synlig evne ∈ [0,99].
  assert.ok(u.patch.ability_caps && typeof u.patch.ability_caps === "object");
  for (const k of VISIBLE_ABILITIES) {
    assert.ok(Number.isFinite(u.patch.ability_caps[k]), `cap for ${k} er et tal`);
    assert.ok(u.patch.ability_caps[k] >= 0 && u.patch.ability_caps[k] <= 99);
  }
  // progress: nul-initialiseret over alle synlige evner.
  assert.ok(u.patch.ability_progress && typeof u.patch.ability_progress === "object");
  for (const k of VISIBLE_ABILITIES) assert.equal(u.patch.ability_progress[k], 0);
});

test("backfill: rører KUN det NULL-felt (bevarer eksisterende caps når kun progress mangler)", async () => {
  const existingCaps = { climbing: 90 };
  const supabase = makeMock([makeRow("r1", { caps: existingCaps, progress: null })]);
  const res = await runAbilityProgressCapsBackfill({ supabase, dryRun: false, log: noLog });
  assert.equal(res.capsSet, 0, "caps allerede sat → ikke rørt");
  assert.equal(res.progressSet, 1, "kun progress sættes");
  const u = supabase.writes.updates[0];
  assert.equal(u.patch.ability_caps, undefined, "eksisterende caps overskrives ikke");
  assert.ok(u.patch.ability_progress, "progress sat");
});

test("backfill: akademi-alder rytter får afkoblede ungdoms-caps (højere end lav baseline)", async () => {
  const supabase = makeMock([makeRow("young", {
    rider: { birthdate: "2009-01-01", potentiale: 6 }, // 17 ved asOfYear 2026
    abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 8])), // lav baseline
  })]);
  const res = await runAbilityProgressCapsBackfill({ supabase, dryRun: false, log: noLog });
  assert.equal(res.capsSet, 1);
  const caps = supabase.writes.updates[0].patch.ability_caps;
  // Afkoblet ungdoms-loft: climbing (signatur) skal ligge langt over baseline 8.
  assert.ok(caps.climbing > 28, `ungdoms-climbing-loft ${caps.climbing} skal ligge langt over baseline 8`);
});

test("backfill: rytter uden type springes over for caps men får stadig progress", async () => {
  const supabase = makeMock([makeRow("r1", { rider: { primary_type: null } })]);
  const res = await runAbilityProgressCapsBackfill({ supabase, dryRun: false, log: noLog });
  assert.equal(res.capsSet, 0, "ingen type → ingen caps");
  assert.equal(res.skippedNoType, 1);
  assert.equal(res.progressSet, 1, "progress sættes uanset");
  const u = supabase.writes.updates[0];
  assert.equal(u.patch.ability_caps, undefined);
  assert.ok(u.patch.ability_progress);
});

test("backfill: tom kandidat-liste → no-op", async () => {
  const supabase = makeMock([]);
  const res = await runAbilityProgressCapsBackfill({ supabase, dryRun: false, log: noLog });
  assert.equal(res.candidates, 0);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0);
});
