// #5955 (#5984 Task 2): kontrakt-tests for den immutable regel-revision pr. loeb.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_RACE_RULES_REVISION,
  RACE_RULES_REVISIONS,
  RaceRulesRevisionError,
  isKnownRulesRevision,
  isMissingRulesRevisionColumnError,
  isOrdersGcRulesRevision,
  isOrdersGcV2OrLater,
  isOrdersGcV3OrLater,
  isOfficialTimesV3OrLater,
  isOfficialTimesV4OrLater,
  isS5ProfilesV1OrLater,
  isOfficialTimesV5OrLater,
  surfaceRulesRevision,
  ordersGcGeneration,
  sharedTimeModelGeneration,
  preservesOfficialStageTimes,
  usesSharedGroupTime,
  raceHasStarted,
  resolveRaceRulesRevision,
} from "./raceEngineRulesRevision.ts";
import { bindRaceRulesRevision } from "./raceRunner.js";

const notStarted = { id: "race-a", stages_completed: 0 };
const started = { id: "race-a", stages_completed: 2 };

test("a new race is bound to the current revision on its first stage claim", () => {
  assert.equal(
    resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: null, currentRevision: "orders_gc_v1" }),
    "orders_gc_v1",
  );
});

test("a started race without a stored revision is legacy, never an automatic opt-in", () => {
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: true, storedRevision: null, currentRevision: "orders_gc_v1" }),
    "legacy",
  );
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: undefined, currentRevision: "orders_gc_v1" }),
    "legacy",
  );
});

test("a later stage or a non-claim run without a stored revision is legacy", () => {
  assert.equal(
    resolveRaceRulesRevision({ race: notStarted, firstStageClaim: false, storedRevision: null, currentRevision: "orders_gc_v1" }),
    "legacy",
  );
});

test("retry and restart reuse the stored revision whatever the current revision is", () => {
  for (const current of ["legacy", "orders_gc_v1"]) {
    assert.equal(
      resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: "orders_gc_v1", currentRevision: current }),
      "orders_gc_v1",
    );
    assert.equal(
      resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "legacy", currentRevision: current }),
      "legacy",
    );
  }
});

test("an unknown stored revision is an observable error, never the newest rules", () => {
  assert.throws(
    () => resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "orders_gc_v9", currentRevision: "orders_gc_v1" }),
    RaceRulesRevisionError,
  );
  assert.throws(
    () => resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: 4, currentRevision: "orders_gc_v1" }),
    RaceRulesRevisionError,
  );
});

test("an unknown current revision is never written to a new race", () => {
  assert.throws(
    () => resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: null, currentRevision: "next" }),
    RaceRulesRevisionError,
  );
});

test("engine_version 4 alone does not select the new policy", () => {
  const v4Race = { id: "race-a", stages_completed: 1, engine_version: 4 };
  assert.equal(
    resolveRaceRulesRevision({ race: v4Race, firstStageClaim: false, storedRevision: null, currentRevision: "orders_gc_v1" }),
    "legacy",
  );
});

test("an unreadable stages_completed counts as started", () => {
  assert.equal(raceHasStarted({ stages_completed: "x" }), true);
  assert.equal(raceHasStarted({ stages_completed: -1 }), true);
  assert.equal(raceHasStarted({ stages_completed: null }), false);
  assert.equal(raceHasStarted({ stages_completed: "0" }), false);
});

test("new races are bound to s5_profiles_v1 from the owner's 'taend' (#6369)", () => {
  assert.equal(CURRENT_RACE_RULES_REVISION, "s5_profiles_v1");
});

test("only a missing-column error degrades to legacy", () => {
  assert.equal(isMissingRulesRevisionColumnError({ code: "42703", message: 'column races.engine_rules_revision does not exist' }), true);
  assert.equal(isMissingRulesRevisionColumnError({ code: "PGRST204", message: "Could not find the 'engine_rules_revision' column of 'races'" }), true);
  assert.equal(isMissingRulesRevisionColumnError({ code: "23514", message: 'new row violates check constraint "races_engine_rules_revision_check"' }), false);
  assert.equal(isMissingRulesRevisionColumnError({ code: "57014", message: "canceling statement due to statement timeout" }), false);
  assert.equal(isMissingRulesRevisionColumnError(null), false);
});

// ── bindRaceRulesRevision: IO-kanten mod en minimal races-fake ────────────────

type RaceRow = { engine_rules_revision?: string | null; stages_completed: number };

