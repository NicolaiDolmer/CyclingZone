import test from "node:test";
import assert from "node:assert/strict";

import { checkDebtWarnings } from "./cron.js";

/**
 * Regressionstest for #607 — checkDebtWarnings dedup-bypass via dynamic balance.
 *
 * Før fix: message indeholdt `${team.balance}` + `${interest}` → hvis balance ændrede
 * sig mellem 6h cron-ticks, var message-strings forskellige, og notifyUser-dedup
 * (som matcher på userId + type + title + message + related_id) missede.
 *
 * Efter fix: message er statisk → notifyUser-dedup virker per-user-per-24h.
 */

function createSupabaseStub({ teams }) {
  return {
    from(table) {
      if (table === "teams") {
        const filters = {};
        const builder = {
          select() { return builder; },
          eq(column, value) { filters[column] = value; return builder; },
          lt(column, value) { filters[`__lt_${column}`] = value; return builder; },
          then(resolve) {
            const data = teams.filter((row) => {
              if (filters.is_ai !== undefined && row.is_ai !== filters.is_ai) return false;
              if (filters.is_frozen !== undefined && row.is_frozen !== filters.is_frozen) return false;
              if (filters.__lt_balance !== undefined && !(row.balance < filters.__lt_balance)) return false;
              return true;
            });
            return resolve({ data, error: null });
          },
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("checkDebtWarnings — sender notification for hvert team med negativ saldo", async () => {
  const calls = [];
  const supabaseClient = createSupabaseStub({
    teams: [
      { id: "team-1", name: "Alpha", balance: -120, user_id: "user-1", is_ai: false, is_frozen: false },
      { id: "team-2", name: "Beta", balance: -50, user_id: "user-2", is_ai: false, is_frozen: false },
    ],
  });

  await checkDebtWarnings({
    supabaseClient,
    now: new Date("2026-05-24T08:00:00Z"),
    notifyUserFn: async (args) => { calls.push(args); return { delivered: true, deduped: false }; },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].userId, "user-1");
  assert.equal(calls[0].title, "⚠️ Negativ saldo");
  assert.equal(calls[1].userId, "user-2");
});

test("checkDebtWarnings — message er statisk på tværs af forskellige balance-værdier (#607)", async () => {
  const calls = [];
  const notifyUserFn = async (args) => { calls.push(args); return { delivered: true, deduped: false }; };

  // Tick 1 — balance: -120
  const tick1Supabase = createSupabaseStub({
    teams: [{ id: "team-1", name: "Alpha", balance: -120, user_id: "user-1", is_ai: false, is_frozen: false }],
  });
  await checkDebtWarnings({
    supabaseClient: tick1Supabase,
    now: new Date("2026-05-24T08:00:00Z"),
    notifyUserFn,
  });

  // Tick 2 — balance: -5000 (drastisk ændring mellem ticks)
  const tick2Supabase = createSupabaseStub({
    teams: [{ id: "team-1", name: "Alpha", balance: -5000, user_id: "user-1", is_ai: false, is_frozen: false }],
  });
  await checkDebtWarnings({
    supabaseClient: tick2Supabase,
    now: new Date("2026-05-24T14:00:00Z"),
    notifyUserFn,
  });

  // Begge calls SKAL have identisk message — det er hele pointen i fix'et.
  // Hvis message-strings ikke matcher, vil notifyUser-dedup misse → spam.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].message, calls[1].message,
    "message SKAL være identisk mellem ticks så notifyUser-dedup virker (#607)");
  assert.equal(calls[0].title, calls[1].title);
  // Statisk-message-check: ingen tal/balance i strengen
  assert.doesNotMatch(calls[0].message, /\d/,
    "message må ikke indeholde balance-tal — det bryder dedup ved svingende saldo");
});

test("checkDebtWarnings — dedup matcher mellem ticks med varierende balance (#607)", async () => {
  // Simulér notifications-tabel + notifyUser-dedup-logik (samme nøgle som notificationService.js).
  const notifications = [];
  const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
  const notifyUserFn = async ({ userId, type, title, message, relatedId = null, now }) => {
    const since = new Date(now.getTime() - DEDUP_WINDOW_MS);
    const dup = notifications.find((n) =>
      n.user_id === userId &&
      n.type === type &&
      n.title === title &&
      n.message === message &&
      (n.related_id ?? null) === relatedId &&
      new Date(n.created_at) >= since
    );
    if (dup) return { delivered: false, deduped: true, reason: "recent_duplicate" };
    notifications.push({
      user_id: userId, type, title, message, related_id: relatedId,
      created_at: now.toISOString(),
    });
    return { delivered: true, deduped: false };
  };

  // 4 ticks indenfor 24h-vinduet med forskellig balance hver gang (worst-case fra issue).
  const balanceTicks = [-120, -350, -5000, -200];
  for (let i = 0; i < balanceTicks.length; i++) {
    const supabaseClient = createSupabaseStub({
      teams: [{ id: "team-1", name: "Alpha", balance: balanceTicks[i], user_id: "user-1", is_ai: false, is_frozen: false }],
    });
    // Ticks 6h apart, alle indenfor samme 24h dedup-vindue
    await checkDebtWarnings({
      supabaseClient,
      now: new Date(Date.parse("2026-05-24T00:00:00Z") + i * 6 * 60 * 60 * 1000),
      notifyUserFn,
    });
  }

  // KERNE-ASSERT: kun 1 notification skal være sendt på trods af 4 ticks med forskellig saldo.
  assert.equal(notifications.length, 1,
    `Forventede 1 notification efter 4 ticks (dedup-vindue 24h), fik ${notifications.length}. ` +
    `Hvis >1 → dedup-bypass regression (#607).`);
});

test("checkDebtWarnings — skipper AI-teams og frozen teams", async () => {
  const calls = [];
  const supabaseClient = createSupabaseStub({
    teams: [
      { id: "team-1", name: "Human", balance: -120, user_id: "user-1", is_ai: false, is_frozen: false },
      { id: "team-2", name: "AI", balance: -500, user_id: null, is_ai: true, is_frozen: false },
      { id: "team-3", name: "Frozen", balance: -300, user_id: "user-3", is_ai: false, is_frozen: true },
    ],
  });

  await checkDebtWarnings({
    supabaseClient,
    now: new Date("2026-05-24T08:00:00Z"),
    notifyUserFn: async (args) => { calls.push(args); return { delivered: true, deduped: false }; },
  });

  assert.equal(calls.length, 1, "kun human + non-frozen team med negativ saldo skal notificeres");
  assert.equal(calls[0].userId, "user-1");
});

test("checkDebtWarnings — håndterer teams=null/empty uden fejl", async () => {
  const supabaseClient = createSupabaseStub({ teams: [] });
  let called = false;
  await checkDebtWarnings({
    supabaseClient,
    now: new Date("2026-05-24T08:00:00Z"),
    notifyUserFn: async () => { called = true; return { delivered: true, deduped: false }; },
  });
  assert.equal(called, false, "ingen notifyUser-kald når der ikke er teams med gæld");
});
