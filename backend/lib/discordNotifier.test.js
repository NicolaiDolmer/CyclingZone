import test from "node:test";
import assert from "node:assert/strict";

import { resolveDmTargetFromInput } from "./discordDmTarget.js";
import { notifyBoardUpdateDM, notifyAuctionWon } from "./discordNotifier.js";
import { flushDmRunGuard, __resetDmRunGuardForTests } from "./discordDmRateGuard.js";

function makeCaptureSpy() {
  const calls = [];
  const fn = (error, context) => calls.push({ error, context });
  fn.calls = calls;
  return fn;
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
