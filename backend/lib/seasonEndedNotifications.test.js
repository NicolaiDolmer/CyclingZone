import test from "node:test";
import assert from "node:assert/strict";

import { emitSeasonEndedNotifications } from "./seasonTransition.js";

// #2745 · in-app season_ended-notifikationer ved sæson-slut.
// `notify` injiceres så vi tester emit-logikken uden DB. Mirror af
// seasonStartedNotifications.test.js (modstykke-funktion, samme kontrakt).

const ENDED_SEASON = { id: "season-uuid-3", number: 3 };

function makeNotifyRecorder(behavior = () => ({ delivered: true })) {
  const calls = [];
  const notify = async (args) => {
    calls.push(args);
    return behavior(args);
  };
  return { notify, calls };
}

test("emit: sender til menneske-managers med user_id, springer rows uden user_id over", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const humanTeams = [
    { id: "t1", user_id: "u1" },
    { id: "t2", user_id: "u2" },
    { id: "t3", user_id: null }, // fx hold uden ejer — skal springes over
  ];

  const stats = await emitSeasonEndedNotifications({
    supabase: {},
    humanTeams,
    endedSeason: ENDED_SEASON,
    notify,
  });

  assert.equal(calls.length, 2, "kun de to managers med user_id notificeres");
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0 });
});

test("emit: korrekt type, related_id og locale-aware metadata-koder", async () => {
  const { notify, calls } = makeNotifyRecorder();

  await emitSeasonEndedNotifications({
    supabase: {},
    humanTeams: [{ id: "t1", user_id: "u1" }],
    endedSeason: ENDED_SEASON,
    notify,
  });

  const call = calls[0];
  assert.equal(call.type, "season_ended");
  assert.equal(call.userId, "u1");
  assert.equal(call.relatedId, "season-uuid-3", "related_id = endedSeason.id → idempotent per sæson");
  assert.equal(call.metadata.titleCode, "notif.seasonEnded.title");
  assert.equal(call.metadata.messageCode, "notif.seasonEnded.message");
  assert.deepEqual(call.metadata.titleParams, { number: 3 });
  assert.deepEqual(call.metadata.messageParams, { number: 3 });
  assert.match(call.title, /Season 3/, "EN-first fallback-title indeholder sæson-nummeret");
  assert.ok(call.message.length > 0, "EN-first fallback-message er sat");
});

test("emit: deduped-svar tælles separat fra delivered (idempotens)", async () => {
  // Simulér at notifyUser's 24t-dedup allerede har leveret til u1.
  const { notify } = makeNotifyRecorder((args) =>
    args.userId === "u1" ? { delivered: false, deduped: true } : { delivered: true },
  );

  const stats = await emitSeasonEndedNotifications({
    supabase: {},
    humanTeams: [
      { id: "t1", user_id: "u1" },
      { id: "t2", user_id: "u2" },
    ],
    endedSeason: ENDED_SEASON,
    notify,
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 1, failed: 0 });
});

test("emit: en fejl pr. manager isoleres og stopper ikke resten", async () => {
  const { notify } = makeNotifyRecorder((args) => {
    if (args.userId === "u1") throw new Error("transient insert error");
    return { delivered: true };
  });

  const stats = await emitSeasonEndedNotifications({
    supabase: {},
    humanTeams: [
      { id: "t1", user_id: "u1" },
      { id: "t2", user_id: "u2" },
    ],
    endedSeason: ENDED_SEASON,
    notify,
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 0, failed: 1 });
});

test("emit: tom humanTeams-liste giver nul-stats uden at hente fra DB", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const stats = await emitSeasonEndedNotifications({
    supabase: {}, // ville kaste hvis emit forsøgte en fetch
    humanTeams: [],
    endedSeason: ENDED_SEASON,
    notify,
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(stats, { eligible: 0, delivered: 0, deduped: 0, failed: 0 });
});

test("emit: henter selv menneske-managere (is_ai=false, is_frozen=false, select user_id) når humanTeams ikke gives", async () => {
  const queryLog = [];
  const supabase = {
    from(table) {
      queryLog.push(["from", table]);
      const builder = {
        select(cols) { queryLog.push(["select", cols]); return builder; },
        eq(col, val) { queryLog.push(["eq", col, val]); return builder; },
        then(resolve) {
          return resolve({ data: [{ user_id: "u1" }, { user_id: "u2" }], error: null });
        },
      };
      return builder;
    },
  };
  const { notify, calls } = makeNotifyRecorder();

  const stats = await emitSeasonEndedNotifications({ supabase, endedSeason: ENDED_SEASON, notify });

  // Diskriminatoren SKAL matche resten af motoren — AI/frosne hold udelukkes.
  assert.deepEqual(queryLog, [
    ["from", "teams"],
    ["select", "user_id"],
    ["eq", "is_ai", false],
    ["eq", "is_frozen", false],
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0 });
});

test("emit: kaster hvis manager-fetch fejler (fejl må ikke svales til tom liste)", async () => {
  const supabase = {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        then: (resolve) => resolve({ data: null, error: { message: "boom" } }),
      };
      return builder;
    },
  };
  await assert.rejects(
    () =>
      emitSeasonEndedNotifications({
        supabase,
        endedSeason: ENDED_SEASON,
        notify: async () => ({ delivered: true }),
      }),
    /Could not load managers/,
  );
});
