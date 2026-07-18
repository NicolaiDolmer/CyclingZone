import test from "node:test";
import assert from "node:assert/strict";

import { resolveDmTargetFromInput } from "./discordDmTarget.js";
import { notifyBoardUpdateDM, notifyAuctionWon, notifyDiscordDM, notifyPlayerFeedback } from "./discordNotifier.js";
import { flushDmRunGuard, __resetDmRunGuardForTests } from "./discordDmRateGuard.js";

function makeCaptureSpy() {
  const calls = [];
  const fn = (error, context) => calls.push({ error, context });
  fn.calls = calls;
  return fn;
}

// Minimal fake Supabase query builder keyed by userId, same shape as
// discordDmRecipient.test.js's fakeClient — .from("users").select().eq("id",
// uid).single() -> { data }. "teams" is never hit in these tests (no teamId
// passed), so it just returns null harmlessly if it were.
function fakeUsersClient(usersByUid) {
  return {
    from(table) {
      let matchId;
      const builder = {
        select() { return builder; },
        eq(_col, value) { matchId = value; return builder; },
        async single() {
          if (table === "users") return { data: usersByUid[matchId] ?? null };
          return { data: null };
        },
      };
      return builder;
    },
  };
}

// #203: DM-routing-logik. Pure function — tester valg af target uden Supabase.
test("resolveDmTargetFromInput — test-konto tvinger stdout uanset env", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: undefined, isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "webhook", isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "test-channel", isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "stdout", isTestAccount: true }), "stdout");
});

test("resolveDmTargetFromInput — ægte manager respekterer env-var", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: undefined, isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "webhook", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "stdout", isTestAccount: false }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "test-channel", isTestAccount: false }), "test-channel");
});

test("resolveDmTargetFromInput — ukendt env-værdi falder tilbage til webhook (bagudkompat)", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: "bogus", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: null, isTestAccount: false }), "webhook");
});

// #2602: in-game feedback-knap — Discord-mirror er guarded af
// DISCORD_FEEDBACK_WEBHOOK_URL og må ALDRIG falde tilbage til default-webhooken
// (i modsætning til getOpsWebhookUrl), da spillerfeedback er umodereret fritekst
// og ikke må lække ind i en offentlig kanal ved et uheld.
test("notifyPlayerFeedback — no-op (sender intet) når DISCORD_FEEDBACK_WEBHOOK_URL ikke er sat", async () => {
  const original = process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
  delete process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
  try {
    const calls = [];
    await notifyPlayerFeedback({
      category: "bug",
      message: "Something broke",
      pagePath: "/team",
      teamName: "Team CSC",
      sendWebhookFn: async (...args) => calls.push(args),
    });
    assert.equal(calls.length, 0);
  } finally {
    if (original !== undefined) process.env.DISCORD_FEEDBACK_WEBHOOK_URL = original;
  }
});

test("notifyPlayerFeedback — poster embed til DISCORD_FEEDBACK_WEBHOOK_URL når sat", async () => {
  const original = process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
  process.env.DISCORD_FEEDBACK_WEBHOOK_URL = "https://discord.com/api/webhooks/test/feedback";
  try {
    const calls = [];
    await notifyPlayerFeedback({
      category: "bug",
      message: "Something broke",
      pagePath: "/team",
      teamName: "Team CSC",
      sendWebhookFn: async (...args) => calls.push(args),
    });
    assert.equal(calls.length, 1);
    const [url, payload] = calls[0];
    assert.equal(url, "https://discord.com/api/webhooks/test/feedback");
    const embed = payload.embeds[0];
    assert.match(embed.title, /Bug report/);
    assert.equal(embed.description, "Something broke");
    assert.deepEqual(embed.fields, [
      { name: "Team", value: "Team CSC" },
      { name: "Page", value: "/team" },
    ]);
  } finally {
    if (original === undefined) delete process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
    else process.env.DISCORD_FEEDBACK_WEBHOOK_URL = original;
  }
});

// #2569: board-cronsene kalder notifyBoardUpdateDM({ userId }). Tog signaturen
// kun teamId, blev userId droppet tavst og HVER bestyrelses-DM døde i
// [discord-dm:no-recipient] — uden Sentry-capture. Guarden asserter at begge
// identifikatorer når notifyDiscordDM.
test("notifyBoardUpdateDM — userId føres videre til notifyDiscordDM (#2569)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    userId: "user-1",
    type: "board_critical",
    title: "The Board Is Unhappy",
    description: "Satisfaction is down.",
    notifyFn: async (args) => { calls.push(args); },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "user-1");
  assert.equal(calls[0].type, "board_critical");
  assert.equal(calls[0].title, "The Board Is Unhappy");
});

test("notifyBoardUpdateDM — teamId virker stadig + default-type er board_update (#2569)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    teamId: "team-1",
    title: "Board Update",
    description: "Plan accepted.",
    notifyFn: async (args) => { calls.push(args); },
  });

  assert.equal(calls[0].teamId, "team-1");
  assert.equal(calls[0].userId, null);
  assert.equal(calls[0].type, "board_update");
});

// #2571: notifyBoardUpdateDM er i produktionen KUN kaldt fra cron.js (board
// auto-accept + mid-season review). Default cronRun:true fodrer no-recipient-
// rate-guarden uden at hvert kald skal huske flaget; caller kan stadig
// override'e det eksplicit.
test("notifyBoardUpdateDM — cronRun default er true, føres videre til notifyFn (#2571)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    userId: "user-1",
    type: "board_update",
    title: "Board Update",
    description: "Plan accepted.",
    notifyFn: async (args) => { calls.push(args); },
  });

  assert.equal(calls[0].cronRun, true);
});

