import test from "node:test";
import assert from "node:assert/strict";

import { trackedTick, getCronInFlight, awaitCronsIdle, stopCronScheduling, isCronSchedulingStopped } from "./cron.js";
import { startWallClockSchedule } from "./lib/wallClockScheduler.js";

// ── #4150: nye cron-ticks må ikke starte efter SIGTERM ────────────────────────
//
// Railways nedlukningsvindue er hævet fra default 0s til drainingSeconds=150,
// og i hele det vindue kører den gamle og den nye proces samtidig. Uden vagten
// i trackedTick ville den gamle proces fortsætte med at fyre setInterval-ticks
// mens den "lukker ned" — 1-min-auktionstikket alene ville nå 2 ekstra
// kørsler pr. deploy oveni den nye proces' egne.
//
// Rækkefølgen i denne fil er bevidst: alt der skal ske FØR nedlukning ligger
// øverst, fordi stopCronScheduling() er en envejsdør i modulets state.
// node:test kører hver testfil i sin egen proces (backend/scripts/run-tests.js),
// så envejsdøren lækker ikke ud i andre testfiler.

test("trackedTick kører normalt før nedlukning", async () => {
  let kørt = 0;
  await trackedTick("test-tick", async () => {
    kørt++;
  })();
  assert.equal(kørt, 1);
  assert.equal(getCronInFlight(), 0);
});

test("en tick der allerede er i gang bliver færdig — den afbrydes ikke", async () => {
  let afsluttet = false;
  let slipTick;
  const tickFærdig = new Promise((resolve) => {
    slipTick = resolve;
  });

  const igangværende = trackedTick("langsom-tick", async () => {
    await tickFærdig;
    afsluttet = true;
  })();

  // Vent til tikket faktisk er registreret som in-flight før vi lukker ned.
  while (getCronInFlight() === 0) await new Promise((r) => setTimeout(r, 5));
  assert.equal(getCronInFlight(), 1);

  stopCronScheduling();
  assert.equal(isCronSchedulingStopped(), true);

  slipTick();
  await igangværende;

  assert.equal(afsluttet, true, "en igangværende tick skal gøres færdig, ikke afbrydes");
  assert.equal(await awaitCronsIdle(1_000), true);
});

test("efter nedlukning starter der ingen nye ticks", async () => {
  let kørt = 0;
  await trackedTick("test-tick", async () => {
    kørt++;
  })();
  assert.equal(kørt, 0, "trackedTick må ikke kalde fn efter stopCronScheduling()");
  assert.equal(getCronInFlight(), 0);
});

// #6858: de vægur-planlagte jobs (fast tidspunkt i dansk tid) bruger samme vagt.
// Fast, injiceret ur og falske timere — ingen test læser vægur-tiden.
test("vægur-planlagt job efter nedlukning: ingen kørsel og ingen ny timer", async () => {
  let nowMs = Date.parse("2026-10-18T11:59:00Z"); // søndag 13:59 dansk tid
  const timers = [];
  let kørt = 0;
  const handle = startWallClockSchedule(
    trackedTick("test-wallclock", async () => {
      kørt++;
    }),
    { weekdays: ["sun"], hour: 14, minute: 0 },
    {
      label: "test-wallclock",
      shouldStop: isCronSchedulingStopped,
      now: () => nowMs,
      setTimeoutFn: (fn, delay) => timers.push({ fn, at: nowMs + delay }),
      clearTimeoutFn: () => {},
      log: () => {},
    }
  );
  assert.equal(timers.length, 1);
  const timer = timers.shift();
  nowMs = timer.at; // 14:00:00 — tidspunktet er nået, men processen lukker ned
  timer.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kørt, 0);
  assert.equal(timers.length, 0, "en lukkende proces må ikke planlægge flere kørsler");
  assert.equal(handle.nextRunAt(), null);
});