function fakeSupabase(row: RaceRow | null, opts: { missingColumn?: boolean; onUpdate?: (row: RaceRow) => void } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const client = {
    writes,
    from(table: string) {
      assert.equal(table, "races");
      const filters: Array<[string, string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const missing = { code: "42703", message: "column races.engine_rules_revision does not exist" };
      const builder = {
        select() { return builder; },
        update(p: Record<string, unknown>) { patch = p; return builder; },
        eq(col: string, val: unknown) { filters.push(["eq", col, val]); return builder; },
        is(col: string, val: unknown) { filters.push(["is", col, val]); return builder; },
        maybeSingle() {
          if (opts.missingColumn) return Promise.resolve({ data: null, error: missing });
          return Promise.resolve({ data: row ? { ...row } : null, error: null });
        },
        then(resolve: (v: unknown) => void) {
          // update-kaedens await
          if (opts.missingColumn) return resolve({ data: null, error: missing });
          opts.onUpdate?.(row as RaceRow);
          // Fake'en har én raekke; id-filteret er altid opfyldt.
          const matches = row && filters.every(([, col, val]) => col === "id" || ((row as Record<string, unknown>)[col] ?? null) === val);
          if (matches && patch) {
            Object.assign(row as RaceRow, patch);
            writes.push(patch);
          }
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return client;
}

test("bind: first claim of a new race writes the current revision once", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 0 };
  const supabase = fakeSupabase(row);
  const revision = await bindRaceRulesRevision({ supabase, race: { id: "r1" }, firstStageClaim: true, currentRevision: "orders_gc_v1" });
  assert.equal(revision, "orders_gc_v1");
  assert.deepEqual(supabase.writes, [{ engine_rules_revision: "orders_gc_v1" }]);
  // Retry: samme claim igen, nu med gemt vaerdi — intet nyt skrives, selv hvis
  // den aktuelle revision er skiftet imens.
  const again = await bindRaceRulesRevision({ supabase, race: { id: "r1" }, firstStageClaim: true, currentRevision: "legacy" });
  assert.equal(again, "orders_gc_v1");
  assert.equal(supabase.writes.length, 1);
});

test("bind: a concurrent first claim that already won keeps the winner's value", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 0 };
  // Den anden claim skriver mellem vores laesning og vores betingede UPDATE.
  const supabase = fakeSupabase(row, { onUpdate: (r) => { if (r.engine_rules_revision === null) r.engine_rules_revision = "legacy"; } });
  const revision = await bindRaceRulesRevision({ supabase, race: { id: "r1" }, firstStageClaim: true, currentRevision: "orders_gc_v1" });
  assert.equal(revision, "legacy");
  assert.equal(supabase.writes.length, 0);
});

test("bind: a race that completed a stage meanwhile stays legacy", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 0 };
  const supabase = fakeSupabase(row, { onUpdate: (r) => { r.stages_completed = 1; } });
  const revision = await bindRaceRulesRevision({ supabase, race: { id: "r1" }, firstStageClaim: true, currentRevision: "orders_gc_v1" });
  assert.equal(revision, "legacy");
  assert.equal(supabase.writes.length, 0);
});

test("bind: a started race with null stays legacy and nothing is written", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 3 };
  const supabase = fakeSupabase(row);
  const revision = await bindRaceRulesRevision({ supabase, race: { id: "r1" }, firstStageClaim: true, currentRevision: "orders_gc_v1" });
  assert.equal(revision, "legacy");
  assert.equal(supabase.writes.length, 0);
});

test("bind: dry run previews without writing", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 0 };
  const supabase = fakeSupabase(row);
  const revision = await bindRaceRulesRevision({ supabase, race: { id: "r1" }, firstStageClaim: true, dryRun: true, currentRevision: "orders_gc_v1" });
  assert.equal(revision, "orders_gc_v1");
  assert.equal(supabase.writes.length, 0);
});

test("bind: before the migration is applied the race runs legacy", async () => {
  const supabase = fakeSupabase(null, { missingColumn: true });
  const revision = await bindRaceRulesRevision({ supabase, race: { id: "r1" }, firstStageClaim: true, currentRevision: "orders_gc_v1" });
  assert.equal(revision, "legacy");
});

