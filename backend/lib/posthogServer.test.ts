// #6278: kontrakt-tests for den server-side PostHog-klient og milepaelen
// `first_race_with_own_squad` (de-dup via player_events, samtykke, fejl-sluk).
import test from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_RACE_WITH_OWN_SQUAD_EVENT,
  POSTHOG_EU_CAPTURE_URL,
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

function fakeSupabase(tables: Tables, opts: { insertError?: string; failTable?: string } = {}) {
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
      insert(rows: any[]) {
        log.push({ table, op: "insert", payload: rows });
        if (opts.insertError) return Promise.resolve({ data: null, error: { message: opts.insertError } });
        inserted.push(...rows);
        (tables[table] ||= []).push(...rows);
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: any) => void, reject: (e: any) => void) {
        if (opts.failTable === table) return Promise.resolve({ data: null, error: { message: "db down" } }).then(resolve, reject);
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
    player_events: [{ user_id: "u-veteran", event_name: FIRST_RACE_WITH_OWN_SQUAD_EVENT }],
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
  assert.ok(inserted.every((r) => r.event_name === FIRST_RACE_WITH_OWN_SQUAD_EVENT));
  const newRow = inserted.find((r) => r.user_id === "u-new");
  assert.equal(newRow.team_id, "t-new");
  assert.deepEqual(newRow.event_data, { race_id: "race-1", stage_number: 1, squad: "senior", days_since_signup: 2, source: "server" });
  // ét batch-insert og faste opslag, aldrig pr. rytter
  assert.equal(log.filter((l) => l.op === "insert").length, 1);
  assert.equal(log.filter((l) => l.op === "select").length, 3);
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
  const { supabase } = fakeSupabase(baseTables(), { insertError: "permission denied" });
  const calls: Array<{ url: string; body: any }> = [];
  const reported: unknown[] = [];
  const res = await recordFirstRaceWithOwnSquad({ supabase, race, resultRows, apiKey: KEY, fetchImpl: okFetch(calls), now, reportError: (e) => reported.push(e) });
  assert.deepEqual(res, { recorded: 0, sent: 0, skipped: "insert_failed" });
  assert.equal(calls.length, 0);
  assert.equal(reported.length, 1);
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
