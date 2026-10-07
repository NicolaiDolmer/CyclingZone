// #6278: kontrakt-tests for den server-side PostHog-klient og milepaelen
// `first_race_with_own_squad` (de-dup via user_milestones, aldrig player_events,
// samtykke, fejl-sluk).
import test from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_RACE_WITH_OWN_SQUAD_EVENT,
  POSTHOG_EU_CAPTURE_URL,
  USER_MILESTONES_TABLE,
  captureServerEvent,
  getPosthogProjectKey,
  hasDeclinedAnalytics,
  isHumanTeam,
  recordFirstRaceWithOwnSquad,
  recordFirstRaceWithOwnSquadInBackground,
  selectNewMilestoneCandidates,
  teamIdsFromResultRows,
} from "./posthogServer.ts";

const KEY = "phc_test_key";
const event = { event: FIRST_RACE_WITH_OWN_SQUAD_EVENT, distinctId: "user-a" };

function okFetch(calls: Array<{ url: string; body: any }>) {
  return async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
}

// ── Klienten ──────────────────────────────────────────────────────────────────

test("getPosthogProjectKey: missing or blank env is null", () => {
  assert.equal(getPosthogProjectKey({}), null);
  assert.equal(getPosthogProjectKey({ POSTHOG_PROJECT_KEY: "   " }), null);
  assert.equal(getPosthogProjectKey({ POSTHOG_PROJECT_KEY: " phc_x " }), "phc_x");
});

test("captureServerEvent is a no-op without a key: no fetch at all", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200 };
  };
  assert.equal(await captureServerEvent(event, { apiKey: null, fetchImpl }), false);
  assert.equal(called, false);
});

test("captureServerEvent posts to the EU capture endpoint with the internal UUID as distinct_id", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const ok = await captureServerEvent(
    { ...event, properties: { race_id: "race-1" }, timestamp: "2026-10-06T12:00:00.000Z" },
    { apiKey: KEY, fetchImpl: okFetch(calls) },
  );
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, POSTHOG_EU_CAPTURE_URL);
  assert.equal(calls[0].url, "https://eu.i.posthog.com/i/v0/e/");
  assert.equal(calls[0].body.api_key, KEY);
  assert.equal(calls[0].body.event, FIRST_RACE_WITH_OWN_SQUAD_EVENT);
  assert.equal(calls[0].body.distinct_id, "user-a");
  assert.equal(calls[0].body.timestamp, "2026-10-06T12:00:00.000Z");
  assert.equal(calls[0].body.properties.race_id, "race-1");
});

test("captureServerEvent times out instead of hanging, even if fetch ignores the signal", async () => {
  const errors: unknown[] = [];
  const never = () => new Promise<{ ok: boolean; status: number }>(() => {});
  const started = Date.now();
  const ok = await captureServerEvent(event, { apiKey: KEY, fetchImpl: never, timeoutMs: 30, onError: (e) => errors.push(e) });
  assert.equal(ok, false);
  assert.ok(Date.now() - started < 1500, "timeout must be enforced");
  assert.equal(errors.length, 1);
  assert.match(String((errors[0] as Error).message), /timed out/);
});

test("captureServerEvent swallows network errors, non-2xx and a throwing onError", async () => {
  const boom = async () => {
    throw new Error("ECONNRESET");
  };
  assert.equal(await captureServerEvent(event, { apiKey: KEY, fetchImpl: boom }), false);
  assert.equal(
    await captureServerEvent(event, {
      apiKey: KEY,
      fetchImpl: boom,
      onError: () => {
        throw new Error("reporter down");
      },
    }),
    false,
  );
  const notOk = async () => ({ ok: false, status: 503 });
  const errors: unknown[] = [];
  assert.equal(await captureServerEvent(event, { apiKey: KEY, fetchImpl: notOk, onError: (e) => errors.push(e) }), false);
  assert.match(String((errors[0] as Error).message), /HTTP 503/);
  const syncThrow = () => {
    throw new Error("sync");
  };
  assert.equal(await captureServerEvent(event, { apiKey: KEY, fetchImpl: syncThrow as any }), false);
});