test("bind: an unknown stored revision fails the run instead of choosing rules", async () => {
  const row: RaceRow = { engine_rules_revision: "orders_gc_v9", stages_completed: 1 };
  await assert.rejects(
    bindRaceRulesRevision({ supabase: fakeSupabase(row), race: { id: "r1" }, firstStageClaim: false, currentRevision: "orders_gc_v1" }),
    RaceRulesRevisionError,
  );
});

// ── Broen: StageInput.rules_revision ───────────────────────────────────────

async function bridgeInput(rulesRevision?: unknown) {
  const { buildV4StageInput } = await import("./raceEngineV4Bridge.js");
  const [entrants, route, orders] = await Promise.all([
    import("./engine/v4/adapters/entrantAdapter.ts"),
    import("./engine/v4/adapters/routeAdapter.ts"),
    import("./engine/v4/orders/teamOrdersAdapter.ts"),
  ]);
  const field = Array.from({ length: 6 }, (_, i) => ({ rider_id: `r${i}`, team_id: `t${i % 2}`, race_role: i === 0 ? "hunter" : "helper", abilities: { tempo: 40 + i }, fatigue: 0 }));
  const args: Record<string, unknown> = {
    modules: { entrants, route, orders, tuning: { RACE_V4_TUNING: {} } },
    entrants: field,
    stageProfile: { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint", distance_km: 150 },
    seedString: "race:5955:1",
    stageNumber: 1,
  };
  if (rulesRevision !== undefined) args.rulesRevision = rulesRevision;
  return buildV4StageInput(args as never);
}

test("bridge: legacy leaves StageInput unchanged, orders_gc_v1 is carried, unknown fails", async () => {
  const plain = await bridgeInput();
  assert.equal("rules_revision" in plain, false);
  assert.deepEqual(await bridgeInput("legacy"), plain);
  assert.equal((await bridgeInput("orders_gc_v1")).rules_revision, "orders_gc_v1");
  await assert.rejects(bridgeInput("orders_gc_v9"));
});

// ── #6084: orders_gc_v2 (orders_gc_v1 + bjergselektionen) ─────────────────────

test("#6084: orders_gc_v2 is a known revision and the current one for new races", () => {
  assert.equal(isKnownRulesRevision("orders_gc_v2"), true);
  assert.deepEqual([...RACE_RULES_REVISIONS], ["legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2", "official_times_v3", "official_times_v4", "s5_profiles_v1", "official_times_v5"]);
  // #6369: nye loeb bindes til s5_profiles_v1; loeb bundet til v2/v3/v4/v5 beholder deres.
  assert.equal(CURRENT_RACE_RULES_REVISION, "s5_profiles_v1");
});

test("#6084: a race stored on orders_gc_v2 keeps it; a new race binds to v2 only when v2 is current", () => {
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "orders_gc_v2", currentRevision: "orders_gc_v1" }),
    "orders_gc_v2",
  );
  assert.equal(
    resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: null, currentRevision: "orders_gc_v2" }),
    "orders_gc_v2",
  );
  // En orders_gc_v1-race forbliver v1, selv naar v2 bliver den aktuelle.
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "orders_gc_v1", currentRevision: "orders_gc_v2" }),
    "orders_gc_v1",
  );
});

test("#6084: the bridge carries orders_gc_v2 with the same GC context as orders_gc_v1", async () => {
  const v1 = await bridgeInput("orders_gc_v1");
  const v2 = await bridgeInput("orders_gc_v2");
  assert.equal(v2.rules_revision, "orders_gc_v2");
  assert.deepEqual({ ...v2, rules_revision: "orders_gc_v1" }, v1);
});

test("#6284/#6199: the v3 migration excludes official_times; the official-times migration allows every known revision", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../database/2026-10-05-race-engine-rules-revision-v3.sql", import.meta.url), "utf8");
  const check = sql.match(/IN \(([^)]*)\)/);
  assert.ok(check, "CHECK-listen findes");
  const allowed = check[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(allowed, RACE_RULES_REVISIONS.filter((revision) => !revision.startsWith("official_times_") && revision !== "s5_profiles_v1"));
  const migration = readFileSync(new URL("../../database/2026-10-08-race-engine-rules-revision-official-times.sql", import.meta.url), "utf8");
  const migrated = migration.match(/IN\s*\(([^)]*)\)/);
  assert.ok(migrated);
  // #6200: official_times_v3 got its own migration (#6452); #6464: official_times_v4
  // is switched off and needs its own migration in the flip PR.
  assert.deepEqual(migrated[1].split(",").map((s) => s.trim().replace(/'/g, "")), RACE_RULES_REVISIONS.filter((revision) => revision !== "official_times_v3" && revision !== "official_times_v4" && revision !== "s5_profiles_v1" && revision !== "official_times_v5"));
  // Idempotent and additive: the constraint is replaced, never a row update.
  assert.match(migration, /DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
});

// ── #6187: orders_gc_v3 (orders_gc_v2 + eget hold jagter aldrig sine egne) ──────

test("#6187: orders_gc_v3 is known but never current (official_times_v2 includes it)", () => {
  assert.equal(isKnownRulesRevision("orders_gc_v3"), true);
  assert.notEqual(CURRENT_RACE_RULES_REVISION, "orders_gc_v3");
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "orders_gc_v3", currentRevision: "orders_gc_v2" }),
    "orders_gc_v3",
  );
});

