// #5955 (#5984 Task 2): kontrakt-tests for den immutable regel-revision pr. loeb.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_RACE_RULES_REVISION,
  RACE_RULES_REVISIONS,
  RaceRulesRevisionError,
  isKnownRulesRevision,
  isMissingRulesRevisionColumnError,
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

test("new races are bound to orders_gc_v1 since the owner activated the package (2/10)", () => {
  assert.equal(CURRENT_RACE_RULES_REVISION, "orders_gc_v1");
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

test("#6084: orders_gc_v2 is a known revision but new races are still bound to orders_gc_v1", () => {
  assert.equal(isKnownRulesRevision("orders_gc_v2"), true);
  assert.deepEqual([...RACE_RULES_REVISIONS], ["legacy", "orders_gc_v1", "orders_gc_v2"]);
  // Aktivering er et separat ejer-go: CURRENT er uaendret.
  assert.equal(CURRENT_RACE_RULES_REVISION, "orders_gc_v1");
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

test("#6084: the migration allows exactly the known revisions in the CHECK constraint", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../database/2026-10-02-race-engine-rules-revision-v2.sql", import.meta.url), "utf8");
  const check = sql.match(/IN \(([^)]*)\)/);
  assert.ok(check, "CHECK-listen findes");
  const allowed = check[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(allowed, [...RACE_RULES_REVISIONS]);
});