test("hasDeclinedAnalytics: only an answered 'no' counts as declined", () => {
  assert.equal(hasDeclinedAnalytics({ analytics: false, necessary: true }), true);
  assert.equal(hasDeclinedAnalytics({ analytics: true }), false);
  assert.equal(hasDeclinedAnalytics(null), false);
  assert.equal(hasDeclinedAnalytics(undefined), false);
  assert.equal(hasDeclinedAnalytics({}), false);
  assert.equal(hasDeclinedAnalytics("false"), false);
});

// ── De-dup-udvaelgelsen ───────────────────────────────────────────────────────

test("teamIdsFromResultRows: unique, non-empty, sorted", () => {
  assert.deepEqual(
    teamIdsFromResultRows([{ team_id: "t2" }, { team_id: "t1" }, { team_id: "t2" }, { team_id: null }, {}]),
    ["t1", "t2"],
  );
  assert.deepEqual(teamIdsFromResultRows(null), []);
});

test("isHumanTeam: AI, bank, test accounts and ownerless teams are excluded", () => {
  assert.equal(isHumanTeam({ id: "t", user_id: "u", is_ai: false, is_bank: false, is_test_account: false }), true);
  assert.equal(isHumanTeam({ id: "t", user_id: "u", is_ai: true }), false);
  assert.equal(isHumanTeam({ id: "t", user_id: "u", is_ai: false, is_bank: true }), false);
  assert.equal(isHumanTeam({ id: "t", user_id: "u", is_ai: false, is_test_account: true }), false);
  assert.equal(isHumanTeam({ id: "t", user_id: null, is_ai: false }), false);
});

test("selectNewMilestoneCandidates skips users that already have the event and dedups per user", () => {
  const teams = [
    { id: "t3", user_id: "u1", is_ai: false },
    { id: "t1", user_id: "u1", is_ai: false }, // samme manager, to hold
    { id: "t2", user_id: "u2", is_ai: false },
    { id: "t4", user_id: "u3", is_ai: false },
    { id: "t5", user_id: "u4", is_ai: true },
  ];
  assert.deepEqual(selectNewMilestoneCandidates({ teams, existingUserIds: ["u2"] }), [
    { userId: "u1", teamId: "t1" },
    { userId: "u3", teamId: "t4" },
  ]);
  assert.deepEqual(selectNewMilestoneCandidates({ teams, existingUserIds: ["u1", "u2", "u3"] }), []);
});

// ── Hele milepaelen mod en fake supabase ─────────────────────────────────────

type Tables = Record<string, any[]>;

