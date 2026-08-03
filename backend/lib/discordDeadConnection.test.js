import test from "node:test";
import assert from "node:assert/strict";

import {
  recordPermanentDmFailure,
  clearDmFailureCount,
  DEAD_CONNECTION_THRESHOLD,
} from "./discordDeadConnection.js";

const NOW = new Date("2026-08-03T10:00:00Z");
const DISCORD_ID = "1197423732671664200";

// ── Supabase-mock (chainable, registrerer writes) ────────────────────────────

function makeSupabaseMock({ user = null, readError = null, writeError = null } = {}) {
  const writes = { updates: [] };
  const supabase = {
    from(table) {
      assert.equal(table, "users");
      return {
        select() {
          const builder = {
            eq: () => builder,
            maybeSingle: () =>
              Promise.resolve(readError ? { data: null, error: readError } : { data: user, error: null }),
          };
          return builder;
        },
        update(values) {
          const builder = {
            filters: {},
            eq(col, val) {
              builder.filters[col] = val;
              // recordPermanentDmFailure afslutter på .eq() — clearDmFailureCount
              // kæder videre til .gt().select(), så builderen er også thenable.
              return builder;
            },
            gt(col, val) {
              builder.filters[`${col}>`] = val;
              return builder;
            },
            or(expr) {
              builder.filters.or = expr;
              return builder;
            },
            select() {
              writes.updates.push({ values, filters: builder.filters });
              if (writeError) return Promise.resolve({ data: null, error: writeError });
              // Simulér OR-filteret: rammer rækker med fejlserie ELLER afkoblings-historik.
              const matched =
                (user?.discord_dm_failure_count ?? 0) > 0 || Boolean(user?.discord_disconnected_at);
              return Promise.resolve({ data: matched ? [{ id: user.id }] : [], error: null });
            },
            then(resolve, reject) {
              writes.updates.push({ values, filters: builder.filters });
              return Promise.resolve({ error: writeError }).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
  };
  return { supabase, writes };
}

// ── recordPermanentDmFailure ─────────────────────────────────────────────────

test("første fejl tæller op uden at afkoble", async () => {
  const { supabase, writes } = makeSupabaseMock({ user: { id: "u1", discord_dm_failure_count: 0 } });
  const result = await recordPermanentDmFailure({ supabase, discordId: DISCORD_ID, now: NOW });

  assert.equal(result.count, 1);
  assert.equal(result.disconnected, false);
  assert.deepEqual(writes.updates[0].values, { discord_dm_failure_count: 1 });
});

test("fejl under tærsklen afkobler ikke", async () => {
  const { supabase, writes } = makeSupabaseMock({ user: { id: "u1", discord_dm_failure_count: 1 } });
  const result = await recordPermanentDmFailure({ supabase, discordId: DISCORD_ID, now: NOW });

  assert.equal(result.count, 2);
  assert.equal(result.disconnected, false);
  assert.equal(writes.updates[0].values.discord_id, undefined, "discord_id må IKKE røres før tærsklen");
});

test("tærsklen nås → discord_id nulstilles, tæller nulstilles, tidsstempel sættes", async () => {
  const { supabase, writes } = makeSupabaseMock({
    user: { id: "u1", discord_dm_failure_count: DEAD_CONNECTION_THRESHOLD - 1 },
  });
  const result = await recordPermanentDmFailure({ supabase, discordId: DISCORD_ID, now: NOW });

  assert.equal(result.count, DEAD_CONNECTION_THRESHOLD);
  assert.equal(result.disconnected, true);
  assert.deepEqual(writes.updates[0].values, {
    discord_id: null,
    discord_dm_failure_count: 0,
    discord_disconnected_at: NOW.toISOString(),
  });
  assert.equal(writes.updates[0].filters.id, "u1", "opdateringen skal ramme brugerens id, ikke discord_id");
});

test("ukendt discord_id er ikke en fejl — intet skrives", async () => {
  const { supabase, writes } = makeSupabaseMock({ user: null });
  const result = await recordPermanentDmFailure({ supabase, discordId: DISCORD_ID, now: NOW });

  assert.deepEqual(result, { count: 0, disconnected: false, userId: null });
  assert.equal(writes.updates.length, 0);
});

test("manglende discordId/supabase er et no-op (kaster ikke)", async () => {
  const { supabase } = makeSupabaseMock({ user: { id: "u1", discord_dm_failure_count: 0 } });
  assert.deepEqual(await recordPermanentDmFailure({ supabase, discordId: null }), {
    count: 0, disconnected: false, userId: null,
  });
  assert.deepEqual(await recordPermanentDmFailure({ supabase: null, discordId: DISCORD_ID }), {
    count: 0, disconnected: false, userId: null,
  });
});

test("læsefejl kaster ikke — captures og returnerer error", async () => {
  const captured = [];
  const { supabase, writes } = makeSupabaseMock({ readError: { message: "boom" } });
  const result = await recordPermanentDmFailure({
    supabase, discordId: DISCORD_ID, captureExceptionFn: (err) => captured.push(err.message),
  });

  assert.equal(result.error, "boom");
  assert.equal(result.disconnected, false);
  assert.equal(writes.updates.length, 0);
  assert.match(captured[0], /dead-connection opslag fejlede/);
});

test("skrivefejl rapporteres som IKKE-afkoblet (så UI ikke lyver om tilstanden)", async () => {
  const captured = [];
  const { supabase } = makeSupabaseMock({
    user: { id: "u1", discord_dm_failure_count: DEAD_CONNECTION_THRESHOLD - 1 },
    writeError: { message: "write failed" },
  });
  const result = await recordPermanentDmFailure({
    supabase, discordId: DISCORD_ID, captureExceptionFn: (err) => captured.push(err.message),
  });

  assert.equal(result.disconnected, false, "en fejlet skrivning må ikke rapporteres som afkoblet");
  assert.equal(result.error, "write failed");
  assert.match(captured[0], /dead-connection skrivning fejlede/);
});

test("tærsklen kan overstyres (DI til test)", async () => {
  const { supabase } = makeSupabaseMock({ user: { id: "u1", discord_dm_failure_count: 0 } });
  const result = await recordPermanentDmFailure({ supabase, discordId: DISCORD_ID, threshold: 1, now: NOW });
  assert.equal(result.disconnected, true);
});

// ── clearDmFailureCount ──────────────────────────────────────────────────────

test("leveret DM nulstiller en igangværende fejlserie", async () => {
  const { supabase, writes } = makeSupabaseMock({ user: { id: "u1", discord_dm_failure_count: 2 } });
  const result = await clearDmFailureCount({ supabase, discordId: DISCORD_ID });

  assert.equal(result.reset, true);
  assert.deepEqual(writes.updates[0].values, {
    discord_dm_failure_count: 0,
    discord_disconnected_at: null,
  });
  assert.match(writes.updates[0].filters.or, /discord_dm_failure_count\.gt\.0/, "skal være no-op server-side");
});

// En leveret DM BEVISER at koblingen virker igen. Ryddede vi ikke tidsstemplet,
// ville en spiller der genforbandt og senere selv fjernede sit id se
// genforbind-banneret igen — en besked om noget vi ikke har gjort.
test("leveret DM rydder afkoblings-historikken, også uden fejlserie", async () => {
  const { supabase, writes } = makeSupabaseMock({
    user: { id: "u1", discord_dm_failure_count: 0, discord_disconnected_at: "2026-08-01T10:00:00Z" },
  });
  const result = await clearDmFailureCount({ supabase, discordId: DISCORD_ID });

  assert.equal(result.reset, true);
  assert.equal(writes.updates[0].values.discord_disconnected_at, null);
  assert.match(writes.updates[0].filters.or, /discord_disconnected_at\.not\.is\.null/);
});

test("leveret DM uden fejl eller afkoblings-historik rører ingen rækker", async () => {
  const { supabase } = makeSupabaseMock({
    user: { id: "u1", discord_dm_failure_count: 0, discord_disconnected_at: null },
  });
  const result = await clearDmFailureCount({ supabase, discordId: DISCORD_ID });
  assert.equal(result.reset, false);
});

test("clearDmFailureCount uden discordId er et no-op", async () => {
  const { supabase, writes } = makeSupabaseMock({ user: { id: "u1", discord_dm_failure_count: 2 } });
  assert.deepEqual(await clearDmFailureCount({ supabase, discordId: null }), { reset: false });
  assert.equal(writes.updates.length, 0);
});
