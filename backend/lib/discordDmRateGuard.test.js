import test from "node:test";
import assert from "node:assert/strict";

import {
  recordDmAttempt,
  flushDmRunGuard,
  __resetDmRunGuardForTests,
} from "./discordDmRateGuard.js";

function makeCaptureSpy() {
  const calls = [];
  const fn = (error, context) => calls.push({ error, context });
  fn.calls = calls;
  return fn;
}

test.beforeEach(() => {
  __resetDmRunGuardForTests();
});

// #2571 core case: 3 kørsler i træk med 100% skip på samme type → capture med
// stabilt fingerprint. Dette er præcis #2569-scenariet (bestyrelses-DM'er
// skippet i 14 dage uden alarm).
test("flushDmRunGuard — 100% skip over 3 kørsler i træk capturer med stabilt fingerprint", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 3; i++) {
    recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
    flushDmRunGuard(["board_update"], { captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 1);
  const { context } = captureExceptionFn.calls[0];
  assert.deepEqual(context.fingerprint, ["discord-dm-all-skipped", "board_update"]);
  assert.equal(context.extra.streak, 3);
  assert.equal(context.extra.attempted, 1);
  assert.equal(context.extra.skipped, 1);
});

test("flushDmRunGuard — under 3 kørsler i træk capturer IKKE", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 2; i++) {
    recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
    flushDmRunGuard(["board_update"], { captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 0);
});

// #2440-undgåelse: en kørsel med 0 forsøgte DM'er (fx deploy-storm, ingen
// board-reminders due) skal hverken forlænge eller nulstille streak'en.
test("flushDmRunGuard — kørsel med 0 forsøgte DM'er er neutral (ingen falsk alarm)", () => {
  const captureExceptionFn = makeCaptureSpy();

  recordDmAttempt({ type: "auction_won", skipped: true, cronRun: true });
  flushDmRunGuard(["auction_won"], { captureExceptionFn }); // streak = 1

  flushDmRunGuard(["auction_won"], { captureExceptionFn }); // 0 forsøgte — neutral
  flushDmRunGuard(["auction_won"], { captureExceptionFn }); // 0 forsøgte — neutral

  recordDmAttempt({ type: "auction_won", skipped: true, cronRun: true });
  flushDmRunGuard(["auction_won"], { captureExceptionFn }); // streak = 2 (ikke 4)

  recordDmAttempt({ type: "auction_won", skipped: true, cronRun: true });
  flushDmRunGuard(["auction_won"], { captureExceptionFn }); // streak = 3 → capture

  assert.equal(captureExceptionFn.calls.length, 1);
  assert.equal(captureExceptionFn.calls[0].context.extra.streak, 3);
});

test("flushDmRunGuard — én leveret DM nulstiller streak'en", () => {
  const captureExceptionFn = makeCaptureSpy();

  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });
  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });

  // Kørsel med mindst én leveret DM (ikke 100% skip) — nulstiller streak.
  recordDmAttempt({ type: "board_update", skipped: false, cronRun: true });
  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });

  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });
  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });

  // Kun 2 all-skipped kørsler siden reset — ikke nok til at fyre igen.
  assert.equal(captureExceptionFn.calls.length, 0);
});

test("flushDmRunGuard — capturer ikke gentagne gange for samme igangværende streak (ingen Sentry-spam)", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 6; i++) {
    recordDmAttempt({ type: "board_critical", skipped: true, cronRun: true });
    flushDmRunGuard(["board_critical"], { captureExceptionFn });
  }

  // Streak fortsætter forbi threshold (3, 4, 5, 6) — kun ÉN capture.
  assert.equal(captureExceptionFn.calls.length, 1);
});

test("recordDmAttempt — cronRun:false (request-scopet) rører aldrig guarden", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 5; i++) {
    // Simulerer fx notifyOutbid/notifyTransferOffer — request-scopede kald
    // sætter aldrig cronRun.
    recordDmAttempt({ type: "auction_outbid", skipped: true, cronRun: false });
  }
  flushDmRunGuard(["auction_outbid"], { captureExceptionFn });

  assert.equal(captureExceptionFn.calls.length, 0);
});

test("recordDmAttempt — cronRun default (ikke sat) er false", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 5; i++) {
    recordDmAttempt({ type: "transfer_offer", skipped: true });
  }
  flushDmRunGuard(["transfer_offer"], { captureExceptionFn });

  assert.equal(captureExceptionFn.calls.length, 0);
});

test("flushDmRunGuard — typer der aldrig flushes akkumulerer stille uden at capture (watchlist/transfer i dag)", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 10; i++) {
    recordDmAttempt({ type: "watchlist_rider_auction", skipped: true, cronRun: true });
  }
  // Ingen flush kaldt for denne type — matcher at watchlist/transfer ikke er
  // cron-drevet i dag (#2571-afgrænsning), selvom cronRun teoretisk var sat.
  flushDmRunGuard(["board_update"], { captureExceptionFn });

  assert.equal(captureExceptionFn.calls.length, 0);
});

test("flushDmRunGuard — blandet resultat i én kørsel (nogle leveret, nogle skippet) er IKKE 100% og nulstiller", () => {
  const captureExceptionFn = makeCaptureSpy();

  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });
  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });

  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  recordDmAttempt({ type: "board_update", skipped: false, cronRun: true });
  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn }); // 2/3 skippet — ikke 100%

  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });
  recordDmAttempt({ type: "board_update", skipped: true, cronRun: true });
  flushDmRunGuard(["board_update"], { captureExceptionFn });

  assert.equal(captureExceptionFn.calls.length, 0);
});
