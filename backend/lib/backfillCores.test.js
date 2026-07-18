import test from "node:test";
import assert from "node:assert/strict";

import { runPhysiologyBackfill, runRiderTypesBackfill, runBaseValueBackfill, deriveForRiderIds } from "./backfillCores.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";
import { ABILITY_KEYS } from "./riderTypes.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// Én fleksibel in-memory mock der dækker alle tre kerners læse/skrive-flader:
//   reads:  from(t).select(...).eq?(...).order(...).range(from,to)  (fetchAllRows-kontrakt)
//   writes: from(t).upsert(rows, {onConflict})  |  from(t).update(patch).eq("id", id)
function makeMockSupabase(tables) {
  const writes = { upserts: [], updates: [] };
  function from(table) {
    const api = {
      select() { return api; },
      eq() { return api; },
      in() { return api; },
      order() { return api; },
      range() { return Promise.resolve({ data: tables[table] ?? [], error: null }); },
      // #2594: backfillCores.activeSeasonNumber slår aktiv sæson op via
      // .select("number").eq("status","active").maybeSingle() (deriveForRiderIds
      // + runBaseValueBackfill kalder begge denne). Ingen seeded "seasons"-tabel
      // i disse fixtures → fallback til sæson 1 (uændret eksisterende adfærd).
      maybeSingle() { return Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null }); },
      upsert(rows, opts) { writes.upserts.push({ table, rows, opts }); return Promise.resolve({ error: null }); },
      update(patch) {
        return {
          eq(col, val) {
            writes.updates.push({ table, patch, col, val });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return api;
  }
  return { from, writes };
}

function makeRider(id) {
  const rider = { id, height: 180, weight: 68, birthdate: "2000-01-01", potentiale: 4, primary_type: "climber", uci_points: 100, prize_earnings_bonus: 0 };
  for (const k of STAT_KEYS) rider[k] = 70;
  return rider;
}

function makeAbilities(rider_id) {
  const ab = { rider_id };
  for (const k of ABILITY_KEYS) ab[k] = 60;
  ab.climbing = 80; // gør typen ikke-degenereret
  return ab;
}

test("runPhysiologyBackfill (dryRun) beregner profiler+abilities uden writes", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await runPhysiologyBackfill(supabase, { dryRun: true });
  assert.equal(res.riders, 1);
  assert.equal(res.profiles, 1);
  assert.equal(res.abilities, 1);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.upserts.length, 0, "dry-run må ikke skrive");
});

test("runPhysiologyBackfill (apply) upserter physiology + abilities", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await runPhysiologyBackfill(supabase, { dryRun: false });
  assert.equal(res.written, 1);
  const tablesWritten = supabase.writes.upserts.map((u) => u.table).sort();
  assert.deepEqual(tablesWritten, ["rider_derived_abilities", "rider_physiology_profiles"]);
});

test("runRiderTypesBackfill (apply) skriver primary_type/secondary_type", async () => {
  const supabase = makeMockSupabase({ rider_derived_abilities: [makeAbilities("r1")] });
  const res = await runRiderTypesBackfill(supabase, { dryRun: false });
  assert.equal(res.riders, 1);
  assert.equal(res.written, 1);
  assert.equal(supabase.writes.updates.length, 1);
  const u = supabase.writes.updates[0];
  assert.equal(u.col, "id");
  assert.equal(u.val, "r1");
  assert.ok(u.patch.primary_type, "primary_type sat");
  assert.ok(u.patch.secondary_type, "secondary_type sat");
});

