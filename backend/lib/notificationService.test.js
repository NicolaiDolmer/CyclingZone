import test from "node:test";
import assert from "node:assert/strict";

const { notifyUser, notifyTeamOwner } = await import("./notificationService.js");

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