test("#6187/#6284: orders_gc is a lineage; official times branches from v2 without v3 mechanics", () => {
  assert.deepEqual(RACE_RULES_REVISIONS.map(ordersGcGeneration), [0, 1, 2, 3, 2, 3, 3, 3, 3, 3]);
  assert.deepEqual(RACE_RULES_REVISIONS.map(isOrdersGcRulesRevision), [false, true, true, true, true, true, true, true, true, true]);
  assert.deepEqual(RACE_RULES_REVISIONS.map(isOrdersGcV2OrLater), [false, false, true, true, true, true, true, true, true, true]);
  assert.deepEqual(RACE_RULES_REVISIONS.map(isOrdersGcV3OrLater), [false, false, false, true, false, true, true, true, true, true]);
  for (const unknown of [null, undefined, "", "orders_gc_v9", 3]) {
    assert.equal(ordersGcGeneration(unknown), 0);
    assert.equal(isOrdersGcRulesRevision(unknown), false);
  }
});

test("#6187: the bridge carries orders_gc_v3 with the same input as orders_gc_v2", async () => {
  const v2 = await bridgeInput("orders_gc_v2");
  const v3 = await bridgeInput("orders_gc_v3");
  assert.equal(v3.rules_revision, "orders_gc_v3");
  assert.deepEqual({ ...v3, rules_revision: "orders_gc_v2" }, v2);
});

// ── #6199 (owner 8/10): official_times_v2 = orders_gc_v3 + the shared time model ──

test("#6199: official_times_v2 is the full v3 lineage plus official times and the shared group clock", () => {
  const revision = "official_times_v2";
  assert.equal(isKnownRulesRevision(revision), true);
  assert.equal(ordersGcGeneration(revision), 3);
  assert.equal(isOrdersGcRulesRevision(revision), true);
  assert.equal(isOrdersGcV2OrLater(revision), true);
  assert.equal(isOrdersGcV3OrLater(revision), true);
  assert.equal(preservesOfficialStageTimes(revision), true);
  assert.equal(usesSharedGroupTime(revision), true);
});

test("#6199: official times and the shared clock belong to exactly the official-times revisions", () => {
  assert.deepEqual(RACE_RULES_REVISIONS.map(preservesOfficialStageTimes), [false, false, false, false, true, true, true, true, true, true]);
  assert.deepEqual(RACE_RULES_REVISIONS.map(usesSharedGroupTime), [false, false, false, false, true, true, true, true, true, true]);
  for (const unknown of [null, undefined, "", "official_times_v9", "orders_gc_v3 ", 3]) {
    assert.equal(preservesOfficialStageTimes(unknown), false);
    assert.equal(usesSharedGroupTime(unknown), false);
  }
});

test("#6199: a race pinned to orders_gc_v2 keeps it under the current revision", () => {
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "orders_gc_v2", currentRevision: CURRENT_RACE_RULES_REVISION }),
    "orders_gc_v2",
  );
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "official_times_v2", currentRevision: "orders_gc_v2" }),
    "official_times_v2",
  );
  assert.equal(
    resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: null, currentRevision: "official_times_v2" }),
    "official_times_v2",
  );
});

// ── #6452: the flip to official_times_v3 (merged only on the owner's "taend") ──

