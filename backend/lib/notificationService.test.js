import test from "node:test";
import assert from "node:assert/strict";

const {
  notifyUser,
  notifyTeamOwner,
  emitRaceResultNotifications,
  RACE_RESULT_TYPE,
  defaultFetchFirstTimeManagers,
  notifyAndClearWatchlistForRiders,
  WATCHLIST_DEPARTED_TYPE,
  emitStageResultNotifications,
  STAGE_RESULT_TYPE,
  buildScoutReportReadyNotification,
  notifyScoutReportReady,
  SCOUT_REPORT_READY_TYPE,
  buildWelcomeNotification,
  WELCOME_TYPE,
  buildScoutChangedNotification,
  notifyScoutChanged,
  SCOUT_CHANGED_TYPE,
} = await import("./notificationService.js");

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

// ─── #3310 · første-resultat-copy-variant ─────────────────────────────────────

test("emitRaceResultNotifications bruger første-resultat-copy for førstegangs-managere", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  await emitRaceResultNotifications({
    supabase: {},
    race: { id: "race-9", name: "Vuelta a Castilla" },
    notify,
    fetchParticipatingManagers: async () => ["user-first", "user-vet"],
    fetchFirstTimeManagers: async () => new Set(["user-first"]),
  });
  const first = calls.find((c) => c.userId === "user-first");
  const vet = calls.find((c) => c.userId === "user-vet");
  assert.equal(first.metadata.titleCode, "notif.firstRaceResult.title");
  assert.equal(first.metadata.messageCode, "notif.firstRaceResult.message");
  assert.match(first.title, /first race/i);
  assert.match(first.message, /Vuelta a Castilla/);
  assert.equal(first.relatedId, "race-9");
  assert.equal(vet.metadata.titleCode, "notif.raceResult.title");
  assert.equal(vet.title, "Race result is in");
});