test("notifyBoardUpdateDM — cronRun kan overrides eksplicit (#2571)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    userId: "user-1",
    type: "board_update",
    title: "Board Update",
    description: "Plan accepted.",
    notifyFn: async (args) => { calls.push(args); },
    cronRun: false,
  });

  assert.equal(calls[0].cronRun, false);
});

// #2571: notifyAuctionWon har to kaldere (cron.js' finalizer-tick + admin-
// request-scopet /finalize). Default cronRun:false (ikke sat) sikrer at KUN
// cron.js' eksplicitte cronRun:true kan fodre rate-guarden — bruger vi
// teamId:null rammer notifyDiscordDM den DB-fri no-recipient-gren
// (resolveDmRecipient returnerer null uden query når både teamId og userId
// mangler), så testen kører uden Supabase.
test("notifyAuctionWon — cronRun default false rører aldrig rate-guarden (#2571)", async () => {
  __resetDmRunGuardForTests();
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 3; i++) {
    await notifyAuctionWon({ riderName: "Rider", finalPrice: 1000, teamId: null });
    flushDmRunGuard(["auction_won"], { captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 0);
});

test("notifyAuctionWon — cronRun:true fodrer rate-guarden og capturer efter 3 all-skipped kørsler (#2571)", async () => {
  __resetDmRunGuardForTests();
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 3; i++) {
    await notifyAuctionWon({ riderName: "Rider", finalPrice: 1000, teamId: null, cronRun: true });
    flushDmRunGuard(["auction_won"], { captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 1);
  assert.deepEqual(captureExceptionFn.calls[0].context.fingerprint, ["discord-dm-all-skipped", "auction_won"]);
});

// #2571 post-merge-review (adversarisk gennemgang af #2609): recordDmAttempt
// blev talt FØR per-type-mute-tjekket og FØR selve sendDM-forsøget. Konsekvens
// i en blandet population: muted brugere talte som "leveret", hvilket udvander
// no-recipient-skip-raten væk fra 100% — guarden mod #2569-klassen ("alt
// fejler tavst") kunne derfor gå under radaren, selv når ALLE reelt
// afsendelige DM'er fejlede, blot fordi én bruger i kørslen havde muted typen.
//
// Denne test kører notifyDiscordDM (den ægte funktion, ikke notifyFn-stubbet)
// via en injiceret fake Supabase-client, og blander tre kategorier pr.
// "cron-kørsel":
//   - 2 muted brugere (per-type-toggle off) — må IKKE tælle med i det hele taget.
//   - 1 reel no-recipient (mangler discord_id) — skal tælle som skip (uændret).
//   - 1 reel modtager hvor selve sendDM fejler (intet bot-token i env) — skal
//     tælle som skip, IKKE som leveret (#2571(b)-fixet).
// Skip-raten blandt de REELLE forsøg (2 af 4 pr. kørsel) skal stadig ramme
// 100% og udløse sentryCapture efter 3 kørsler i træk.
test("notifyDiscordDM — muted tælles ikke med, sendDM-fejl tælles som skip, blandet population rammer stadig 100%-tærsklen (#2571)", async () => {
  __resetDmRunGuardForTests();
  const captureExceptionFn = makeCaptureSpy();

  // Fjern bot-token deterministisk så sendDM's "intet token"-gren rammes uden
  // netværkskald eller outbox-skrivning, uanset hvad lokal backend/.env har.
  const savedBotToken = process.env.DISCORD_BOT_TOKEN;
  const savedToken = process.env.DISCORD_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_TOKEN;

  try {
    const client = fakeUsersClient({
      "muted-1": { discord_id: "d-muted-1", discord_dm_enabled: true, discord_dm_prefs: { board_update: false } },
      "muted-2": { discord_id: "d-muted-2", discord_dm_enabled: true, discord_dm_prefs: { board_update: false } },
      "real-1": { discord_id: "d-real-1", discord_dm_enabled: true, discord_dm_prefs: {} },
      "no-recipient-1": { discord_id: null, discord_dm_enabled: true, discord_dm_prefs: {} },
    });

    async function runOneCronTick() {
      for (const userId of ["muted-1", "muted-2", "real-1", "no-recipient-1"]) {
        await notifyDiscordDM({
          userId,
          type: "board_update",
          title: "Board Update",
          description: "Plan accepted.",
          cronRun: true,
          client,
        });
      }
      flushDmRunGuard(["board_update"], { captureExceptionFn });
    }

    for (let i = 0; i < 3; i++) {
      await runOneCronTick();
    }

    assert.equal(captureExceptionFn.calls.length, 1);
    const { context } = captureExceptionFn.calls[0];
    assert.deepEqual(context.fingerprint, ["discord-dm-all-skipped", "board_update"]);
    // Kun de 2 reelle forsøg (real-1 + no-recipient-1) pr. kørsel tæller —
    // muted-1/muted-2 er slet ikke i nævneren. Ville de tælle som "leveret"
    // (den gamle bug), ville raten være 2/4 = 50% og aldrig udløse capture.
    assert.equal(context.extra.attempted, 2);
    assert.equal(context.extra.skipped, 2);
  } finally {
    if (savedBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = savedBotToken;
    if (savedToken === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = savedToken;
  }
});
