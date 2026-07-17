import test from "node:test";
import assert from "node:assert/strict";

import { resolveDmTargetFromInput } from "./discordDmTarget.js";
import { notifyBoardUpdateDM } from "./discordNotifier.js";

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