test("#6452: the v3 migration allows every known revision, additively and idempotently", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(new URL("../../database/2026-10-11-race-engine-rules-revision-official-times-v3.sql", import.meta.url), "utf8");
  const check = migration.match(/IN\s*\(([^)]*)\)/);
  assert.ok(check, "CHECK-listen findes");
  // #6464: official_times_v4 came later, with its own migration (test below).
  assert.deepEqual(check[1].split(",").map((s) => s.trim().replace(/'/g, "")), RACE_RULES_REVISIONS.filter((revision) => revision !== "official_times_v4" && revision !== "s5_profiles_v1" && revision !== "official_times_v5"));
  assert.match(migration, /DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
});

test("#6464: the v4 migration allows every revision known at the v4 taend, additively and idempotently", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(new URL("../../database/2026-10-12-race-engine-rules-revision-official-times-v4.sql", import.meta.url), "utf8");
  const check = migration.match(/IN\s*\(([^)]*)\)/);
  assert.ok(check, "CHECK-listen findes");
  // #6369: s5_profiles_v1 is switched off; its CHECK extension belongs to the flip PR.
  assert.deepEqual(check[1].split(",").map((s) => s.trim().replace(/'/g, "")), RACE_RULES_REVISIONS.filter((revision) => revision !== "s5_profiles_v1" && revision !== "official_times_v5"));
  assert.match(migration, /DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check/);
  assert.match(migration, /lock_timeout/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
  // v4 itself (current until #6462) stays legal; the current revision is checked against the v5 migration.
  assert.ok(check[1].includes("'official_times_v4'"));
});

test("#6452: official_times_v3 keeps the full v3 lineage, official times and the shared clock", () => {
  const revision = "official_times_v3";
  assert.equal(ordersGcGeneration(revision), 3);
  assert.equal(isOrdersGcV3OrLater(revision), true);
  assert.equal(preservesOfficialStageTimes(revision), true);
  assert.equal(usesSharedGroupTime(revision), true);
});

test("#6369 bind: a race with engine_rules_revision = null binds to s5_profiles_v1 on its first stage", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 0 };
  const supabase = fakeSupabase(row);
  // Default currentRevision: exactly what raceRunner uses in production.
  const revision = await bindRaceRulesRevision({ supabase, race: { id: "new" }, firstStageClaim: true });
  assert.equal(revision, "s5_profiles_v1");
  assert.deepEqual(supabase.writes, [{ engine_rules_revision: "s5_profiles_v1" }]);
  assert.equal(row.engine_rules_revision, "s5_profiles_v1");
});

test("#6369 bind: a race already bound to official_times_v5 stays on v5 and nothing is written", async () => {
  for (const firstStageClaim of [true, false]) {
    for (const stagesCompleted of [0, 3]) {
      const row: RaceRow = { engine_rules_revision: "official_times_v5", stages_completed: stagesCompleted };
      const supabase = fakeSupabase(row);
      const revision = await bindRaceRulesRevision({ supabase, race: { id: "running" }, firstStageClaim });
      assert.equal(revision, "official_times_v5");
      assert.equal(supabase.writes.length, 0);
      assert.equal(row.engine_rules_revision, "official_times_v5");
    }
  }
});

test("#6462 bind: a race already bound to official_times_v4 stays on v4 and nothing is written", async () => {
  for (const firstStageClaim of [true, false]) {
    for (const stagesCompleted of [0, 3]) {
      const row: RaceRow = { engine_rules_revision: "official_times_v4", stages_completed: stagesCompleted };
      const supabase = fakeSupabase(row);
      const revision = await bindRaceRulesRevision({ supabase, race: { id: "running" }, firstStageClaim });
      assert.equal(revision, "official_times_v4");
      assert.equal(supabase.writes.length, 0);
      assert.equal(row.engine_rules_revision, "official_times_v4");
    }
  }
});

test("#6464 bind: a race already bound to official_times_v3 (the Tour) stays on v3 and nothing is written", async () => {
  for (const firstStageClaim of [true, false]) {
    const row: RaceRow = { engine_rules_revision: "official_times_v3", stages_completed: 3 };
    const supabase = fakeSupabase(row);
    const revision = await bindRaceRulesRevision({ supabase, race: { id: "tour" }, firstStageClaim });
    assert.equal(revision, "official_times_v3");
    assert.equal(supabase.writes.length, 0);
    assert.equal(row.engine_rules_revision, "official_times_v3");
  }
});

test("#6452 bind: a race already bound to official_times_v2 stays on v2 and nothing is written", async () => {
  for (const firstStageClaim of [true, false]) {
    for (const stagesCompleted of [0, 4]) {
      const row: RaceRow = { engine_rules_revision: "official_times_v2", stages_completed: stagesCompleted };
      const supabase = fakeSupabase(row);
      const revision = await bindRaceRulesRevision({ supabase, race: { id: "running" }, firstStageClaim });
      assert.equal(revision, "official_times_v2");
      assert.equal(supabase.writes.length, 0);
      assert.equal(row.engine_rules_revision, "official_times_v2");
    }
  }
});

test("#6452 bind: a started race with null stays legacy, never an opt-in to v3", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 2 };
  const supabase = fakeSupabase(row);
  assert.equal(await bindRaceRulesRevision({ supabase, race: { id: "old" }, firstStageClaim: true }), "legacy");
  assert.equal(supabase.writes.length, 0);
});

