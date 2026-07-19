import test from "node:test";
import assert from "node:assert/strict";

import {
  runSundayIntakeTick,
  isCopenhagenSunday,
  copenhagenDateString,
  SUNDAY_DRIP_COUNT,
} from "./sundayIntakeTick.js";

// ─── Mock-supabase helper ──────────────────────────────────────────────────────
//
// sundayIntakeTick.js selv taler direkte til supabase for tre queries:
//   seasons:              select().eq("status","active").maybeSingle()
//   teams:                select().eq()×4 → thenable (ingen terminal-metode)
//   riders:                fetchExistingFoldedRiderNames → select().order("id").range()
//   academy_intake_ticks: upsert(row, opts).select("team_id") → { data, error }
//
// Resten (seedCohortFn/deriveRiders/notify/isEnabled) er DI-hooks og injiceres
// direkte i testene — mocken skal derfor IKKE understøtte academy_intake eller
// riders-insert.
function buildMockSupabase({
  season = { id: "season-1", number: 2, start_date: "2026-07-27" },
  teams = [],
  existingRiders = [],
  claims = {}, // teamId -> false betyder "allerede claimet i dag" (boot-run/replica)
} = {}) {
  const capture = { upserts: [] };
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: season, error: null }); },
        };
        return api;
      }

      if (table === "teams") {
        // Ingen terminal-metode i den rigtige kode — den awaiter kæden direkte
        // efter fjerde .eq(), så chain-objektet skal selv være thenable.
        const chain = {
          eq() { return chain; },
          then(resolve, reject) {
            return Promise.resolve({ data: teams, error: null }).then(resolve, reject);
          },
        };
        return { select() { return chain; } };
      }

      if (table === "riders") {
        // fetchExistingFoldedRiderNames → fetchAllRows(() => select().order("id")),
        // som selv påfører .range(from,to).
        const api = {
          select() { return api; },
          order(col) { assert.equal(col, "id"); return api; },
          range() { return Promise.resolve({ data: existingRiders, error: null }); },
        };
        return api;
      }

      if (table === "academy_intake_ticks") {
        return {
          upsert(row, opts) {
            capture.upserts.push({ row, opts });
            const claimed = claims[row.team_id] !== false;
            return {
              select(cols) {
                assert.equal(cols, "team_id");
                return Promise.resolve({
                  data: claimed ? [{ team_id: row.team_id }] : [],
                  error: null,
                });
              },
            };
          },
        };
      }

      throw new Error(`buildMockSupabase: uventet tabel ${table}`);
    },
    _capture: capture,
  };
  return supabase;
}

// ─── Dato-helpers ───────────────────────────────────────────────────────────────

test("isCopenhagenSunday: søndag i CEST (UTC+2) er sand, mandag er falsk", () => {
  assert.equal(isCopenhagenSunday(new Date("2026-07-19T10:00:00Z")), true);
  assert.equal(isCopenhagenSunday(new Date("2026-07-20T10:00:00Z")), false);
});

test("copenhagenDateString: YYYY-MM-DD i Europe/Copenhagen", () => {
  assert.equal(copenhagenDateString(new Date("2026-07-19T10:00:00Z")), "2026-07-19");
});

// ─── Guard-klausuler (no-op-stier) ───────────────────────────────────────────────

test("ikke søndag → no-op", async () => {
  const r = await runSundayIntakeTick({
    supabase: { from: () => ({}) },
    now: new Date("2026-07-20T10:00:00Z"), // mandag
  });
  assert.deepEqual(r, { ran: false, reason: "not_sunday" });
});

test("flag off → no-op", async () => {
  const r = await runSundayIntakeTick({
    supabase: { from: () => ({}) },
    now: new Date("2026-07-19T10:00:00Z"), // søndag
    isEnabled: async () => false,
  });
  assert.deepEqual(r, { ran: false, reason: "flag_off" });
});

test("ingen aktiv sæson → no-op", async () => {
  const supabase = buildMockSupabase({ season: null });
  const r = await runSundayIntakeTick({
    supabase,
    now: new Date("2026-07-19T10:00:00Z"),
    isEnabled: async () => true,
  });
  assert.deepEqual(r, { ran: false, reason: "no_active_season" });
});

