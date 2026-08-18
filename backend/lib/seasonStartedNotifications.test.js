import test from "node:test";
import assert from "node:assert/strict";

import { emitSeasonStartedNotifications } from "./seasonTransition.js";
import { notifyUser } from "./notificationService.js";

// #1357 + #3101 · in-app season_started-notifikationer ved sæsonskifte, inkl.
// det faktiske sponsorbeløb holdet fik. `notify`/`loadSponsorPayouts`
// injiceres så vi tester emit-logikken uden DB.

const TO_SEASON = { id: "season-uuid-3", number: 3 };

function makeNotifyRecorder(behavior = () => ({ delivered: true })) {
  const calls = [];
  const notify = async (args) => {
    calls.push(args);
    return behavior(args);
  };
  return { notify, calls };
}

function makeSponsorLookup(amountByTeamId = {}) {
  const calls = [];
  const loadSponsorPayouts = async ({ teamIds, seasonId }) => {
    calls.push({ teamIds, seasonId });
    const map = new Map();
    for (const teamId of teamIds) {
      if (Object.prototype.hasOwnProperty.call(amountByTeamId, teamId)) {
        map.set(teamId, amountByTeamId[teamId]);
      }
    }
    return map;
  };
  return { loadSponsorPayouts, calls };
}

test("emit: sender til menneske-managers med user_id, springer rows uden user_id over", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const { loadSponsorPayouts } = makeSponsorLookup();
  const humanTeams = [
    { id: "t1", user_id: "u1" },
    { id: "t2", user_id: "u2" },
    { id: "t3", user_id: null }, // fx hold uden ejer — skal springes over
  ];

  const stats = await emitSeasonStartedNotifications({
    supabase: {},
    humanTeams,
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });

  assert.equal(calls.length, 2, "kun de to managers med user_id notificeres");
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0, failedUserIds: [] });
});

test("emit: korrekt type, related_id og locale-aware metadata-koder (uden kendt sponsorbeløb)", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const { loadSponsorPayouts } = makeSponsorLookup();

  await emitSeasonStartedNotifications({
    supabase: {},
    humanTeams: [{ id: "t1", user_id: "u1" }],
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });

  const call = calls[0];
  assert.equal(call.type, "season_started");
  assert.equal(call.userId, "u1");
  assert.equal(call.relatedId, "season-uuid-3", "related_id = toSeason.id → idempotent per sæson");
  assert.equal(call.metadata.titleCode, "notif.seasonStarted.title");
  assert.equal(call.metadata.messageCode, "notif.seasonStarted.message");
  assert.deepEqual(call.metadata.titleParams, { number: 3 });
  assert.deepEqual(call.metadata.messageParams, { number: 3 });
  assert.match(call.title, /Season 3/, "EN-first fallback-title indeholder sæson-nummeret");
  assert.ok(call.message.length > 0, "EN-first fallback-message er sat");
});

// #3101 · to uafhængige "er sponsorpengene udbetalt?"-spørgsmål (Discord 27/7)
// udsprang af at denne besked aldrig nævnte beløbet.
test("emit #3101: kendt sponsorbeløb → messageWithSponsor-koden + beløbet i EN-fallback-teksten", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const { loadSponsorPayouts, calls: sponsorCalls } = makeSponsorLookup({ t1: 128500 });

  await emitSeasonStartedNotifications({
    supabase: {},
    humanTeams: [{ id: "t1", user_id: "u1" }],
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });

  assert.deepEqual(sponsorCalls, [{ teamIds: ["t1"], seasonId: "season-uuid-3" }]);

  const call = calls[0];
  assert.equal(call.metadata.messageCode, "notif.seasonStarted.messageWithSponsor");
  assert.deepEqual(call.metadata.messageParams, { number: 3, amount: 128500 });
  assert.equal(call.metadata.titleCode, "notif.seasonStarted.title", "titlen er uændret — kun beskeden bærer beløbet");
  assert.match(call.message, /128500 CZ\$/, "EN-fallback-teksten indeholder selve beløbet, ikke kun placeholderen");
});

test("emit #3101: intet sponsorbeløb fundet (fx sæson-1-uberørt-startkapital-gaten) → generisk besked", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const { loadSponsorPayouts } = makeSponsorLookup({}); // t1 mangler helt i finance_transactions

  await emitSeasonStartedNotifications({
    supabase: {},
    humanTeams: [{ id: "t1", user_id: "u1" }],
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });

  const call = calls[0];
  assert.equal(call.metadata.messageCode, "notif.seasonStarted.message");
  assert.deepEqual(call.metadata.messageParams, { number: 3 });
  assert.doesNotMatch(call.message, /CZ\$/, "ingen løgn om et beløb der aldrig blev udbetalt");
});