test("runRiderTypesBackfill (dryRun) skriver intet", async () => {
  const supabase = makeMockSupabase({ rider_derived_abilities: [makeAbilities("r1")] });
  const res = await runRiderTypesBackfill(supabase, { dryRun: true });
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

test("runBaseValueBackfill (apply) værdisætter kun ryttere med abilities", async () => {
  const supabase = makeMockSupabase({
    riders: [makeRider("r1"), { ...makeRider("r2"), primary_type: "sprinter" }],
    rider_derived_abilities: [makeAbilities("r1")], // kun r1 har abilities
  });
  const res = await runBaseValueBackfill(supabase, { dryRun: false });
  assert.equal(res.valued, 1);
  assert.equal(res.noAbilities, 1);
  assert.equal(supabase.writes.updates.length, 1);
  const u = supabase.writes.updates[0];
  assert.equal(u.val, "r1");
  assert.ok(Number.isInteger(u.patch.base_value), "base_value er heltal");
  assert.ok(u.patch.base_value >= 1);
});

test("runBaseValueBackfill (dryRun) skriver intet men rapporterer valued>0", async () => {
  const supabase = makeMockSupabase({
    riders: [makeRider("r1")],
    rider_derived_abilities: [makeAbilities("r1")],
  });
  const res = await runBaseValueBackfill(supabase, { dryRun: true });
  assert.equal(res.valued, 1);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

// ─── deriveForRiderIds (#1478): scoped afled-pipeline for nye ryttere ──────────

test("deriveForRiderIds (apply) upserter physiology + abilities OG sætter type + base_value", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1"), makeRider("r2")] });
  const res = await deriveForRiderIds(supabase, ["r1", "r2"], { dryRun: false });

  assert.equal(res.riders, 2);
  assert.equal(res.profiles, 2);
  assert.equal(res.abilities, 2);
  assert.equal(res.typed, 2, "begge ryttere får en type");
  assert.equal(res.valued, 2, "begge ryttere får base_value");

  // physiology + abilities upsertes
  const upsertTables = supabase.writes.upserts.map((u) => u.table).sort();
  assert.deepEqual(upsertTables, ["rider_derived_abilities", "rider_physiology_profiles"]);

  // riders opdateres med primary_type/secondary_type + base_value
  assert.equal(supabase.writes.updates.length, 2, "én rider-update pr. rytter");
  for (const u of supabase.writes.updates) {
    assert.equal(u.col, "id");
    assert.ok(u.patch.primary_type, "primary_type sat");
    assert.ok(u.patch.secondary_type, "secondary_type sat");
    assert.ok(Number.isInteger(u.patch.base_value), "base_value er heltal");
    assert.ok(u.patch.base_value >= 1);
  }
});

test("deriveForRiderIds (apply) skriver ability_caps + ability_progress for ALLE ryttere (#2001)", async () => {
  // makeRider er født 2000-01-01 → voksen (26 ved asOfYear 2026). Tidligere fik voksne
  // NULL caps her (kun akademi-alder fik youth-caps); #2001 wirer fulde caps + nul-progress.
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  await deriveForRiderIds(supabase, ["r1"], { dryRun: false });

  const abUpsert = supabase.writes.upserts.find((u) => u.table === "rider_derived_abilities");
  assert.ok(abUpsert, "abilities upsertes");
  const row = abUpsert.rows[0];

  // ability_caps: et objekt med en cap pr. synlig evne (voksen → buildCaps fra baseline).
  assert.ok(row.ability_caps && typeof row.ability_caps === "object", "ability_caps sat (ikke null)");
  for (const k of ABILITY_KEYS) {
    assert.ok(Number.isFinite(row.ability_caps[k]), `cap for ${k} er et tal`);
    assert.ok(row.ability_caps[k] >= 0 && row.ability_caps[k] <= 99, `cap for ${k} ∈ [0,99]`);
  }

  // ability_progress: nul-initialiseret over alle synlige evner (ikke null).
  assert.ok(row.ability_progress && typeof row.ability_progress === "object", "ability_progress sat (ikke null)");
  for (const k of ABILITY_KEYS) {
    assert.equal(row.ability_progress[k], 0, `progress for ${k} initialiseres til 0`);
  }
});

test("deriveForRiderIds (apply) bevarer progress men GENBEREGNER caps ved re-derive", async () => {
  // Heal-sweep kan re-derive en EKSISTERENDE rytter.
  //   progress = akkumuleret træning → må ALDRIG nulstilles (#2001 no-regress).
  //   caps     = afledt af potentiale + anlæg + current → skal genberegnes, ellers
  //              overlever en forkert/stale semantik for evigt. Netop "bevar hvis den
  //              findes" lod to uforenelige loft-semantikker fryse ned i prod (15/7).
  const staleCaps = { climbing: 95, sprint: 30 };
  const existingProgress = { climbing: 0.42 };
  const supabase = makeMockSupabase({
    riders: [makeRider("r1")],
    rider_derived_abilities: [{ rider_id: "r1", ability_caps: staleCaps, ability_progress: existingProgress }],
  });
  await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  const abUpsert = supabase.writes.upserts.find((u) => u.table === "rider_derived_abilities");
  const row = abUpsert.rows[0];
  assert.deepEqual(row.ability_progress, existingProgress, "akkumuleret progress bevares");
  assert.notDeepEqual(row.ability_caps, staleCaps, "stale caps overlever ikke en re-derive");
  assert.equal(Object.keys(row.ability_caps).length, VISIBLE_ABILITIES.length,
    "genberegnet loft dækker alle 15 synlige evner");
});

test("deriveForRiderIds (dryRun) skriver intet men rapporterer beregningerne", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await deriveForRiderIds(supabase, ["r1"], { dryRun: true });
  assert.equal(res.dryRun, true);
  assert.equal(res.profiles, 1);
  assert.equal(res.abilities, 1);
  assert.equal(supabase.writes.upserts.length, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

test("deriveForRiderIds (tom liste) er no-op", async () => {
  const supabase = makeMockSupabase({ riders: [] });
  const res = await deriveForRiderIds(supabase, [], { dryRun: false });
  assert.equal(res.riders, 0);
  assert.equal(supabase.writes.upserts.length, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

// ─── Kilde-guard (#1673): partiel derive må kaste, ikke strande tavst ──────────

test("deriveForRiderIds (apply) KASTER hvis en rytter ikke fik base_value (partiel derive)", async () => {
  // En brudt valuationModel (a=NaN) → predictBaseValue returnerer null for ALLE
  // ryttere → riderUpdates har ingen base_value. Det er præcis #1673's tavse
  // strandings-tilstand; guarden skal nu gøre den til en hård fejl ved kilden.
  const supabase = makeMockSupabase({ riders: [makeRider("r1"), makeRider("r2")] });
  await assert.rejects(
    () => deriveForRiderIds(supabase, ["r1", "r2"], {
      dryRun: false,
      valuationModel: { a: NaN, b: 1, offset: {} },
    }),
    /partielt derive.*uden base_value/,
    "guard skal kaste når base_value mangler for de inserterede id'er",
  );
});

test("deriveForRiderIds (apply) KASTER ikke når alle id'er fik fuld derive", async () => {
  // Sund model (default) → alle ryttere får abilities + base_value → ingen throw.
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  assert.equal(res.valued, 1, "sund derive fuldfører uden at kaste");
});

// computeYouthCapsForRider er fjernet (ejer 15/7): loftet er ikke længere alders-gatet,
// så en separat "kun for akademi-alder"-helper gav to semantikker at vælge imellem.
// buildCapsForRider dækker nu alle aldre — dens kontrakt testes i riderProgression.test.js.