test("mangler supabase-klient → kaster", async () => {
  await assert.rejects(
    () => runSundayIntakeTick({ supabase: null }),
    /Supabase client required/,
  );
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("happy path: 2 hold, hver får SUNDAY_DRIP_COUNT kandidater, ét samlet derive-kald, notify pr. hold", async () => {
  const teams = [
    { id: "t1", season_1_identity_basis: null },
    { id: "t2", season_1_identity_basis: { dominant_nationality: "DNK" } },
  ];
  const supabase = buildMockSupabase({ teams });

  const seedCalls = [];
  const deriveCalls = [];
  const notifyCalls = [];

  const r = await runSundayIntakeTick({
    supabase,
    now: new Date("2026-07-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async (_sb, opts) => {
      seedCalls.push(opts);
      return [`${opts.teamId}-r1`, `${opts.teamId}-r2`];
    },
    deriveRiders: async (_sb, ids, opts) => { deriveCalls.push({ ids, opts }); },
    notify: async (opts) => { notifyCalls.push(opts); },
  });

  assert.equal(r.ran, true);
  assert.equal(r.teams, 2);
  assert.equal(r.candidates, 4);
  assert.equal(r.errors, undefined, "ingen errors-felt ved fuld succes");

  assert.equal(seedCalls.length, 2);
  for (const call of seedCalls) {
    assert.equal(call.countOverride, SUNDAY_DRIP_COUNT);
  }

  assert.equal(deriveCalls.length, 1, "ét samlet derive-kald for ALLE nye ryttere");
  assert.deepEqual(deriveCalls[0].ids, ["t1-r1", "t1-r2", "t2-r1", "t2-r2"], "hold-rækkefølge bevaret");
  assert.equal(deriveCalls[0].opts.dryRun, false);

  assert.equal(notifyCalls.length, 2, "notify kaldt pr. hold");
  for (const call of notifyCalls) {
    assert.equal(call.type, "academy_drip");
    assert.equal(call.metadata.titleCode, "notif.academyDrip.title");
    assert.equal(call.metadata.messageCode, "notif.academyDrip.message");
  }

  // Claim-upsert skete FØR seed (idempotens-nøgle).
  assert.equal(supabase._capture.upserts.length, 2);
  for (const u of supabase._capture.upserts) {
    assert.equal(u.row.tick_date, "2026-07-19");
    assert.deepEqual(u.opts, { onConflict: "team_id,tick_date", ignoreDuplicates: true });
  }
});

// ─── Idempotens: allerede claimet ───────────────────────────────────────────────

test("allerede claimet (boot-run/replica) → hold springes helt over", async () => {
  const teams = [{ id: "t1", season_1_identity_basis: null }];
  const supabase = buildMockSupabase({ teams, claims: { t1: false } });

  let seedCalled = false;
  let deriveCalled = false;
  let notifyCalled = false;

  const r = await runSundayIntakeTick({
    supabase,
    now: new Date("2026-07-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async () => { seedCalled = true; return []; },
    deriveRiders: async () => { deriveCalled = true; },
    notify: async () => { notifyCalled = true; },
  });

  assert.equal(r.ran, true);
  assert.equal(r.teams, 0);
  assert.equal(r.candidates, 0);
  assert.equal(seedCalled, false, "seedCohortFn må ikke kaldes for allerede-claimet hold");
  assert.equal(deriveCalled, false);
  assert.equal(notifyCalled, false);
});

// ─── Fejl-isolering ─────────────────────────────────────────────────────────────

test("seed-fejl på ét hold vælter ikke de andre — rapporteres i errors[]", async () => {
  const teams = [
    { id: "t1", season_1_identity_basis: null },
    { id: "t2", season_1_identity_basis: null },
  ];
  const supabase = buildMockSupabase({ teams });

  const r = await runSundayIntakeTick({
    supabase,
    now: new Date("2026-07-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async (_sb, opts) => {
      if (opts.teamId === "t1") throw new Error("boom");
      return ["t2-r1", "t2-r2"];
    },
    deriveRiders: async () => {},
    notify: async () => {},
  });

  assert.equal(r.teams, 1, "kun t2 tælles med");
  assert.equal(r.candidates, 2);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /t1: boom/);
});

// ─── Ingen hold ─────────────────────────────────────────────────────────────────

test("ingen menneske-hold → ran:true, teams:0, candidates:0, ingen kald til DI-hooks", async () => {
  const supabase = buildMockSupabase({ teams: [] });
  let seedCalled = false;
  const r = await runSundayIntakeTick({
    supabase,
    now: new Date("2026-07-19T10:00:00Z"),
    isEnabled: async () => true,
    seedCohortFn: async () => { seedCalled = true; return []; },
  });
  assert.deepEqual(r, { ran: true, tickDate: "2026-07-19", teams: 0, candidates: 0 });
  assert.equal(seedCalled, false);
});
