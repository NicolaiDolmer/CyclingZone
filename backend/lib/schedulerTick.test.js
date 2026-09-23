import test from "node:test";
import assert from "node:assert/strict";

import {
  STAGE_TICK_MIN_FIRST_DELAY_MS,
  STAGE_TICK_OFFSET_MS,
  STAGE_TICK_PERIOD_MS,
  nextClockAlignedTickMs,
  startClockAlignedInterval,
} from "./schedulerTick.js";

// #3624 trin 1: etape-tikket ligger paa hh:00:05, hh:05:05, hh:10:05 ...
const at = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();

// ── nextClockAlignedTickMs ───────────────────────────────────────────────────

test("standard-kadencen er 5 min + 5 s", () => {
  assert.equal(STAGE_TICK_PERIOD_MS, 5 * 60 * 1000);
  assert.equal(STAGE_TICK_OFFSET_MS, 5 * 1000);
});

test("genstart kl. xx:02:37 giver foerste tick xx:05:05", () => {
  assert.equal(iso(nextClockAlignedTickMs(at("2026-09-23T10:02:37.000Z"))), "2026-09-23T10:05:05.000Z");
  // Ogsaa med boot-marginen: 148 s til slottet er mere end 30 s.
  assert.equal(
    iso(nextClockAlignedTickMs(at("2026-09-23T10:02:37.000Z"), { minDelayMs: STAGE_TICK_MIN_FIRST_DELAY_MS })),
    "2026-09-23T10:05:05.000Z",
  );
});

test("et tick der fyrer praecis paa sit slot faar naeste slot, aldrig sig selv", () => {
  assert.equal(iso(nextClockAlignedTickMs(at("2026-09-23T10:05:05.000Z"))), "2026-09-23T10:10:05.000Z");
});

test("1 ms foer slottet giver slottet selv", () => {
  assert.equal(iso(nextClockAlignedTickMs(at("2026-09-23T10:05:04.999Z"))), "2026-09-23T10:05:05.000Z");
});

test("mellem hele minut og +5 s: samme minuts slot", () => {
  assert.equal(iso(nextClockAlignedTickMs(at("2026-09-23T12:00:00.000Z"))), "2026-09-23T12:00:05.000Z");
});

test("time- og doegnskifte", () => {
  assert.equal(iso(nextClockAlignedTickMs(at("2026-09-23T10:58:00.000Z"))), "2026-09-23T11:00:05.000Z");
  assert.equal(iso(nextClockAlignedTickMs(at("2026-09-23T23:59:59.000Z"))), "2026-09-24T00:00:05.000Z");
});

test("minDelayMs skubber til naeste slot naar slottet ligger for taet paa", () => {
  // Boot 5 s foer et slot: slottet springes over, naeste er 5 min senere.
  assert.equal(
    iso(nextClockAlignedTickMs(at("2026-09-23T10:05:00.000Z"), { minDelayMs: 30_000 })),
    "2026-09-23T10:10:05.000Z",
  );
  // minDelay laengere end en periode: stadig paa gitteret.
  assert.equal(
    iso(nextClockAlignedTickMs(at("2026-09-23T10:05:00.000Z"), { minDelayMs: 11 * 60 * 1000 })),
    "2026-09-23T10:20:05.000Z",
  );
});

test("resultatet ligger altid paa gitteret og strengt efter nu", () => {
  const start = at("2026-09-23T00:00:00.000Z");
  for (let i = 0; i < 2000; i++) {
    const nowMs = start + i * 7919; // skaev skridtlaengde rammer mange faser
    const next = nextClockAlignedTickMs(nowMs);
    assert.ok(next > nowMs, `next ${iso(next)} skal ligge efter ${iso(nowMs)}`);
    assert.ok(next - nowMs <= STAGE_TICK_PERIOD_MS, "hoejst een periode frem");
    assert.equal((next - STAGE_TICK_OFFSET_MS) % STAGE_TICK_PERIOD_MS, 0, "paa gitteret");
  }
});

test("ugyldige parametre kaster", () => {
  assert.throws(() => nextClockAlignedTickMs(Number.NaN), RangeError);
  assert.throws(() => nextClockAlignedTickMs(0, { periodMs: 0 }), RangeError);
  assert.throws(() => nextClockAlignedTickMs(0, { periodMs: 1000, offsetMs: 1000 }), RangeError);
  assert.throws(() => nextClockAlignedTickMs(0, { minDelayMs: -1 }), RangeError);
});

// ── startClockAlignedInterval ────────────────────────────────────────────────