test("emit #3101: sponsor-opslag fejler → best-effort generisk besked til ALLE, notifikationen svigtes ikke", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const loadSponsorPayouts = async () => {
    throw new Error("finance_transactions query timed out");
  };

  const stats = await emitSeasonStartedNotifications({
    supabase: {},
    humanTeams: [
      { id: "t1", user_id: "u1" },
      { id: "t2", user_id: "u2" },
    ],
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });

  assert.equal(calls.length, 2, "begge managers får stadig deres notifikation");
  for (const call of calls) {
    assert.equal(call.metadata.messageCode, "notif.seasonStarted.message");
  }
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0, failedUserIds: [] });
});

test("emit: deduped-svar tælles separat fra delivered (idempotens)", async () => {
  // Simulér at notifyUser's 24t-dedup allerede har leveret til u1.
  const { notify } = makeNotifyRecorder((args) =>
    args.userId === "u1" ? { delivered: false, deduped: true } : { delivered: true },
  );
  const { loadSponsorPayouts } = makeSponsorLookup();

  const stats = await emitSeasonStartedNotifications({
    supabase: {},
    humanTeams: [
      { id: "t1", user_id: "u1" },
      { id: "t2", user_id: "u2" },
    ],
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 1, failed: 0, failedUserIds: [] });
});

// #3101 · fejl-opsamlingen er det der gør et efter-sende-kald muligt: kald
// emitSeasonStartedNotifications igen med humanTeams begrænset til
// failedUserIds' hold.
test("emit #3101: en fejl pr. manager isoleres, stopper ikke resten, og user_id samles i failedUserIds", async () => {
  const { notify } = makeNotifyRecorder((args) => {
    if (args.userId === "u1") throw new Error("transient insert error");
    return { delivered: true };
  });
  const { loadSponsorPayouts } = makeSponsorLookup();

  const stats = await emitSeasonStartedNotifications({
    supabase: {},
    humanTeams: [
      { id: "t1", user_id: "u1" },
      { id: "t2", user_id: "u2" },
    ],
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 0, failed: 1, failedUserIds: ["u1"] });
});

test("emit: tom humanTeams-liste giver nul-stats uden at hente fra DB", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const sponsorLookupCalled = { value: false };
  const loadSponsorPayouts = async () => {
    sponsorLookupCalled.value = true;
    return new Map();
  };

  const stats = await emitSeasonStartedNotifications({
    supabase: {}, // ville kaste hvis emit forsøgte en fetch
    humanTeams: [],
    toSeason: TO_SEASON,
    notify,
    loadSponsorPayouts,
  });
  assert.equal(calls.length, 0);
  assert.equal(sponsorLookupCalled.value, false, "ingen sponsor-opslag for en tom liste");
  assert.deepEqual(stats, { eligible: 0, delivered: 0, deduped: 0, failed: 0, failedUserIds: [] });
});

test("emit: henter selv menneske-managere (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false, select id+user_id) når humanTeams ikke gives", async () => {
  const queryLog = [];
  const supabase = {
    from(table) {
      queryLog.push(["from", table]);
      const builder = {
        select(cols) { queryLog.push(["select", cols]); return builder; },
        eq(col, val) { queryLog.push(["eq", col, val]); return builder; },
        then(resolve) {
          return resolve({ data: [{ id: "t1", user_id: "u1" }, { id: "t2", user_id: "u2" }], error: null });
        },
      };
      return builder;
    },
  };
  const { notify, calls } = makeNotifyRecorder();
  const { loadSponsorPayouts } = makeSponsorLookup();

  const stats = await emitSeasonStartedNotifications({ supabase, toSeason: TO_SEASON, notify, loadSponsorPayouts });

  // #2832-review (fund 4) · diskriminatoren SKAL matche motorens FULDE
  // kanoniske filter (fx boardWeekendFinalization.js) — AI/bank/frosne/
  // test-konti udelukkes. Den forkortede is_ai/is_frozen-udgave lod
  // test-kontiene ("Test A"/"Test B"/"Test Seller") tælle som eligible.
  // #3101 · "id" tilføjet til select så sponsor-opslaget kan joine på team_id.
  assert.deepEqual(queryLog, [
    ["from", "teams"],
    ["select", "id, user_id"],
    ["eq", "is_ai", false],
    ["eq", "is_bank", false],
    ["eq", "is_frozen", false],
    ["eq", "is_test_account", false],
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0, failedUserIds: [] });
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
      emitSeasonStartedNotifications({
        supabase,
        toSeason: TO_SEASON,
        notify: async () => ({ delivered: true }),
      }),
    /Could not load managers/,
  );
});

// ---------------------------------------------------------------------------
// #3101 · End-to-end idempotens mod den RIGTIGE notifyUser (ikke en stub) —
// beviser at et bevidst re-run (fx for at efter-sende til de 22/156 hold der
// manglede beskeden for S2) aldrig dublerer, fordi beløbet er deterministisk.
// ---------------------------------------------------------------------------

