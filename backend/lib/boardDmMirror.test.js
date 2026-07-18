import test from "node:test";
import assert from "node:assert/strict";

import { makeBoardDmNotifier } from "./boardDmMirror.js";

function makeHarness(notifyUserResult) {
  const dmCalls = [];
  const notifyUser = async () => notifyUserResult;
  const notifyBoardUpdateDM = async (args) => {
    dmCalls.push(args);
  };
  const notify = makeBoardDmNotifier({
    notifyUser,
    notifyBoardUpdateDM,
    supabase: {},
  });
  return { notify, dmCalls };
}

const BOARD_ARGS = {
  userId: "user-1",
  type: "board_update",
  title: "The board is waiting for your 5-year plan",
  message: "Submit your plan before the deadline.",
};

// #2619 kerne-case: en NYOPRETTET in-app board-notifikation spejles til Discord-DM.
test("makeBoardDmNotifier — delivered:true spejler board_update til DM", async () => {
  const { notify, dmCalls } = makeHarness({ delivered: true, deduped: false });

  const result = await notify(BOARD_ARGS);

  assert.equal(dmCalls.length, 1, "DM skal fyre når notifikationen blev nyoprettet");
  assert.equal(dmCalls[0].userId, "user-1");
  assert.equal(dmCalls[0].type, "board_update");
  assert.equal(dmCalls[0].title, BOARD_ARGS.title);
  assert.equal(dmCalls[0].description, BOARD_ARGS.message);
  assert.deepEqual(result, { delivered: true, deduped: false });
});

// #2619 hoved-fix: en DEDUP-RAMT reminder (24h-vindue) må ALDRIG re-sende DM'en.
// Dette er præcis den bug der gav 30-min-re-forsøg → DM-spam + falsk
// CYCLINGZONE-35-alarm. Verificér red mod den gamle ubetingede DM-sti.
test("makeBoardDmNotifier — deduped:true spejler IKKE til DM", async () => {
  const { notify, dmCalls } = makeHarness({ delivered: false, deduped: true });

  const result = await notify(BOARD_ARGS);

  assert.equal(dmCalls.length, 0, "DM må ikke fyre når in-app-notifikationen blev dedup-ramt");
  assert.deepEqual(result, { delivered: false, deduped: true });
});

// board_critical følger samme gate.
test("makeBoardDmNotifier — board_critical spejles kun ved delivered:true", async () => {
  const delivered = makeHarness({ delivered: true, deduped: false });
  await delivered.notify({ ...BOARD_ARGS, type: "board_critical" });
  assert.equal(delivered.dmCalls.length, 1);
  assert.equal(delivered.dmCalls[0].type, "board_critical");

  const deduped = makeHarness({ delivered: false, deduped: true });
  await deduped.notify({ ...BOARD_ARGS, type: "board_critical" });
  assert.equal(deduped.dmCalls.length, 0);
});

// Ikke-board-typer spejles aldrig til board-DM, uanset delivered.
test("makeBoardDmNotifier — ikke-board-type spejler aldrig", async () => {
  const { notify, dmCalls } = makeHarness({ delivered: true, deduped: false });
  await notify({ ...BOARD_ARGS, type: "contract_expiring" });
  assert.equal(dmCalls.length, 0);
});

// Robusthed: et manglende/utomt result (fx missing_user) må ikke spejle eller kaste.
test("makeBoardDmNotifier — undefined/tomt result spejler ikke og kaster ikke", async () => {
  const nullResult = makeHarness(undefined);
  await assert.doesNotReject(() => nullResult.notify(BOARD_ARGS));
  assert.equal(nullResult.dmCalls.length, 0);

  const missingUser = makeHarness({ delivered: false, deduped: false, reason: "missing_user" });
  await missingUser.notify(BOARD_ARGS);
  assert.equal(missingUser.dmCalls.length, 0);
});

// En DM-fejl (rejected promise) må aldrig vælte kalderen — result returneres stadig.
test("makeBoardDmNotifier — en fejlende DM sluges (fire-and-forget)", async () => {
  const dmCalls = [];
  const notify = makeBoardDmNotifier({
    notifyUser: async () => ({ delivered: true, deduped: false }),
    notifyBoardUpdateDM: async (args) => {
      dmCalls.push(args);
      throw new Error("discord down");
    },
    supabase: {},
  });

  const result = await notify(BOARD_ARGS);
  assert.equal(dmCalls.length, 1);
  assert.deepEqual(result, { delivered: true, deduped: false });
});