// Falsk ur + timer: timeren fyrer kun naar testen siger til, med den forsinkelse
// testen vaelger, saa drift og for-tidlig fyring kan simuleres praecist.
function makeFakeClock(startIso) {
  let nowMs = at(startIso);
  const timers = [];
  return {
    now: () => nowMs,
    set: (ms) => { nowMs = ms; },
    timers,
    setTimeoutFn: (cb, delay) => {
      const t = { cb, delay, dueAt: nowMs + delay, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeoutFn: (t) => { t.cleared = true; },
    // Fyr den senest armerede timer `lateMs` efter dens forfaldstid.
    fireLatest(lateMs = 0) {
      const t = timers.at(-1);
      nowMs = t.dueAt + lateMs;
      t.cb();
    },
  };
}

test("foerste tick: genstart kl. xx:02:37 armerer til xx:05:05", () => {
  const clock = makeFakeClock("2026-09-23T10:02:37.000Z");
  const handle = startClockAlignedInterval(() => {}, clock);
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0].delay, 148_000);
  assert.equal(iso(handle.nextTickAt()), "2026-09-23T10:05:05.000Z");
});

test("drift korrigeres: sene fyringer flytter ikke fasen", () => {
  const clock = makeFakeClock("2026-09-23T10:02:37.000Z");
  let calls = 0;
  startClockAlignedInterval(() => { calls++; }, clock);
  const fired = [];
  // Hver fyring kommer 700 ms for sent (event-loop-pres). Med setInterval ville
  // fasen glide; her armeres hvert tick fra uret og rammer gitteret igen.
  for (let i = 0; i < 20; i++) {
    clock.fireLatest(700);
    fired.push(iso(clock.now()));
  }
  assert.equal(calls, 20);
  const armed = clock.timers.map((t) => iso(t.dueAt));
  assert.equal(armed[0], "2026-09-23T10:05:05.000Z");
  assert.equal(armed[1], "2026-09-23T10:10:05.000Z");
  assert.equal(armed[20], "2026-09-23T11:45:05.000Z");
  for (const a of armed) assert.match(a, /:[0-5][05]:05\.000Z$/, `slot ${a} ligger ikke paa hh:m5:05`);
  // Forsinkelsen efter en sen fyring er kortere end perioden, netop saa fasen holdes.
  assert.equal(clock.timers[1].delay, STAGE_TICK_PERIOD_MS - 700);
});

test("naeste tick armeres foer fn koeres, saa et haengende tick ikke stopper kaeden", () => {
  const clock = makeFakeClock("2026-09-23T10:02:37.000Z");
  let armedWhenCalled = null;
  startClockAlignedInterval(() => {
    armedWhenCalled = clock.timers.length;
    return new Promise(() => {}); // resolver aldrig
  }, clock);
  clock.fireLatest();
  assert.equal(armedWhenCalled, 2, "timer for naeste slot fandtes allerede da fn blev kaldt");
  clock.fireLatest();
  assert.equal(clock.timers.length, 3);
});

test("for tidlig fyring (1 ms) koerer ikke samme slot to gange", () => {
  const clock = makeFakeClock("2026-09-23T10:02:37.000Z");
  let calls = 0;
  startClockAlignedInterval(() => { calls++; }, clock);
  clock.fireLatest(-1); // fyrer kl. 10:05:04.999
  assert.equal(calls, 1);
  assert.equal(iso(clock.timers[1].dueAt), "2026-09-23T10:10:05.000Z");
});

test("boot lige foer et slot springer det over (boot-margin)", () => {
  const clock = makeFakeClock("2026-09-23T10:04:50.000Z");
  startClockAlignedInterval(() => {}, clock);
  assert.equal(iso(clock.timers[0].dueAt), "2026-09-23T10:10:05.000Z");
});

test("fejl fra fn (synkron og async) stopper ikke kaeden", async () => {
  const clock = makeFakeClock("2026-09-23T10:02:37.000Z");
  const errors = [];
  let n = 0;
  startClockAlignedInterval(() => {
    n++;
    if (n === 1) throw new Error("sync boom");
    return Promise.reject(new Error("async boom"));
  }, { ...clock, onError: (err) => errors.push(err.message) });
  clock.fireLatest();
  clock.fireLatest();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ["sync boom", "async boom"]);
  assert.equal(clock.timers.length, 3);
});

test("stop() rydder timeren og forhindrer flere kald", () => {
  const clock = makeFakeClock("2026-09-23T10:02:37.000Z");
  let calls = 0;
  const handle = startClockAlignedInterval(() => { calls++; }, clock);
  handle.stop();
  assert.equal(clock.timers[0].cleared, true);
  clock.fireLatest(); // en timer der alligevel fyrer, goer intet
  assert.equal(calls, 0);
  assert.equal(handle.nextTickAt(), null);
});

test("fn skal vaere en funktion", () => {
  assert.throws(() => startClockAlignedInterval(null), TypeError);
});