test("#6199: the bridge carries official_times_v2 with the same input as orders_gc_v3", async () => {
  const v3 = await bridgeInput("orders_gc_v3");
  const official = await bridgeInput("official_times_v2");
  assert.equal(official.rules_revision, "official_times_v2");
  assert.deepEqual({ ...official, rules_revision: "orders_gc_v3" }, v3);
});

// ── #6464 + #6456: official_times_v4 (slukket, mountain gaps in every division) ──

test("#6464: official_times_v4 is known, was current from its taend until #6462, and keeps the whole official_times_v3 lineage", () => {
  const revision = "official_times_v4";
  assert.equal(isKnownRulesRevision(revision), true);
  assert.notEqual(CURRENT_RACE_RULES_REVISION, revision, "official_times_v5 is current since #6462; races bound to v4 keep it");
  assert.equal(ordersGcGeneration(revision), 3);
  assert.equal(isOrdersGcV3OrLater(revision), true);
  assert.equal(preservesOfficialStageTimes(revision), true);
  assert.equal(usesSharedGroupTime(revision), true);
  assert.equal(sharedTimeModelGeneration(revision), 3);
  assert.equal(isOfficialTimesV3OrLater(revision), true);
  assert.equal(isOfficialTimesV4OrLater(revision), true);
  for (const older of ["legacy", "orders_gc_v3", "official_times_v2", "official_times_v3", null, "official_times_v9"]) {
    assert.equal(isOfficialTimesV4OrLater(older), false);
  }
  // A race bound to v4 keeps it; a new race still binds to the current revision.
  assert.equal(resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: revision, currentRevision: CURRENT_RACE_RULES_REVISION }), revision);
  assert.equal(resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: null, currentRevision: CURRENT_RACE_RULES_REVISION }), CURRENT_RACE_RULES_REVISION);
});

test("#6464: the bridge carries official_times_v4 with the same input as official_times_v3", async () => {
  const v3 = await bridgeInput("official_times_v3");
  const v4 = await bridgeInput("official_times_v4");
  assert.equal(v4.rules_revision, "official_times_v4");
  assert.deepEqual({ ...v4, rules_revision: "official_times_v3" }, v3);
});

// ── #6369: s5_profiles_v1 (S5-etapeprofiler), aktuel fra ejerens "taend" ─────────

test("#6369: s5_profiles_v1 is known, current since the owner's taend, and inherits the whole official_times_v4 package", () => {
  const revision = "s5_profiles_v1";
  assert.equal(isKnownRulesRevision(revision), true);
  assert.equal(CURRENT_RACE_RULES_REVISION, revision, "nye loeb bindes til s5_profiles_v1 fra ejerens taend (#6369)");
  assert.equal(ordersGcGeneration(revision), ordersGcGeneration("official_times_v4"));
  assert.equal(sharedTimeModelGeneration(revision), 3);
  assert.equal(isOfficialTimesV3OrLater(revision), true);
  assert.equal(isOfficialTimesV4OrLater(revision), true);
  assert.equal(preservesOfficialStageTimes(revision), true);
  assert.equal(usesSharedGroupTime(revision), true);
});

test("#6369: isS5ProfilesV1OrLater is true for exactly s5_profiles_v1", () => {
  assert.deepEqual(RACE_RULES_REVISIONS.map(isS5ProfilesV1OrLater), [false, false, false, false, false, false, false, false, true, false]);
  for (const unknown of [null, undefined, "", "s5_profiles_v2", "s5_profiles_v1 ", 3]) {
    assert.equal(isS5ProfilesV1OrLater(unknown), false);
  }
});