function fakeSupabase(
  tables: Tables,
  opts: { insertError?: { message: string; code?: string }; failTable?: string; failCode?: string; raceWinner?: string[] } = {},
) {
  const log: Array<{ table: string; op: string; payload?: any }> = [];
  const inserted: any[] = [];
  const from = (table: string) => {
    const filters: Array<(row: any) => boolean> = [];
    const builder: any = {
      select() {
        log.push({ table, op: "select" });
        return builder;
      },
      in(col: string, ids: string[]) {
        filters.push((row) => ids.includes(row[col]));
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      // upsert(...).select(): ON CONFLICT (user_id, milestone) DO NOTHING RETURNING user_id
      upsert(rows: any[], upsertOpts: any) {
        log.push({ table, op: "upsert", payload: { rows, opts: upsertOpts } });
        return {
          select() {
            if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError });
            const store = (tables[table] ||= []);
            // et samtidigt loeb naaede at skrive disse brugere foerst
            for (const userId of opts.raceWinner ?? []) store.push({ user_id: userId, milestone: FIRST_RACE_WITH_OWN_SQUAD_EVENT });
            const written: any[] = [];
            for (const row of rows) {
              if (store.some((r) => r.user_id === row.user_id && r.milestone === row.milestone)) continue;
              store.push(row);
              inserted.push(row);
              written.push({ user_id: row.user_id });
            }
            return Promise.resolve({ data: written, error: null });
          },
        };
      },
      then(resolve: (v: any) => void, reject: (e: any) => void) {
        if (opts.failTable === table) return Promise.resolve({ data: null, error: { message: "db down", code: opts.failCode } }).then(resolve, reject);
        const data = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { supabase: { from }, log, inserted };
}

const race = { id: "race-1", season_id: "season-1", squad: "senior" };
const resultRows = [
  { team_id: "t-new" },
  { team_id: "t-new" },
  { team_id: "t-veteran" },
  { team_id: "t-ai" },
  { team_id: "t-declined" },
];
function baseTables(): Tables {
  return {
    teams: [
      { id: "t-new", user_id: "u-new", is_ai: false, is_bank: false, is_test_account: false },
      { id: "t-veteran", user_id: "u-veteran", is_ai: false, is_bank: false, is_test_account: false },
      { id: "t-ai", user_id: null, is_ai: true, is_bank: false, is_test_account: false },
      { id: "t-declined", user_id: "u-declined", is_ai: false, is_bank: false, is_test_account: false },
    ],
    user_milestones: [{ user_id: "u-veteran", milestone: FIRST_RACE_WITH_OWN_SQUAD_EVENT }],
    users: [
      { id: "u-new", created_at: "2026-10-04T12:00:00.000Z", consent_preferences: null },
      { id: "u-declined", created_at: "2026-10-01T12:00:00.000Z", consent_preferences: { analytics: false } },
    ],
  };
}
const now = () => new Date("2026-10-06T12:00:00.000Z");

test("records the milestone once per new human user and sends PostHog only for non-declined users", async () => {
  const { supabase, log, inserted } = fakeSupabase(baseTables());
  const calls: Array<{ url: string; body: any }> = [];
  const res = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, stageNumber: 1, apiKey: KEY, fetchImpl: okFetch(calls), now });

  assert.deepEqual(res, { recorded: 2, sent: 1 });
  assert.deepEqual(
    inserted.map((r) => r.user_id),
    ["u-declined", "u-new"],
  );
  assert.ok(inserted.every((r) => r.milestone === FIRST_RACE_WITH_OWN_SQUAD_EVENT));
  const newRow = inserted.find((r) => r.user_id === "u-new");
  assert.equal(newRow.team_id, "t-new");
  assert.deepEqual(newRow.data, { race_id: "race-1", stage_number: 1, squad: "senior", days_since_signup: 2, source: "server" });
  // ét batch-upsert mod user_milestones (ON CONFLICT DO NOTHING) og faste opslag, aldrig pr. rytter
  const upserts = log.filter((l) => l.op === "upsert");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].table, USER_MILESTONES_TABLE);
  assert.deepEqual(upserts[0].payload.opts, { onConflict: "user_id,milestone", ignoreDuplicates: true });
  assert.equal(log.filter((l) => l.op === "select").length, 3);
  // Milepaelen er IKKE brugeraktivitet: player_events roeres aldrig (#6278-review).
  assert.equal(log.filter((l) => l.table === "player_events").length, 0);
  // PostHog: kun den ikke-afviste bruger, distinct_id = intern UUID
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.distinct_id, "u-new");

  // Anden etape: alle har nu raekken -> intet skrives, intet sendes.
  const calls2: Array<{ url: string; body: any }> = [];
  const res2 = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, stageNumber: 2, apiKey: KEY, fetchImpl: okFetch(calls2), now });
  assert.deepEqual(res2, { recorded: 0, sent: 0, skipped: "already_recorded" });
  assert.equal(calls2.length, 0);
});

test("without a PostHog key the Postgres row is still written, but nothing is sent", async () => {
  const { supabase, inserted } = fakeSupabase(baseTables());
  let fetched = false;
  const res = await recordFirstRaceWithOwnSquad({
    supabase,
    race,
    resultRows,
    apiKey: null,
    fetchImpl: async () => {
      fetched = true;
      return { ok: true, status: 200 };
    },
    now,
  });
  assert.deepEqual(res, { recorded: 2, sent: 0, skipped: "no_posthog_key" });
  assert.equal(inserted.length, 2);
  assert.equal(fetched, false);
});