// Fixture til defaultFetchFirstTimeManagers: mock af .from("teams").select("id,
// user_id").in("user_id", ...) og .from("race_results").select("team_id")
// .in("team_id", ...).neq("race_id", ...) (samme stil som createNotificationSupabase).
function makeFirstTimeSupabase({ teams = [], otherResults = [], teamsError = null } = {}) {
  return {
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "id, user_id");
            return {
              in(column, values) {
                assert.equal(column, "user_id");
                if (teamsError) return Promise.resolve({ data: null, error: teamsError });
                const data = teams.filter((t) => values.includes(t.user_id));
                return Promise.resolve({ data, error: null });
              },
            };
          },
        };
      }
      if (table === "race_results") {
        return {
          select(columns) {
            assert.equal(columns, "team_id");
            return {
              in(column, values) {
                assert.equal(column, "team_id");
                return {
                  neq(column2, _value2) {
                    assert.equal(column2, "race_id");
                    return {
                      // #3331: defaultFetchFirstTimeManagers now pages via
                      // fetchAllRows, which chains .order() then .range() on
                      // the query builder. Test data is small (< 1 page).
                      order(column3, options) {
                        assert.equal(column3, "id");
                        assert.deepEqual(options, { ascending: true });
                        return {
                          range(_from, _to) {
                            const data = otherResults.filter((r) => values.includes(r.team_id));
                            return Promise.resolve({ data, error: null });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("defaultFetchFirstTimeManagers: manager uden andre resultater er first-timer", async () => {
  const supabase = makeFirstTimeSupabase({
    teams: [{ id: "t1", user_id: "user-first" }, { id: "t2", user_id: "user-vet" }],
    otherResults: [{ team_id: "t2" }],
  });
  const set = await defaultFetchFirstTimeManagers({
    supabase, race: { id: "race-9" }, userIds: ["user-first", "user-vet"],
  });
  assert.deepEqual([...set], ["user-first"]);
});

test("defaultFetchFirstTimeManagers: fejl → tomt sæt (alle får standard-copy)", async () => {
  const supabase = makeFirstTimeSupabase({ teamsError: new Error("boom") });
  const set = await defaultFetchFirstTimeManagers({
    supabase, race: { id: "race-9" }, userIds: ["u1"],
  });
  assert.equal(set.size, 0);
});

// ─── #2524 · notifyAndClearWatchlistForRiders ─────────────────────────────────

function createWatchlistSupabase({ watchlist = [] } = {}) {
  const state = { watchlist: watchlist.map((w) => ({ ...w })) };
  return {
    state,
    from(table) {
      if (table !== "rider_watchlist") throw new Error(`Unexpected table: ${table}`);
      return {
        select(columns) {
          assert.equal(columns, "id, user_id, rider_id");
          return {
            in(column, ids) {
              assert.equal(column, "rider_id");
              const data = state.watchlist
                .filter((w) => ids.includes(w.rider_id))
                .map((w) => ({ ...w }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
        delete() {
          return {
            in(column, ids) {
              assert.equal(column, "rider_id");
              const toDelete = state.watchlist.filter((w) => ids.includes(w.rider_id));
              state.watchlist = state.watchlist.filter((w) => !ids.includes(w.rider_id));
              return {
                select(col) {
                  assert.equal(col, "id");
                  return Promise.resolve({ data: toDelete.map((w) => ({ id: w.id })), error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

function makeWatchlistNotifyRecorder(behavior = () => ({ delivered: true })) {
  const calls = [];
  const notify = async (args) => {
    calls.push(args);
    return behavior(args);
  };
  return { notify, calls };
}

test("notifyAndClearWatchlistForRiders: no-op for ryttere uden ønskeliste-rækker", async () => {
  const supabase = createWatchlistSupabase({ watchlist: [] });
  const { notify, calls } = makeWatchlistNotifyRecorder();

  const stats = await notifyAndClearWatchlistForRiders({
    supabase,
    riders: [{ id: "rider-1", firstname: "Tadej", lastname: "Pogačar" }],
    notify,
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(stats, { riders: 1, watchers: 0, delivered: 0, deduped: 0, failed: 0, cleared: 0 });
});

test("notifyAndClearWatchlistForRiders: notificerer hver watcher + rydder rækken", async () => {
  const supabase = createWatchlistSupabase({
    watchlist: [
      { id: "wl-1", user_id: "user-1", rider_id: "rider-1" },
      { id: "wl-2", user_id: "user-2", rider_id: "rider-1" },
    ],
  });
  const { notify, calls } = makeWatchlistNotifyRecorder();

  const stats = await notifyAndClearWatchlistForRiders({
    supabase,
    riders: [{ id: "rider-1", firstname: "Tadej", lastname: "Pogačar" }],
    notify,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.userId).sort(),
    ["user-1", "user-2"],
  );
  const call = calls[0];
  assert.equal(call.type, WATCHLIST_DEPARTED_TYPE);
  assert.equal(call.type, "watchlist_departed");
  assert.equal(call.relatedId, "rider-1");
  assert.equal(call.metadata.riderId, "rider-1");
  assert.equal(call.metadata.titleCode, "notif.watchlistDeparted.title");
  assert.equal(call.metadata.messageCode, "notif.watchlistDeparted.message");
  assert.deepEqual(call.metadata.messageParams, { rider: "Tadej Pogačar" });
  assert.match(call.message, /Tadej Pogačar/, "EN-first fallback-message indeholder rytternavnet");

  assert.deepEqual(stats, { riders: 1, watchers: 2, delivered: 2, deduped: 0, failed: 0, cleared: 2 });
  assert.deepEqual(supabase.state.watchlist, [], "rider_watchlist-rækken er ryddet");
});

test("notifyAndClearWatchlistForRiders: en fejlende notifikation isoleres og stopper ikke oprydningen", async () => {
  const supabase = createWatchlistSupabase({
    watchlist: [
      { id: "wl-1", user_id: "user-1", rider_id: "rider-1" },
      { id: "wl-2", user_id: "user-2", rider_id: "rider-1" },
    ],
  });
  const { notify } = makeWatchlistNotifyRecorder((args) => {
    if (args.userId === "user-1") throw new Error("transient insert error");
    return { delivered: true };
  });

  const stats = await notifyAndClearWatchlistForRiders({
    supabase,
    riders: [{ id: "rider-1", firstname: "Tadej", lastname: "Pogačar" }],
    notify,
  });

  assert.deepEqual(stats, { riders: 1, watchers: 2, delivered: 1, deduped: 0, failed: 1, cleared: 2 });
  assert.deepEqual(supabase.state.watchlist, [], "rydder stadig watchlist selvom én notifikation fejlede");
});

test("notifyAndClearWatchlistForRiders: deduped tælles separat fra delivered", async () => {
  const supabase = createWatchlistSupabase({
    watchlist: [{ id: "wl-1", user_id: "user-1", rider_id: "rider-1" }],
  });
  const { notify } = makeWatchlistNotifyRecorder(() => ({ delivered: false, deduped: true }));

  const stats = await notifyAndClearWatchlistForRiders({
    supabase,
    riders: [{ id: "rider-1", firstname: "Tadej", lastname: "Pogačar" }],
    notify,
  });

  assert.deepEqual(stats, { riders: 1, watchers: 1, delivered: 0, deduped: 1, failed: 0, cleared: 1 });
});

test("notifyAndClearWatchlistForRiders: tom rider-liste er no-op (ingen supabase-kald)", async () => {
  const stats = await notifyAndClearWatchlistForRiders({ supabase: {}, riders: [] });
  assert.deepEqual(stats, { riders: 0, watchers: 0, delivered: 0, deduped: 0, failed: 0, cleared: 0 });
});

// ─── #2523 · emitStageResultNotifications ──────────────────────────────────────

const RACE_2 = { id: "race-2", name: "Tour du Tyrol" };

test("#2523 emitStageResult: notificerer bedste rytter pr. manager (LAVEST rank vinder ved flere ryttere)", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  const fetchStageParticipants = async ({ raceId, stageNumber }) => {
    assert.equal(raceId, "race-2");
    assert.equal(stageNumber, 2);
    return [
      { userId: "u1", rank: 5, riderName: "Rider A" },
      { userId: "u1", rank: 2, riderName: "Rider B" }, // bedre placering — vinder
      { userId: "u2", rank: 1, riderName: "Rider C" },
    ];
  };

  const stats = await emitStageResultNotifications({
    supabase: {}, race: RACE_2, stageNumber: 2, totalStages: 5, notify, fetchStageParticipants,
  });

  assert.equal(calls.length, 2, "kun distinct managers notificeres");
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0 });

  const u1Call = calls.find((c) => c.userId === "u1");
  assert.equal(u1Call.type, STAGE_RESULT_TYPE);
  assert.equal(u1Call.type, "stage_result");
  assert.equal(u1Call.relatedId, "race-2");
  assert.match(u1Call.message, /Rider B/, "bedste (laveste rank) rytter vises, ikke den første i listen");
  assert.match(u1Call.message, /position 2/);
  assert.match(u1Call.message, /Stage 2 of Tour du Tyrol is done/);
  assert.equal(u1Call.metadata.stageNumber, 2);
  assert.equal(u1Call.metadata.totalStages, 5);
  assert.equal(u1Call.metadata.titleCode, "notif.stageResult.title");
  assert.equal(u1Call.metadata.messageCode, "notif.stageResult.message");
  assert.deepEqual(u1Call.metadata.messageParams, { stage: 2, race: "Tour du Tyrol", rider: "Rider B", position: 2 });
});

test("#2523 emitStageResult: manager uden ryttere i DENNE etape optræder ikke i deltager-listen (ingen fejl/tom-besked)", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  // u2 abandonede tidligere og har derfor INGEN 'stage'-række i denne etape.
  const stats = await emitStageResultNotifications({
    supabase: {}, race: RACE_2, stageNumber: 3, totalStages: 5, notify,
    fetchStageParticipants: async () => [{ userId: "u1", rank: 4, riderName: "Rider A" }],
  });
  assert.equal(calls.length, 1, "kun u1 (den eneste med et stage-resultat) notificeres");
  assert.deepEqual(stats, { eligible: 1, delivered: 1, deduped: 0, failed: 0 });
});

test("#2523 emitStageResult: rækker uden userId (null team_id-join) ignoreres", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  const stats = await emitStageResultNotifications({
    supabase: {}, race: RACE_2, stageNumber: 1, totalStages: 3, notify,
    fetchStageParticipants: async () => [{ userId: null, rank: 1, riderName: "AI Rider" }],
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(stats, { eligible: 0, delivered: 0, deduped: 0, failed: 0 });
});

test("#2523 emitStageResult: deduped tælles separat fra delivered", async () => {
  const { notify } = makeRaceNotifyRecorder((args) =>
    args.userId === "u1" ? { delivered: false, deduped: true } : { delivered: true },
  );
  const stats = await emitStageResultNotifications({
    supabase: {}, race: RACE_2, stageNumber: 1, totalStages: 3, notify,
    fetchStageParticipants: async () => [
      { userId: "u1", rank: 1, riderName: "Rider A" },
      { userId: "u2", rank: 2, riderName: "Rider B" },
    ],
  });
  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 1, failed: 0 });
});

test("#2523 emitStageResult: en fejl pr. manager isoleres og stopper ikke resten", async () => {
  const { notify } = makeRaceNotifyRecorder((args) => {
    if (args.userId === "u1") throw new Error("transient insert error");
    return { delivered: true };
  });
  const stats = await emitStageResultNotifications({
    supabase: {}, race: RACE_2, stageNumber: 1, totalStages: 3, notify,
    fetchStageParticipants: async () => [
      { userId: "u1", rank: 1, riderName: "Rider A" },
      { userId: "u2", rank: 2, riderName: "Rider B" },
    ],
  });
  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 0, failed: 1 });
});

test("#2523 emitStageResult: manglende race.id eller stageNumber giver nul-stats uden fetch", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  let fetched = false;
  const fetchStageParticipants = async () => { fetched = true; return []; };

  const statsNoRace = await emitStageResultNotifications({
    supabase: {}, race: {}, stageNumber: 1, totalStages: 3, notify, fetchStageParticipants,
  });
  assert.equal(fetched, false);
  assert.deepEqual(statsNoRace, { eligible: 0, delivered: 0, deduped: 0, failed: 0 });

  const statsNoStage = await emitStageResultNotifications({
    supabase: {}, race: RACE_2, stageNumber: null, totalStages: 3, notify, fetchStageParticipants,
  });
  assert.equal(fetched, false);
  assert.deepEqual(statsNoStage, { eligible: 0, delivered: 0, deduped: 0, failed: 0 });
  assert.equal(calls.length, 0);
});

// ─── #2945 · buildScoutReportReadyNotification + notifyScoutReportReady ──────

test("buildScoutReportReadyNotification (target): korrekt type, related_id, riderId-metadata + i18n-koder", () => {
  const assignment = { id: "as-1", team_id: "team-1", kind: "target", rider_id: "rider-1", target_level: 2 };
  const payload = buildScoutReportReadyNotification({ assignment, riderName: "Tadej Pogačar" });

  assert.equal(payload.type, SCOUT_REPORT_READY_TYPE);
  assert.equal(payload.type, "scout_report_ready");
  assert.equal(payload.relatedId, "as-1", "related_id = assignment.id → idempotent per rapport");
  assert.equal(payload.metadata.riderId, "rider-1", "riderId sat → frontend deep-linker til rytterprofilen (#1486)");
  assert.equal(payload.metadata.kind, "target");
  assert.equal(payload.metadata.level, 2);
  assert.equal(payload.metadata.titleCode, "notif.scoutReportReady.target.title");
  assert.equal(payload.metadata.messageCode, "notif.scoutReportReady.target.message");
  assert.deepEqual(payload.metadata.messageParams, { rider: "Tadej Pogačar", level: 2 });
  assert.match(payload.message, /Tadej Pogačar/, "EN-first fallback-message indeholder rytternavnet");
  assert.match(payload.message, /level 2/);
});

test("buildScoutReportReadyNotification (target): manglende riderName falder tilbage til generisk EN-tekst", () => {
  const assignment = { id: "as-2", team_id: "team-1", kind: "target", rider_id: "rider-2", target_level: 1 };
  const payload = buildScoutReportReadyNotification({ assignment, riderName: null });
  assert.match(payload.message, /the rider/);
  assert.deepEqual(payload.metadata.messageParams, { rider: "the rider", level: 1 });
});

test("buildScoutReportReadyNotification (mission): ingen riderId-metadata → frontend falder tilbage til /scouting", () => {
  const assignment = {
    id: "m-1", team_id: "team-1", kind: "mission",
    result: { shortlist: ["r1", "r2", "r3"], top_rider_id: "r1" },
  };
  const payload = buildScoutReportReadyNotification({ assignment });

  assert.equal(payload.type, "scout_report_ready");
  assert.equal(payload.relatedId, "m-1");
  assert.equal(payload.metadata.riderId, undefined, "mission har intet riderId — link falder tilbage til config.link");
  assert.equal(payload.metadata.kind, "mission");
  assert.equal(payload.metadata.shortlistCount, 3);
  assert.equal(payload.metadata.titleCode, "notif.scoutReportReady.mission.title");
  assert.equal(payload.metadata.messageCode, "notif.scoutReportReady.mission.messageMulti");
  assert.match(payload.message, /found 3 riders/);
});

test("buildScoutReportReadyNotification (mission): entals-variant ved præcis 1 rytter i shortlisten", () => {
  const assignment = { id: "m-2", team_id: "team-1", kind: "mission", result: { shortlist: ["r1"], top_rider_id: "r1" } };
  const payload = buildScoutReportReadyNotification({ assignment });
  assert.equal(payload.metadata.messageCode, "notif.scoutReportReady.mission.messageSingle");
  assert.match(payload.message, /found 1 rider\. /);
});

test("buildScoutReportReadyNotification (mission): tom shortlist → messageEmpty, ingen '0 riders'-tekst", () => {
  const assignment = { id: "m-3", team_id: "team-1", kind: "mission", result: { shortlist: [], top_rider_id: null } };
  const payload = buildScoutReportReadyNotification({ assignment });
  assert.equal(payload.metadata.messageCode, "notif.scoutReportReady.mission.messageEmpty");
  assert.match(payload.message, /No matching riders/);
});

test("notifyScoutReportReady: leverer via notifyTeamOwner (teamId → user_id-opslag)", async () => {
  const supabase = createNotificationSupabase({ teams: [{ id: "team-1", user_id: "user-1" }] });
  const assignment = { id: "as-1", team_id: "team-1", kind: "target", rider_id: "rider-1", target_level: 1 };
  const fetchRiderName = async () => "Wout van Aert";

  const result = await notifyScoutReportReady({ supabase, assignment, fetchRiderName });
  assert.deepEqual(result, { delivered: true, deduped: false });
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].user_id, "user-1");
  assert.equal(supabase.state.inserts[0].type, "scout_report_ready");
  assert.equal(supabase.state.inserts[0].related_id, "as-1");
});

// #2945 accept-kriterium: "en rapport må aldrig give to notifikationer".
test("notifyScoutReportReady: IDEMPOTENS — samme assignment kaldt to gange giver KUN én notifikations-række (dedup)", async () => {
  const supabase = createNotificationSupabase({ teams: [{ id: "team-1", user_id: "user-1" }] });
  const assignment = { id: "as-1", team_id: "team-1", kind: "target", rider_id: "rider-1", target_level: 2 };
  const fetchRiderName = async () => "Tadej Pogačar";

  // Simulerer en dobbeltkørsel af SAMME assignment (fx en genkørt cron-tick, eller
  // et race mellem lazy-completion og natsweepet der begge forsøger at fuldføre
  // den samme række) — samme related_id (assignment.id) + samme besked.
  // NB: createNotificationSupabase's insert() hardcoder created_at til
  // "2026-04-22T10:00:00.000Z" (samme mock som resten af filens dedup-test) —
  // `now` skal derfor ligge inden for 24t af DEN dato, ikke den faktiske #2945-dato.
  const first = await notifyScoutReportReady({
    supabase, assignment, fetchRiderName, now: new Date("2026-04-22T10:00:00.000Z"),
  });
  assert.deepEqual(first, { delivered: true, deduped: false });

  const second = await notifyScoutReportReady({
    supabase, assignment, fetchRiderName, now: new Date("2026-04-22T10:05:00.000Z"),
  });
  assert.deepEqual(second, { delivered: false, deduped: true, reason: "recent_duplicate" });

  assert.equal(supabase.state.inserts.length, 1, "ingen ekstra notifikations-række ved dedup");
});

test("notifyScoutReportReady: to FORSKELLIGE ryttere/assignments dedup'er IKKE mod hinanden", async () => {
  const supabase = createNotificationSupabase({ teams: [{ id: "team-1", user_id: "user-1" }] });
  const fetchRiderName = async ({ riderId }) => (riderId === "rider-1" ? "Tadej Pogačar" : "Wout van Aert");

  await notifyScoutReportReady({
    supabase, fetchRiderName,
    assignment: { id: "as-1", team_id: "team-1", kind: "target", rider_id: "rider-1", target_level: 1 },
  });
  await notifyScoutReportReady({
    supabase, fetchRiderName,
    assignment: { id: "as-2", team_id: "team-1", kind: "target", rider_id: "rider-2", target_level: 1 },
  });

  assert.equal(supabase.state.inserts.length, 2, "forskellig related_id (assignment.id) → begge leveres");
});

test("notifyScoutReportReady: manglende assignment.id/team_id er et no-op (missing_assignment)", async () => {
  const supabase = createNotificationSupabase();
  const result = await notifyScoutReportReady({ supabase, assignment: { kind: "target" } });
  assert.deepEqual(result, { delivered: false, deduped: false, reason: "missing_assignment" });
  assert.equal(supabase.state.inserts.length, 0);
});

test("notifyScoutReportReady: en fejlende fetchRiderName isoleres (fanges, kaster ikke) — rapport-fuldførelsen må aldrig væltes", async () => {
  const supabase = createNotificationSupabase({ teams: [{ id: "team-1", user_id: "user-1" }] });
  const assignment = { id: "as-1", team_id: "team-1", kind: "target", rider_id: "rider-1", target_level: 1 };
  const fetchRiderName = async () => { throw new Error("boom"); };

  const result = await notifyScoutReportReady({ supabase, assignment, fetchRiderName });
  assert.deepEqual(result, { delivered: false, deduped: false, reason: "error" });
  assert.equal(supabase.state.inserts.length, 0);
});

// ─── Gab 2 (#2822) · buildWelcomeNotification ─────────────────────────────

test("buildWelcomeNotification: korrekt type, ingen related_id, i18n-koder + EN-first fallback-tekst", () => {
  const payload = buildWelcomeNotification();

  assert.equal(payload.type, WELCOME_TYPE);
  assert.equal(payload.type, "welcome");
  assert.equal(payload.relatedId, null, "ikke knyttet til nogen specifik entitet");
  assert.equal(payload.metadata.titleCode, "notif.welcome.title");
  assert.equal(payload.metadata.messageCode, "notif.welcome.message");
  assert.match(payload.title, /Welcome/i);
  assert.match(payload.message, /auction house/i);
});

test("buildWelcomeNotification + notifyTeamOwner: leverer via teamId → user_id-opslag (samme sti som route-handleren bruger)", async () => {
  const supabase = createNotificationSupabase({ teams: [{ id: "team-1", user_id: "user-1" }] });
  const payload = buildWelcomeNotification();

  const result = await notifyTeamOwner({ supabase, teamId: "team-1", ...payload });
  assert.deepEqual(result, { delivered: true, deduped: false });
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].user_id, "user-1");
  assert.equal(supabase.state.inserts[0].type, "welcome");
  assert.equal(supabase.state.inserts[0].related_id, null);
});

// ─── #3334 · buildScoutChangedNotification + notifyScoutChanged ──────────────

test("buildScoutChangedNotification: korrekt type, ingen related_id, i18n-koder + eksplicit 'stats uændret'-tekst", () => {
  const payload = buildScoutChangedNotification({ scoutName: "Kim Andersen", scoutTier: 3 });

  assert.equal(payload.type, SCOUT_CHANGED_TYPE);
  assert.equal(payload.type, "scout_changed");
  assert.equal(payload.relatedId, null, "ikke knyttet til én bestemt rytter/rapport");
  assert.equal(payload.metadata.titleCode, "notif.scoutChanged.title");
  assert.equal(payload.metadata.messageCode, "notif.scoutChanged.message");
  assert.equal(payload.metadata.scoutName, "Kim Andersen");
  assert.equal(payload.metadata.scoutTier, 3);
  assert.match(payload.message, /Kim Andersen/);
  assert.match(payload.message, /recalculated/i);
  // #2798 potentiale-lækage-forebyggelse: teksten må ALDRIG nævne rytterens
  // potentiale eller loft — kun at rapporten genberegnes og evnerne er uændrede.
  assert.doesNotMatch(payload.message, /potential|ceiling/i);
  assert.match(payload.message, /abilities have not changed/i);
});

test("buildScoutChangedNotification: manglende scoutTier falder tilbage til tier-fri tekst (default-spejder-kant)", () => {
  const payload = buildScoutChangedNotification({ scoutName: "Kim Andersen", scoutTier: null });
  assert.doesNotMatch(payload.message, /tier null/i);
  assert.match(payload.message, /Kim Andersen/);
});

test("notifyScoutChanged: leverer via notifyTeamOwner (teamId → user_id-opslag)", async () => {
  const supabase = createNotificationSupabase({ teams: [{ id: "team-1", user_id: "user-1" }] });
  const result = await notifyScoutChanged({ supabase, teamId: "team-1", scoutName: "Kim Andersen", scoutTier: 3 });
  assert.deepEqual(result, { delivered: true, deduped: false });
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].user_id, "user-1");
  assert.equal(supabase.state.inserts[0].type, "scout_changed");
});

test("notifyScoutChanged: manglende teamId er et no-op (missing_team), kaster ikke", async () => {
  const supabase = createNotificationSupabase();
  const result = await notifyScoutChanged({ supabase, teamId: null, scoutName: "X", scoutTier: 1 });
  assert.deepEqual(result, { delivered: false, deduped: false, reason: "missing_team" });
});

test("notifyScoutChanged: en fejlende notify isoleres (fanges, kaster ikke) — hire-flowet må aldrig væltes", async () => {
  const supabase = createNotificationSupabase();
  const notify = async () => { throw new Error("boom"); };
  const result = await notifyScoutChanged({ supabase, teamId: "team-1", scoutName: "X", scoutTier: 1, notify });
  assert.deepEqual(result, { delivered: false, deduped: false, reason: "error" });
});
