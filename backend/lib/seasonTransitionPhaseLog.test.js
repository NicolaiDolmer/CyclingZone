import test from "node:test";
import assert from "node:assert/strict";

import {
  logTransitionPhaseSafe,
  TRANSITION_PHASE_STATUS,
  TRANSITION_PHASE_LOG_SOURCE,
} from "./seasonTransitionPhaseLog.js";
import { transitionToNextSeason } from "./seasonTransition.js";

// #2921 · Fase-logning af sæson-transitionen.
// To ting skal holde:
//   1. Ankrene skrives med den RIGTIGE action_type (manual_override, ikke
//      season_transition — dailySeasonCountCheck tæller på den sidste).
//   2. Logningen er ren observability: den må ALDRIG ændre transitionens
//      resultat, uanset hvordan admin_log-skrivningen fejler.

function makeSupabase({ failMode = null } = {}) {
  const rows = [];
  return {
    rows,
    from() {
      return {
        insert(payload) {
          if (failMode === "throw") throw new Error("admin_log unreachable");
          if (failMode === "error") {
            return {
              select: () => ({ single: async () => ({ data: null, error: { message: "insert denied" } }) }),
            };
          }
          rows.push(payload);
          return {
            select: () => ({ single: async () => ({ data: { id: `log-${rows.length}` }, error: null }) }),
          };
        },
      };
    },
  };
}

const BASE = {
  fromSeasonId: "season-1",
  toSeasonId: "season-2",
  fromNumber: 1,
  toNumber: 2,
  adminUserId: "admin-1",
  transitionAtIso: "2026-07-26T18:15:00.000Z",
};

test("skriver START-anker som manual_override med source-diskriminator", async () => {
  const supabase = makeSupabase();
  const res = await logTransitionPhaseSafe({
    supabase,
    status: TRANSITION_PHASE_STATUS.STARTED,
    ...BASE,
  });

  assert.equal(res.logged, true);
  const row = supabase.rows[0];
  // Må IKKE være season_transition: dailySeasonCountCheck tæller den type som
  // cron-loop-værn, og drejebogen forventer præcis ÉN sådan række pr. skifte.
  assert.equal(row.action_type, "manual_override");
  assert.equal(row.meta.source, TRANSITION_PHASE_LOG_SOURCE);
  assert.equal(row.meta.status, "started");
  assert.equal(row.meta.from_season_id, "season-1");
  assert.equal(row.meta.to_season_number, 2);
  assert.equal(row.admin_user_id, "admin-1");
  assert.match(row.description, /STARTET: 1 → 2/);
  assert.ok(row.description.length > 0, "description er NOT NULL i admin_log");
});

test("SLUT-anker bærer fase-navne og de fejl faserne selv fangede", async () => {
  const supabase = makeSupabase();
  await logTransitionPhaseSafe({
    supabase,
    status: TRANSITION_PHASE_STATUS.COMPLETED,
    ...BASE,
    log: [
      { phase: "insert_next_season", inserted: true },
      { phase: "global_rank_decay", error: "rpc timeout" },
      { phase: "sponsor_payout", count: 150 },
    ],
  });

  const meta = supabase.rows[0].meta;
  assert.equal(meta.status, "completed");
  assert.deepEqual(meta.phases, [
    { phase: "insert_next_season" },
    { phase: "global_rank_decay", error: "rpc timeout" },
    { phase: "sponsor_payout" },
  ]);
});

test("FEJL-anker indeholder fejlen og sidste nåede fase", async () => {
  const supabase = makeSupabase();
  await logTransitionPhaseSafe({
    supabase,
    status: TRANSITION_PHASE_STATUS.FAILED,
    ...BASE,
    log: [{ phase: "insert_next_season" }, { phase: "sponsor_payout" }],
    error: "payout crashed",
  });

  const row = supabase.rows[0];
  assert.equal(row.meta.status, "failed");
  assert.equal(row.meta.error, "payout crashed");
  assert.match(row.description, /FEJLEDE/);
  assert.match(row.description, /sidste fase: sponsor_payout/);
});

test("FAIL-SAFE: insert-fejl kaster ikke", async () => {
  const res = await logTransitionPhaseSafe({
    supabase: makeSupabase({ failMode: "error" }),
    status: TRANSITION_PHASE_STATUS.STARTED,
    ...BASE,
  });
  assert.equal(res.logged, false);
  assert.match(res.reason, /insert denied/);
});

test("FAIL-SAFE: exception i klienten kaster ikke", async () => {
  const res = await logTransitionPhaseSafe({
    supabase: makeSupabase({ failMode: "throw" }),
    status: TRANSITION_PHASE_STATUS.STARTED,
    ...BASE,
  });
  assert.equal(res.logged, false);
  assert.match(res.reason, /admin_log unreachable/);
});

test("FAIL-SAFE: helt manglende supabase-klient kaster ikke", async () => {
  const res = await logTransitionPhaseSafe({ status: TRANSITION_PHASE_STATUS.STARTED, ...BASE });
  assert.equal(res.logged, false);
});

// ─── Transitionens resultat er uændret af logningen ──────────────────────────