test("#6369: a new race binds to s5_profiles_v1 by default; a stored one keeps it", async () => {
  const row: RaceRow = { engine_rules_revision: null, stages_completed: 0 };
  const revision = await bindRaceRulesRevision({ supabase: fakeSupabase(row), race: { id: "new" }, firstStageClaim: true });
  assert.equal(revision, "s5_profiles_v1");
  assert.equal(
    resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "s5_profiles_v1", currentRevision: CURRENT_RACE_RULES_REVISION }),
    "s5_profiles_v1",
  );
});

const S5_MIGRATION = "2026-10-16-6369-engine-rules-revision-s5.sql";
const V5_MIGRATION = "2026-10-16-6462-engine-rules-revision-official-times-v5.sql";

// #6369 ordering gate: the migration lands in its own PR (chore/6369-s5-revision-check-migration)
// and must be on main (and applied) before the ignition PR merges. Until main carries it,
// these tests fail on purpose, so the ignition PR cannot go green ahead of its migration.
async function readS5Migration(): Promise<string> {
  const { existsSync, readFileSync } = await import("node:fs");
  const url = new URL(`../../database/${S5_MIGRATION}`, import.meta.url);
  assert.ok(
    existsSync(url),
    `${S5_MIGRATION} is missing: merge the migration PR (chore/6369-s5-revision-check-migration) to main, apply it, then merge main into this branch`,
  );
  return readFileSync(url, "utf8");
}

test("#6369: the S5 migration allows every revision known before official_times_v5, additively and idempotently", async () => {
  const migration = await readS5Migration();
  const check = migration.match(/IN\s*\(([^)]*)\)/);
  assert.ok(check, "CHECK-listen findes");
  // #6462: official_times_v5 came later, with its own migration (test below).
  assert.deepEqual(check[1].split(",").map((s) => s.trim().replace(/'/g, "")), RACE_RULES_REVISIONS.filter((revision) => revision !== "official_times_v5"));
  assert.match(migration, /DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check/);
  assert.match(migration, /lock_timeout/);
  // Hot table: add NOT VALID (no scan under ACCESS EXCLUSIVE), validate as its own statement.
  assert.match(migration, /\)\)\s*NOT VALID;/);
  assert.match(migration, /COMMIT;\s*(?:--[^\n]*\n\s*)*ALTER TABLE public\.races\s+VALIDATE CONSTRAINT races_engine_rules_revision_check;/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
  // official_times_v4 (current when S5 was added) stays legal; the current revision is checked against the v5 migration.
  assert.ok(check[1].includes("'official_times_v4'"));
});

test("#6369: only the S5 migration makes s5_profiles_v1 legal (no older revision migration was edited)", async () => {
  await readS5Migration();
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../../database/", import.meta.url);
  const legal: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(file, dir), "utf8");
    if (!/races_engine_rules_revision_check/.test(sql)) continue;
    if (/'s5_profiles_v1'/.test(sql)) legal.push(file);
  }
  // #6462: the official_times_v5 migration keeps every existing value, s5_profiles_v1 included.
  assert.deepEqual(legal.sort(), [S5_MIGRATION, V5_MIGRATION].sort());
});

test("#6369: the bridge carries s5_profiles_v1 with the same input as official_times_v4", async () => {
  const v4 = await bridgeInput("official_times_v4");
  const s5 = await bridgeInput("s5_profiles_v1");
  assert.equal(s5.rules_revision, "s5_profiles_v1");
  assert.deepEqual({ ...s5, rules_revision: "official_times_v4" }, v4);
});

// ── #6462 (ejer 16/10): official_times_v5 = official_times_v4 + togreglen (aktuel til S5-taend) ──

test("#6462: official_times_v5 is known, was current from its taend until #6369, and inherits the whole official_times_v4 package", () => {
  const revision = "official_times_v5";
  assert.equal(isKnownRulesRevision(revision), true);
  assert.notEqual(CURRENT_RACE_RULES_REVISION, revision, "s5_profiles_v1 is current since #6369; races bound to v5 keep it");
  assert.equal(ordersGcGeneration(revision), ordersGcGeneration("official_times_v4"));
  assert.equal(sharedTimeModelGeneration(revision), 3);
  assert.equal(isOfficialTimesV3OrLater(revision), true);
  assert.equal(isOfficialTimesV4OrLater(revision), true);
  assert.equal(preservesOfficialStageTimes(revision), true);
  assert.equal(usesSharedGroupTime(revision), true);
  assert.equal(isS5ProfilesV1OrLater(revision), false, "v5 baerer ikke S5-motoren");
});