test("a failed insert sends nothing to PostHog (no copy without the Postgres truth)", async () => {
  const { supabase } = fakeSupabase(baseTables(), { insertError: { message: "permission denied", code: "42501" } });
  const calls: Array<{ url: string; body: any }> = [];
  const reported: unknown[] = [];
  const res = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, apiKey: KEY, fetchImpl: okFetch(calls), now, reportError: (e) => reported.push(e) });
  assert.deepEqual(res, { recorded: 0, sent: 0, skipped: "insert_failed" });
  assert.equal(calls.length, 0);
  assert.equal(reported.length, 1);
});

test("a concurrent race that already wrote the row: only rows this call wrote are sent", async () => {
  const { supabase } = fakeSupabase(baseTables(), { raceWinner: ["u-new"] });
  const calls: Array<{ url: string; body: any }> = [];
  const res = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, apiKey: KEY, fetchImpl: okFetch(calls), now });
  // u-new blev skrevet af det andet loeb; kun u-declined er ny her, og den har afvist analytics
  assert.deepEqual(res, { recorded: 1, sent: 0 });
  assert.equal(calls.length, 0);
});

test("a missing user_milestones table (backend before migration) is a silent skip, not a Sentry report", async () => {
  const reported: unknown[] = [];
  for (const code of ["42P01", "PGRST205"]) {
    const { supabase } = fakeSupabase(baseTables(), { failTable: USER_MILESTONES_TABLE, failCode: code });
    const res = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, apiKey: KEY, now, reportError: (e) => reported.push(e) });
    assert.deepEqual(res, { recorded: 0, sent: 0, skipped: "table_missing" });
  }
  const { supabase } = fakeSupabase(baseTables(), { insertError: { message: "relation does not exist", code: "42P01" } });
  const res = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, apiKey: KEY, now, reportError: (e) => reported.push(e) });
  assert.deepEqual(res, { recorded: 0, sent: 0, skipped: "table_missing" });
  assert.equal(reported.length, 0);
});

test("a DB lookup error is swallowed and reported, never thrown", async () => {
  const { supabase } = fakeSupabase(baseTables(), { failTable: "teams" });
  const reported: unknown[] = [];
  const res = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, apiKey: KEY, now, reportError: (e) => reported.push(e) });
  assert.deepEqual(res, { recorded: 0, sent: 0, skipped: "error" });
  assert.equal(reported.length, 1);
});

test("a PostHog failure does not undo or fail the recorded milestone", async () => {
  const { supabase, inserted } = fakeSupabase(baseTables());
  const res = await recordFirstRaceWithOwnSquad({
    supabase,
    race,
    resultRows,
    apiKey: KEY,
    fetchImpl: async () => {
      throw new Error("ENOTFOUND");
    },
    now,
  });
  assert.deepEqual(res, { recorded: 2, sent: 0 });
  assert.equal(inserted.length, 2);
});

test("non-official races (no season) and empty fields are skipped without DB calls", async () => {
  const { supabase, log } = fakeSupabase(baseTables());
  assert.equal((await recordFirstRaceWithOwnSquad({ supabase, race: { id: "r", season_id: null }, resultRows, apiKey: KEY })).skipped, "not_official");
  assert.equal((await recordFirstRaceWithOwnSquad({ supabase, race, resultRows: [], apiKey: KEY })).skipped, "no_teams");
  assert.equal(log.length, 0);
});

test("the background entry never throws, even with a broken supabase client", async () => {
  const broken = {
    from() {
      throw new Error("client exploded");
    },
  };
  const promise = recordFirstRaceWithOwnSquadInBackground({ supabase: broken, race, resultRows, apiKey: KEY, reportError: () => {} });
  assert.deepEqual(await promise, { recorded: 0, sent: 0, skipped: "error" });
  const nothing = recordFirstRaceWithOwnSquadInBackground(undefined as any);
  assert.equal((await nothing).recorded, 0);
});
