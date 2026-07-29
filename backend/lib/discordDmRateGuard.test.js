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

// Simulér én cron-kørsel: `attempted` DM-forsøg hvoraf `skipped` blev droppet,
// efterfulgt af flush'en. Sample-størrelsen er nu betydningsbærende (#3072), så
// testene angiver den eksplicit i stedet for implicit at bruge attempted=1.
function runTick(type, { attempted, skipped, captureExceptionFn }) {
  for (let i = 0; i < attempted; i++) {
    recordDmAttempt({ type, skipped: i < skipped, cronRun: true });
  }
  flushDmRunGuard([type], { captureExceptionFn });
}

test.beforeEach(() => {
  __resetDmRunGuardForTests();
});

// #2571 core case: 3 kørsler i træk med 100% skip på samme type → capture med
// stabilt fingerprint. Dette er præcis #2569-scenariet (bestyrelses-DM'er
// skippet i 14 dage uden alarm). Sample ≥ MIN_SAMPLE_SIZE, så det er en ægte
// regression og ikke lav-volumen-støj.
test("flushDmRunGuard — 100% skip over 3 kørsler i træk capturer med stabilt fingerprint", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 3; i++) {
    runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 1);
  const { context } = captureExceptionFn.calls[0];
  assert.deepEqual(context.fingerprint, ["discord-dm-all-skipped", "board_update"]);
  assert.equal(context.extra.streak, 3);
  assert.equal(context.extra.attempted, 5);
  assert.equal(context.extra.skipped, 5);
});

test("flushDmRunGuard — under 3 kørsler i træk capturer IKKE", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 2; i++) {
    runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 0);
});

// #3072 — kerne-regressionen: CYCLINGZONE-40 fyrede på "alle 1 forsøgte
// auction_won-DM'er blev skippet i 3 kørsler i træk". Med 7-17 % Discord-dækning
// er det det forventede udfald, ikke et nedbrud. Uanset hvor mange kørsler i
// træk må attempted=1 aldrig alene udløse en alarm.
test("flushDmRunGuard — attempted=1 med 100% skip udløser ALDRIG alarm (#3072)", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 20; i++) {
    runTick("auction_won", { attempted: 1, skipped: 1, captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 0);
});

// Grænsen er inklusiv: præcis MIN_SAMPLE_SIZE (5) tæller med, 4 gør ikke.
test("flushDmRunGuard — 4 forsøgte er for lidt, 5 er nok (#3072)", () => {
  const belowSpy = makeCaptureSpy();
  for (let i = 0; i < 3; i++) {
    runTick("auction_won", { attempted: 4, skipped: 4, captureExceptionFn: belowSpy });
  }
  assert.equal(belowSpy.calls.length, 0);

  __resetDmRunGuardForTests();

  const atSpy = makeCaptureSpy();
  for (let i = 0; i < 3; i++) {
    runTick("auction_won", { attempted: 5, skipped: 5, captureExceptionFn: atSpy });
  }
  assert.equal(atSpy.calls.length, 1);
});

// #3072: en for lille kørsel er NEUTRAL — den må hverken forlænge eller
// nulstille en igangværende streak af ægte, fuldt samplede all-skip-kørsler.
test("flushDmRunGuard — kørsel under minimums-sample er neutral, ikke en reset (#3072)", () => {
  const captureExceptionFn = makeCaptureSpy();

  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 1
  runTick("board_update", { attempted: 2, skipped: 2, captureExceptionFn }); // for lille — neutral
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 2
  assert.equal(captureExceptionFn.calls.length, 0);

  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 3 → capture
  assert.equal(captureExceptionFn.calls.length, 1);
  assert.equal(captureExceptionFn.calls[0].context.extra.streak, 3);
});

// Positiv evidens er gyldig ved n=1: leveres en enkelt DM, virker leveringen —
// det udsagn kræver ikke sample, i modsætning til "alle blev skippet".
test("flushDmRunGuard — én leveret DM nulstiller streak'en også under minimums-sample (#3072)", () => {
  const captureExceptionFn = makeCaptureSpy();

  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 1
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 2
  runTick("board_update", { attempted: 1, skipped: 0, captureExceptionFn }); // leveret → reset
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 1
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 2

  assert.equal(captureExceptionFn.calls.length, 0);
});

// #2440-undgåelse: en kørsel med 0 forsøgte DM'er (fx deploy-storm, ingen
// board-reminders due) skal hverken forlænge eller nulstille streak'en.
test("flushDmRunGuard — kørsel med 0 forsøgte DM'er er neutral (ingen falsk alarm)", () => {
  const captureExceptionFn = makeCaptureSpy();

  runTick("auction_won", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 1

  flushDmRunGuard(["auction_won"], { captureExceptionFn }); // 0 forsøgte — neutral
  flushDmRunGuard(["auction_won"], { captureExceptionFn }); // 0 forsøgte — neutral

  runTick("auction_won", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 2 (ikke 4)
  runTick("auction_won", { attempted: 5, skipped: 5, captureExceptionFn }); // streak = 3 → capture

  assert.equal(captureExceptionFn.calls.length, 1);
  assert.equal(captureExceptionFn.calls[0].context.extra.streak, 3);
});

test("flushDmRunGuard — én leveret DM nulstiller streak'en", () => {
  const captureExceptionFn = makeCaptureSpy();

  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });

  // Kørsel med mindst én leveret DM (ikke 100% skip) — nulstiller streak.
  runTick("board_update", { attempted: 5, skipped: 4, captureExceptionFn });

  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });

  // Kun 2 all-skipped kørsler siden reset — ikke nok til at fyre igen.
  assert.equal(captureExceptionFn.calls.length, 0);
});

test("flushDmRunGuard — capturer ikke gentagne gange for samme igangværende streak (ingen Sentry-spam)", () => {
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 6; i++) {
    runTick("board_critical", { attempted: 5, skipped: 5, captureExceptionFn });
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

  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });

  runTick("board_update", { attempted: 6, skipped: 4, captureExceptionFn }); // 4/6 skippet — ikke 100%

  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });
  runTick("board_update", { attempted: 5, skipped: 5, captureExceptionFn });

  assert.equal(captureExceptionFn.calls.length, 0);
});