test("#6462: isOfficialTimesV5OrLater is true for exactly official_times_v5 and s5_profiles_v1", () => {
  assert.deepEqual(RACE_RULES_REVISIONS.map(isOfficialTimesV5OrLater), [false, false, false, false, false, false, false, false, true, true]);
  for (const unknown of [null, undefined, "", "official_times_v6", "official_times_v5 ", 5]) {
    assert.equal(isOfficialTimesV5OrLater(unknown), false);
  }
});

test("#6462: a race binds to official_times_v5 on its first claim only once it is current; a stored one keeps it", () => {
  assert.equal(resolveRaceRulesRevision({ race: notStarted, firstStageClaim: true, storedRevision: null, currentRevision: "official_times_v5" }), "official_times_v5");
  assert.equal(resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "official_times_v5", currentRevision: "official_times_v4" }), "official_times_v5");
  // Et loeb der allerede er bundet til official_times_v4 faerdiggoeres paa den, ogsaa naar v5 bliver aktuel.
  assert.equal(resolveRaceRulesRevision({ race: started, firstStageClaim: false, storedRevision: "official_times_v4", currentRevision: "official_times_v5" }), "official_times_v4");
});

test("#6462: surfaceRulesRevision shows what the engine will bind (stored, else current for a race not started, else legacy)", () => {
  // Ikke-startet loeb uden gemt revision: fladen viser den aktuelle (motoren binder den ved foerste claim).
  assert.equal(surfaceRulesRevision({ race: notStarted, storedRevision: null }), CURRENT_RACE_RULES_REVISION);
  assert.equal(surfaceRulesRevision({ race: { id: "x", stages_completed: null }, storedRevision: undefined, currentRevision: "official_times_v5" }), "official_times_v5");
  // En gemt revision vinder altid.
  assert.equal(surfaceRulesRevision({ race: notStarted, storedRevision: "official_times_v3", currentRevision: "official_times_v5" }), "official_times_v3");
  assert.equal(surfaceRulesRevision({ race: started, storedRevision: "official_times_v5" }), "official_times_v5");
  // Startet uden gemt revision = legacy; ukendt gemt vaerdi eller ukendt aktuel = legacy, aldrig nyeste regler.
  assert.equal(surfaceRulesRevision({ race: started, storedRevision: null, currentRevision: "official_times_v5" }), "legacy");
  assert.equal(surfaceRulesRevision({ race: notStarted, storedRevision: "official_times_v9" }), "legacy");
  assert.equal(surfaceRulesRevision({ race: notStarted, storedRevision: null, currentRevision: "official_times_v9" }), "legacy");
});

test("#6462: the bridge carries official_times_v5 with the same input as official_times_v4", async () => {
  const v4 = await bridgeInput("official_times_v4");
  const v5 = await bridgeInput("official_times_v5");
  assert.equal(v5.rules_revision, "official_times_v5");
  assert.deepEqual({ ...v5, rules_revision: "official_times_v4" }, v4);
});

test("#6462: the official_times_v5 migration allows every known revision incl. the current one, additively, idempotently, NOT VALID + VALIDATE", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(new URL(`../../database/${V5_MIGRATION}`, import.meta.url), "utf8");
  const check = migration.match(/IN\s*\(([^)]*)\)/);
  assert.ok(check, "CHECK-listen findes");
  assert.deepEqual(check[1].split(",").map((s) => s.trim().replace(/'/g, "")), [...RACE_RULES_REVISIONS]);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS races_engine_rules_revision_check/);
  assert.match(migration, /lock_timeout/);
  assert.match(migration, /\)\)\s*NOT VALID;/);
  assert.match(migration, /COMMIT;\s*(?:--[^\n]*\n\s*)*ALTER TABLE public\.races\s+VALIDATE CONSTRAINT races_engine_rules_revision_check;/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
  // The current revision must be a value the constraint allows, or the first claim fails on CHECK.
  assert.ok(check[1].includes(`'${CURRENT_RACE_RULES_REVISION}'`));
});

test("#6462: only the official_times_v5 migration makes official_times_v5 legal", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../../database/", import.meta.url);
  const legal: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(file, dir), "utf8");
    if (!/races_engine_rules_revision_check/.test(sql)) continue;
    if (/'official_times_v5'/.test(sql)) legal.push(file);
  }
  assert.deepEqual(legal, [V5_MIGRATION]);
});
