import test from "node:test";
import assert from "node:assert/strict";

const { notifyUser, notifyTeamOwner, emitRaceResultNotifications, RACE_RESULT_TYPE } =
  await import("./notificationService.js");

function createNotificationSupabase({
  teams = [],
  existingNotifications = [],
} = {}) {
  const state = {
    teams: teams.map(team => ({ ...team })),
    notifications: existingNotifications.map(notification => ({ ...notification })),
    inserts: [],
    lookups: [],
  };

  return {
    state,
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "user_id");
            return {
              eq(column, value) {
                assert.equal(column, "id");
                return {
                  single() {
                    const team = state.teams.find(candidate => candidate.id === value) || null;
                    return Promise.resolve({ data: team, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "notifications") {
        return {
          select(columns) {
            assert.equal(columns, "id");
            const filters = {};
            return {
              eq(column, value) {
                filters[column] = value;
                return this;
              },
              gte(column, value) {
                filters[column] = value;
                return this;
              },
              is(column, value) {
                filters[column] = value;
                return this;
              },
              order(column, options) {
                assert.equal(column, "created_at");
                assert.deepEqual(options, { ascending: false });
                return this;
              },
              limit(value) {
                assert.equal(value, 1);
                state.lookups.push({ ...filters });
                const data = state.notifications
                  .filter(notification => {
                    if (filters.user_id && notification.user_id !== filters.user_id) return false;
                    if (filters.type && notification.type !== filters.type) return false;
                    if (filters.title && notification.title !== filters.title) return false;
                    if (filters.message && notification.message !== filters.message) return false;
                    if ("related_id" in filters && notification.related_id !== filters.related_id) return false;
                    if (filters.created_at && notification.created_at < filters.created_at) return false;
                    return true;
                  })
                  .slice(0, 1)
                  .map(notification => ({ id: notification.id }));

                return Promise.resolve({ data, error: null });
              },
            };
          },
          insert(payload) {
            state.inserts.push({ ...payload });
            state.notifications.unshift({
              id: `notification-${state.inserts.length}`,
              created_at: "2026-04-22T10:00:00.000Z",
              ...payload,
            });
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("notifyUser skips a recent identical notification payload", async () => {
  const supabase = createNotificationSupabase({
    existingNotifications: [
      {
        id: "notification-1",
        user_id: "user-1",
        type: "board_update",
        title: "⚠️ Negativ saldo",
        message: "Dit hold skylder 120 pts. Renter ved sæsonafslutning: 12 pts",
        related_id: null,
        created_at: "2026-04-22T09:30:00.000Z",
      },
    ],
  });

  const result = await notifyUser({
    supabase,
    userId: "user-1",
    type: "board_update",
    title: "⚠️ Negativ saldo",
    message: "Dit hold skylder 120 pts. Renter ved sæsonafslutning: 12 pts",
    now: new Date("2026-04-22T10:00:00.000Z"),
  });

  assert.deepEqual(result, {
    delivered: false,
    deduped: true,
    reason: "recent_duplicate",
  });
  assert.equal(supabase.state.inserts.length, 0);
});

test("notifyTeamOwner resolves the team owner and inserts a fresh notification", async () => {
  const supabase = createNotificationSupabase({
    teams: [{ id: "team-1", user_id: "user-1" }],
  });

  const result = await notifyTeamOwner({
    supabase,
    teamId: "team-1",
    type: "auction_won",
    title: "Auktion afsluttet",
    message: "Du vandt auktionen",
    relatedId: "auction-1",
    now: new Date("2026-04-22T10:00:00.000Z"),
  });

  assert.deepEqual(result, {
    delivered: true,
    deduped: false,
  });
  assert.deepEqual(supabase.state.inserts, [
    {
      user_id: "user-1",
      type: "auction_won",
      title: "Auktion afsluttet",
      message: "Du vandt auktionen",
      related_id: "auction-1",
    },
  ]);
});

// ─── #1952 · emitRaceResultNotifications ──────────────────────────────────────

function makeRaceNotifyRecorder(behavior = () => ({ delivered: true })) {
  const calls = [];
  const notify = async (args) => {
    calls.push(args);
    return behavior(args);
  };
  return { notify, calls };
}

const RACE = { id: "race-1", name: "Clásica de Prueba" };

test("emitRaceResult: notificerer DISTINCT deltagende managers (dedup'er flere ryttere pr. manager)", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  // u1 har to ryttere i løbet → kun ÉN notifikation; u3=null springes over.
  const fetchParticipatingManagers = async ({ raceId }) => {
    assert.equal(raceId, "race-1");
    return ["u1", "u2", "u1", null];
  };

  const stats = await emitRaceResultNotifications({
    supabase: {},
    race: RACE,
    notify,
    fetchParticipatingManagers,
  });

  assert.equal(calls.length, 2, "kun distinct user_ids notificeres");
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0 });
});

test("emitRaceResult: korrekt type, related_id og locale-aware metadata-koder", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();

  await emitRaceResultNotifications({
    supabase: {},
    race: RACE,
    notify,
    fetchParticipatingManagers: async () => ["u1"],
  });

  const call = calls[0];
  assert.equal(call.type, RACE_RESULT_TYPE);
  assert.equal(call.type, "race_result");
  assert.equal(call.userId, "u1");
  assert.equal(call.relatedId, "race-1", "related_id = race.id → idempotent per løb");
  assert.equal(call.metadata.raceId, "race-1", "metadata bærer raceId til deep-link");
  assert.equal(call.metadata.titleCode, "notif.raceResult.title");
  assert.equal(call.metadata.messageCode, "notif.raceResult.message");
  assert.deepEqual(call.metadata.messageParams, { race: "Clásica de Prueba" });
  assert.ok(call.title.length > 0, "EN-first fallback-title er sat");
  assert.match(call.message, /Clásica de Prueba/, "EN-first fallback-message indeholder løbsnavnet");
});

test("emitRaceResult: deduped tælles separat fra delivered (idempotens)", async () => {
  const { notify } = makeRaceNotifyRecorder((args) =>
    args.userId === "u1" ? { delivered: false, deduped: true } : { delivered: true },
  );

  const stats = await emitRaceResultNotifications({
    supabase: {},
    race: RACE,
    notify,
    fetchParticipatingManagers: async () => ["u1", "u2"],
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 1, failed: 0 });
});

test("emitRaceResult: en fejl pr. manager isoleres og stopper ikke resten", async () => {
  const { notify } = makeRaceNotifyRecorder((args) => {
    if (args.userId === "u1") throw new Error("transient insert error");
    return { delivered: true };
  });

  const stats = await emitRaceResultNotifications({
    supabase: {},
    race: RACE,
    notify,
    fetchParticipatingManagers: async () => ["u1", "u2"],
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 0, failed: 1 });
});

test("emitRaceResult: manglende race.id giver nul-stats uden at hente deltagere", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  let fetched = false;
  const stats = await emitRaceResultNotifications({
    supabase: {},
    race: {},
    notify,
    fetchParticipatingManagers: async () => { fetched = true; return []; },
  });
  assert.equal(fetched, false, "ingen deltager-fetch uden race.id");
  assert.equal(calls.length, 0);
  assert.deepEqual(stats, { eligible: 0, delivered: 0, deduped: 0, failed: 0 });
});