function createIdempotencyTestSupabase({ sponsorAmountByTeamId = {} } = {}) {
  const notifications = [];
  return {
    notifications,
    from(table) {
      if (table === "notifications") {
        const filters = {};
        const builder = {
          select() { return builder; },
          eq(col, val) { filters[col] = val; return builder; },
          is(col, val) { filters[col] = val; return builder; },
          gte(col, val) { filters[col] = val; return builder; },
          order() { return builder; },
          limit() {
            const match = notifications.find((row) =>
              row.user_id === filters.user_id &&
              row.type === filters.type &&
              row.title === filters.title &&
              row.message === filters.message &&
              row.related_id === (filters.related_id ?? null),
            );
            return Promise.resolve({ data: match ? [{ id: match.id }] : [], error: null });
          },
          insert(row) {
            notifications.push({ id: `n${notifications.length + 1}`, ...row });
            return Promise.resolve({ error: null });
          },
        };
        return builder;
      }
      if (table === "finance_transactions") {
        // #3331 · finance_transactions er deny-listed — emit-koden går via
        // fetchAllRowsChunkedIn (chunk .in() + paginér hver chunk med
        // .order()/.range()), så mocken skal understøtte den fulde kæde,
        // ikke kun et bart .in().
        let ids = [];
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          in(col, chunkIds) { ids = chunkIds; return builder; },
          order() { return builder; },
          range(from, to) {
            const rows = ids
              .filter((id) => Object.prototype.hasOwnProperty.call(sponsorAmountByTeamId, id))
              .map((id) => ({ team_id: id, amount: sponsorAmountByTeamId[id] }))
              .slice(from, to + 1);
            return Promise.resolve({ data: rows, error: null });
          },
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("emit #3101 IDEMPOTENS: re-run mod ægte notifyUser giver KUN én notifikations-række pr. hold", async () => {
  const supabase = createIdempotencyTestSupabase({ sponsorAmountByTeamId: { t1: 50000, t2: 75000 } });
  const humanTeams = [
    { id: "t1", user_id: "u1" },
    { id: "t2", user_id: "u2" },
  ];

  const first = await emitSeasonStartedNotifications({
    supabase,
    humanTeams,
    toSeason: TO_SEASON,
    notify: notifyUser,
  });
  assert.deepEqual(first, { eligible: 2, delivered: 2, deduped: 0, failed: 0, failedUserIds: [] });
  assert.equal(supabase.notifications.length, 2);

  // Genkørsel — samme sæson, samme (deterministiske) sponsorbeløb, samme hold.
  const second = await emitSeasonStartedNotifications({
    supabase,
    humanTeams,
    toSeason: TO_SEASON,
    notify: notifyUser,
  });
  assert.deepEqual(second, { eligible: 2, delivered: 0, deduped: 2, failed: 0, failedUserIds: [] });
  assert.equal(supabase.notifications.length, 2, "ingen dublet-rækker efter re-run");
});

test("emit #3101 IDEMPOTENS: efter-sende-mønster — re-run med kun de manglende hold rammer ikke de allerede leverede", async () => {
  const supabase = createIdempotencyTestSupabase({ sponsorAmountByTeamId: { t1: 50000, t2: 75000, t3: 90000 } });
  const allTeams = [
    { id: "t1", user_id: "u1" },
    { id: "t2", user_id: "u2" },
    { id: "t3", user_id: "u3" },
  ];

  // Første kørsel "glemmer" u3 (simulerer de 22/156 manglende hold fra S2).
  await emitSeasonStartedNotifications({
    supabase,
    humanTeams: allTeams.slice(0, 2),
    toSeason: TO_SEASON,
    notify: notifyUser,
  });
  assert.equal(supabase.notifications.length, 2);

  // Efter-sende: kald funktionen igen med KUN det manglende hold.
  const resend = await emitSeasonStartedNotifications({
    supabase,
    humanTeams: [allTeams[2]],
    toSeason: TO_SEASON,
    notify: notifyUser,
  });
  assert.deepEqual(resend, { eligible: 1, delivered: 1, deduped: 0, failed: 0, failedUserIds: [] });
  assert.equal(supabase.notifications.length, 3, "u1/u2 uændret, u3 fik nu sin besked");

  // Og et fuldt re-run af ALLE tre bagefter dubler stadig ikke.
  const full = await emitSeasonStartedNotifications({
    supabase,
    humanTeams: allTeams,
    toSeason: TO_SEASON,
    notify: notifyUser,
  });
  assert.deepEqual(full, { eligible: 3, delivered: 0, deduped: 3, failed: 0, failedUserIds: [] });
  assert.equal(supabase.notifications.length, 3);
});