// Minimal mock der efterligner seasonTransition.test.js's harness, men hvor
// ALLE admin_log-inserts fejler. Transitionen skal stadig gennemføres.
function createTransitionMock({ adminLogFails = false } = {}) {
  const state = {
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [
      { id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
    season_standings: [],
    admin_log: [],
    notifications: [],
    sponsor_contracts: [],
    // #2753 · previewets pullout-opslag (board_consequences lag 5).
    board_consequences: [],
    app_config: [],
  };

  function matches(row, filters) {
    return Object.entries(filters).every(([col, val]) => {
      if (col === "__contains") return true;
      return row[col] === val;
    });
  }

  function chain(table, filters = {}, range = null) {
    const rows = () => state[table].filter((r) => matches(r, filters));
    return {
      eq: (col, val) => chain(table, { ...filters, [col]: val }, range),
      gte: () => chain(table, filters, range),
      is: (col, val) => chain(table, { ...filters, [col]: val }, range),
      order: () => chain(table, filters, range),
      limit: () => chain(table, filters, range),
      // #2926: buildTransitionPlan henter sponsor_contracts pagineret via fetchAllRows.
      range: (from, to) => chain(table, filters, { from, to }),
      contains: () => chain(table, { ...filters, __contains: true }, range),
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: null }),
      then: (resolve) => resolve({ data: range ? rows().slice(range.from, range.to + 1) : rows(), error: null }),
    };
  }

  return {
    __state: state,
    from(table) {
      return {
        select: () => chain(table),
        insert(payload) {
          const row = Array.isArray(payload) ? payload[0] : payload;
          // Kun FASE-ankrene sabateres. Den eksisterende writeAdminLog-række
          // (action_type='season_transition') har altid kastet ved fejl, og den
          // adfærd ændrer #2921 ikke — vi tester at MIN tilføjelse er harmløs.
          if (table === "admin_log" && adminLogFails && row?.meta?.source === TRANSITION_PHASE_LOG_SOURCE) {
            return {
              select: () => ({
                single: async () => ({ data: null, error: { message: "admin_log write blocked" } }),
              }),
              then: (resolve) => resolve({ error: { message: "admin_log write blocked" } }),
            };
          }
          state[table].push({ ...row });
          return {
            select: () => ({ single: async () => ({ data: row, error: null }) }),
            then: (resolve) => resolve({ error: null }),
          };
        },
        update(payload) {
          return {
            eq(col, val) {
              for (const row of state[table].filter((r) => r[col] === val)) Object.assign(row, payload);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

const TRANSITION_DEPS = {
  expireAndRenewContracts: async () => {},
  releaseExpiredContractRiders: async () => ({ candidates: 0, released: 0 }),
  releaseRetiredRiders: async () => ({ candidates: 0, released: 0 }),
  processSeasonStart: async () => ({
    sponsor: [],
    payroll: { results: [], summary: { teams_processed: 0 } },
  }),
  notifySeasonEvent: async () => {},
  applyGlobalRankSeasonRollover: async () => ({ ok: true }),
  emitSeasonStartedNotifications: async () => ({ eligible: 0, delivered: 0 }),
  emitContractExpiringNotifications: async () => ({ eligible: 0, delivered: 0 }),
};

test("transitionen gennemføres uændret selv om ALLE admin_log-skrivninger fejler", async () => {
  const supabase = createTransitionMock({ adminLogFails: true });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: TRANSITION_DEPS,
  });

  assert.equal(result.ok, true, "en fejlende fase-log må aldrig vælte transitionen");
  const newSeason = supabase.__state.seasons.find((s) => s.number === 1);
  assert.equal(newSeason.status, "active", "næste sæson er stadig aktiveret");
  assert.equal(
    supabase.__state.seasons.find((s) => s.number === 0).status,
    "completed",
    "forrige sæson er stadig lukket",
  );
});

test("fase-logning ændrer ikke transitionens fase-liste (rent additivt)", async () => {
  const withLog = await transitionToNextSeason({
    supabase: createTransitionMock(),
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: TRANSITION_DEPS,
  });
  const withBrokenLog = await transitionToNextSeason({
    supabase: createTransitionMock({ adminLogFails: true }),
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: TRANSITION_DEPS,
  });

  assert.deepEqual(
    withBrokenLog.log.map((e) => e.phase),
    withLog.log.map((e) => e.phase),
    "samme faser i samme rækkefølge, uanset om fase-loggen kan skrives",
  );
});

test("START-ankeret skrives FØR første write-fase", async () => {
  const supabase = createTransitionMock();
  await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: TRANSITION_DEPS,
  });

  const anchors = supabase.__state.admin_log.filter(
    (r) => r.meta?.source === TRANSITION_PHASE_LOG_SOURCE,
  );
  assert.equal(anchors[0].meta.status, "started");
  assert.equal(anchors[anchors.length - 1].meta.status, "completed");

  // Drejebogens verifikation (docs/SEASON_TRANSITION_CHECKLIST.md skridt 5)
  // forventer PRÆCIS ÉN ny season_transition-række. Ankrene må ikke tælle med.
  const transitionRows = supabase.__state.admin_log.filter(
    (r) => r.action_type === "season_transition",
  );
  assert.equal(transitionRows.length, 1, "ankrene må ikke forurene season_transition-tællingen");
});

test("dry-run skriver ingen ankre (ingen writes overhovedet)", async () => {
  const supabase = createTransitionMock();
  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    dryRun: true,
    deps: TRANSITION_DEPS,
  });

  assert.equal(result.dryRun, true);
  assert.equal(supabase.__state.admin_log.length, 0);
});
