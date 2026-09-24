// #4848 (gate G9): trænings-slot-vagtens I/O-lag på løbsdags-kadencen.
//
// Den rene gate er testet i trainingSlotHealth.test.js. Her testes WIRINGEN: at
// flag off er bit-identisk (ingen tick-opslag, samme alarm), at flag on omregner de
// faktisk kørte løbsdags-ticks til kalenderdags-ækvivalenter, og at et fejlet
// tick-opslag dropper spring-gaten i stedet for at fyre en falsk alarm.
import test from "node:test";
import assert from "node:assert/strict";

import { runTrainingSlotHealthWatch, resolveTrainingDaysSincePrevious } from "./trainingSlotHealthWatch.js";
import { TRAINING_SLOT_HEALTH_TUNING, TOTAL_FOCUS_KEY } from "./trainingSlotHealth.js";

// ── Mini in-memory Supabase (kun de kald vagten bruger) ───────────────────────
function makeSupabase(tables, { failTables = new Set() } = {}) {
  const calls = [];
  const upserts = [];
  const supabase = {
    calls,
    upserts,
    from(table) {
      const q = { table, filters: [], range: null, limit: null, order: null };
      calls.push(q);
      const run = () => {
        if (failTables.has(table)) return { data: null, error: { message: `${table} unavailable` } };
        let rows = [...(tables[table] ?? [])];
        for (const [op, col, val] of q.filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === val);
          else if (op === "in") rows = rows.filter((r) => val.includes(r[col]));
          else if (op === "lt") rows = rows.filter((r) => r[col] < val);
          else if (op === "gt") rows = rows.filter((r) => r[col] > val);
          else if (op === "lte") rows = rows.filter((r) => r[col] <= val);
          else if (op === "notnull") rows = rows.filter((r) => r[col] != null);
        }
        if (q.order) {
          const [col, asc] = q.order;
          rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
        }
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        if (q.limit != null) rows = rows.slice(0, q.limit);
        return { data: rows, error: null };
      };
      const chain = {
        select() { return chain; },
        eq(col, val) { q.filters.push(["eq", col, val]); return chain; },
        in(col, val) { q.filters.push(["in", col, val]); return chain; },
        lt(col, val) { q.filters.push(["lt", col, val]); return chain; },
        gt(col, val) { q.filters.push(["gt", col, val]); return chain; },
        lte(col, val) { q.filters.push(["lte", col, val]); return chain; },
        not(col, op, val) {
          assert.equal(op, "is");
          assert.equal(val, null);
          q.filters.push(["notnull", col]);
          return chain;
        },
        order(col, opts = {}) { q.order = [col, opts.ascending !== false]; return chain; },
        range(from, to) { q.range = [from, to]; return chain; },
        limit(n) { q.limit = n; return chain; },
        maybeSingle() {
          const { data, error } = run();
          return Promise.resolve({ data: data?.[0] ?? null, error });
        },
        upsert(payload) {
          upserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return chain;
    },
  };
  return supabase;
}

// En population hvor 5 % af rytterne står på et helt dødt fokus — UNDER
// andels-loftet, så kun spring-gaten kan fyre (samme konstruktion som prod 11/8).
const J = TRAINING_SLOT_HEALTH_TUNING.deadJumpAbsolute;
const DEAD = 20;
const OPEN = 380;
const CAPS = { climbing: 70, punch: 62, tempo: 58 };
function population() {
  const riders = [];
  const plans = [];
  const abilities = [];
  for (let i = 0; i < DEAD + OPEN; i++) {
    const id = `r${String(i).padStart(4, "0")}`;
    riders.push({ id, team_id: "t1", primary_type: "climber", is_retired: false });
    plans.push({ rider_id: id, season_id: "s4", focus: "vo2max" });
    abilities.push(
      i < DEAD
        ? { rider_id: id, climbing: 70, punch: 62, tempo: 58, ability_caps: CAPS }
        : { rider_id: id, climbing: 51, punch: 40, tempo: 41, ability_caps: CAPS }
    );
  }
  return { riders, plans, abilities };
}

const NOW = new Date("2026-10-02T09:00:00Z");
const PRIOR_AT = "2026-10-01T09:00:00.000Z";

function tablesWith({ flag, runs = [] }) {
  const { riders, plans, abilities } = population();
  return {
    app_config: flag == null ? [] : [{ key: "training_tick_per_race_day", value: flag }],
    teams: [{ id: "t1", is_ai: false }],
    riders,
    seasons: [{ id: "s4", number: 4, status: "active" }],
    training_plans: plans,
    rider_derived_abilities: abilities,
    // Forrige snapshot: springet til i dag er PRÆCIS loftet pr. kalenderdag.
    training_slot_health_daily: [{
      snapshot_date: "2026-10-01", focus: TOTAL_FOCUS_KEY,
      riders_in_training: DEAD + OPEN, dead_slots: DEAD - J, partial_slots: 0, generated_at: PRIOR_AT,
    }],
    ops_alert_state: [],
    training_day_runs: runs,
  };
}

// Løbsdags-runs for `teams` hold × `days` løbsdage, oprettet mellem de to snapshots.
function raceDayRuns({ teams = 3, days = 5, createdAt = "2026-10-01T19:30:00.000Z" } = {}) {
  const out = [];
  let n = 0;
  for (let t = 0; t < teams; t++) {
    for (let gd = 0; gd < days; gd++) {
      out.push({ id: `run${String(n++).padStart(5, "0")}`, team_id: `team${t}`, season_id: "s4", game_day: 40 + gd, created_at: createdAt });
    }
  }
  return out;
}

function watchArgs(supabase, captured = []) {
  const sent = [];
  return {
    sent,
    captured,
    args: {
      supabase,
      now: NOW,
      sendWebhookFn: async (url, body) => { sent.push({ url, body }); },
      getOpsWebhookFn: async () => "https://ops.example/webhook",
      captureExceptionFn: (err) => { captured.push(err.message); },
    },
  };
}

// ── resolveTrainingDaysSincePrevious ──────────────────────────────────────────

test("resolveTrainingDaysSincePrevious: flag off → 1 kalenderdag, INGEN training_day_runs-opslag", async () => {
  const supabase = makeSupabase(tablesWith({ flag: "off", runs: raceDayRuns() }));
  const res = await resolveTrainingDaysSincePrevious({ supabase, since: PRIOR_AT, now: NOW, seasonNumber: 4 });
  assert.deepEqual(res, { reliable: true, trainingDays: 1 });
  assert.deepEqual(supabase.calls.map((c) => c.table), ["app_config"]);
});

test("resolveTrainingDaysSincePrevious: flag on → median løbsdags-ticks omregnet via G1-deleren", async () => {
  const supabase = makeSupabase(tablesWith({ flag: "on", runs: raceDayRuns({ days: 5 }) }));
  const res = await resolveTrainingDaysSincePrevious({ supabase, since: PRIOR_AT, now: NOW, seasonNumber: 4 });
  assert.equal(res.reliable, true);
  assert.equal(res.raceDayTicks, 5);
  // Fem løbsdage er omtrent én kalenderdags træning — ikke fem.
  assert.ok(res.trainingDays > 0.75 && res.trainingDays < 1.5, `trainingDays ${res.trainingDays}`);
  const runsQuery = supabase.calls.find((c) => c.table === "training_day_runs");
  assert.ok(runsQuery.filters.some(([op, col]) => op === "notnull" && col === "game_day"), "kun løbsdags-nøglen");
  assert.ok(runsQuery.filters.some(([op, col, val]) => op === "gt" && col === "created_at" && val === PRIOR_AT));
});

test("resolveTrainingDaysSincePrevious: runs fra FØR forrige snapshot tælles ikke", async () => {
  const runs = [
    ...raceDayRuns({ days: 5 }),
    ...raceDayRuns({ days: 5, createdAt: "2026-09-30T19:30:00.000Z" }).map((r) => ({ ...r, id: `old-${r.id}`, game_day: r.game_day - 5 })),
  ];
  const supabase = makeSupabase(tablesWith({ flag: "on", runs }));
  const res = await resolveTrainingDaysSincePrevious({ supabase, since: PRIOR_AT, now: NOW, seasonNumber: 4 });
  assert.equal(res.raceDayTicks, 5);
});

test("resolveTrainingDaysSincePrevious: flag on + fejlet opslag / manglende tidsstempel → ikke pålidelig", async () => {
  const failing = makeSupabase(tablesWith({ flag: "on" }), { failTables: new Set(["training_day_runs"]) });
  const res = await resolveTrainingDaysSincePrevious({ supabase: failing, since: PRIOR_AT, now: NOW, seasonNumber: 4 });
  assert.equal(res.reliable, false);
  assert.match(res.error, /training_day_runs/);

  const noSince = makeSupabase(tablesWith({ flag: "on" }));
  assert.equal((await resolveTrainingDaysSincePrevious({ supabase: noSince, since: null, now: NOW })).reliable, false);
});

// ── runTrainingSlotHealthWatch end-to-end mod mocken ──────────────────────────

test("runTrainingSlotHealthWatch: flag off → den gamle spring-gate fyrer uændret (bit-identisk)", async () => {
  const supabase = makeSupabase(tablesWith({ flag: "off", runs: raceDayRuns({ days: 10 }) }));
  const { args, sent } = watchArgs(supabase);
  const res = await runTrainingSlotHealthWatch(args);
  assert.equal(res.totals.deadSlots, DEAD);
  assert.equal(res.trainingDays, 1);
  assert.equal(res.alerted, true);
  assert.match(JSON.stringify(sent[0].body), /på ét døgn/);
  assert.ok(!supabase.calls.some((c) => c.table === "training_day_runs"), "flag off læser ikke training_day_runs");
});

test("runTrainingSlotHealthWatch G9: flag on + et interval med to datoers løbsdage → ingen falsk alarm", async () => {
  const supabase = makeSupabase(tablesWith({ flag: "on", runs: raceDayRuns({ days: 10 }) }));
  const { args, sent } = watchArgs(supabase);
  const res = await runTrainingSlotHealthWatch(args);
  assert.ok(res.trainingDays > 1, `trainingDays ${res.trainingDays}`);
  assert.equal(res.alerted, false);
  assert.equal(sent.length, 0);
});

test("runTrainingSlotHealthWatch G9: flag on + fejlet tick-opslag → spring-gaten droppes, Sentry får besked", async () => {
  const supabase = makeSupabase(tablesWith({ flag: "on" }), { failTables: new Set(["training_day_runs"]) });
  const captured = [];
  const { args, sent } = watchArgs(supabase, captured);
  const res = await runTrainingSlotHealthWatch(args);
  assert.equal(res.alerted, false, "et uverificerbart spring må ikke blive en alarm");
  assert.equal(sent.length, 0);
  assert.ok(captured.some((m) => /cadence/.test(m)), captured.join(" | "));
});
