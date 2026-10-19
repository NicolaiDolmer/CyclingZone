// #6858 · Vaegur-planlaegning i dansk tid. Alle tests koerer paa et FAST, injiceret
// ur og falske timere: ingen test laeser vaegur-tiden (AGENTS.md L55 / hard rule 16).
//
// Faste datoer (alle soendage):
//   18/10-2026  sommertid (UTC+2): 14:00 dansk = 12:00Z
//   25/10-2026  vintertid fra 03:00 sommertid (01:00Z): 14:00 dansk = 13:00Z
//   29/3-2026   sommertid fra 02:00 vintertid (01:00Z): 14:00 dansk = 12:00Z
import test from "node:test";
import assert from "node:assert/strict";

import {
  nextWallClockSlotMs,
  startWallClockSchedule,
  crontabFromWallClock,
  wallClockPeriodSeconds,
  normalizeWallClockSpec,
  MAX_SLEEP_MS,
  DEFAULT_STARTUP_GRACE_MS,
  DEPLOY_OVERLAP_GRACE_MS,
} from "./wallClockScheduler.js";
import { copenhagenWallTimeToUTC, copenhagenHourToUTC } from "./copenhagenTime.js";
import { SUNDAY_VALUE_WALL_CLOCK, SUNDAY_START_WALL_CLOCK, EMAIL_HEALTH_WALL_CLOCK, CRON_MONITOR_SUNDAY_VALUE } from "./cronMonitorRegistry.js";
import { runSundayValueSweep } from "./sundayValueSweep.js";
import { computeOverdueSlugs, cadenceSecondsFromConfig, wallClockDeadlineMs } from "./cronHeartbeat.js";

const at = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();
const SUNDAY_14_PRIMARY = { weekdays: ["sun"], hour: 14, minute: 0 };

// ── Falsk ur + timere ────────────────────────────────────────────────────────
function makeFakeClock(startMs) {
  let nowMs = startMs;
  let seq = 0;
  const timers = [];
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    now: () => nowMs,
    set: (ms) => {
      nowMs = ms;
    },
    setTimeoutFn: (fn, delay) => {
      const timer = { id: ++seq, at: nowMs + delay, fn, delay };
      timers.push(timer);
      return timer.id;
    },
    clearTimeoutFn: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    timers,
    // Koer timere i tidsraekkefoelge til og med untilMs; returnerer antal opvaagninger.
    async advanceTo(untilMs) {
      let wakes = 0;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > untilMs) break;
        timers.shift();
        nowMs = next.at;
        wakes++;
        next.fn();
        await flush();
      }
      nowMs = untilMs;
      await flush();
      return wakes;
    },
  };
}

function startWithClock(clock, fn, spec, extra = {}) {
  const logs = [];
  const handle = startWallClockSchedule(fn, spec, {
    label: "test-job",
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    log: (line) => logs.push(line),
    ...extra,
  });
  return { handle, logs };
}

// ── copenhagenWallTimeToUTC ──────────────────────────────────────────────────

test("copenhagenWallTimeToUTC: 14:00 dansk tid omkring begge sommertids-skift", () => {
  assert.equal(copenhagenWallTimeToUTC("2026-10-18", 14).toISOString(), "2026-10-18T12:00:00.000Z");
  assert.equal(copenhagenWallTimeToUTC("2026-10-25", 14).toISOString(), "2026-10-25T13:00:00.000Z");
  assert.equal(copenhagenWallTimeToUTC("2026-03-22", 14).toISOString(), "2026-03-22T13:00:00.000Z");
  assert.equal(copenhagenWallTimeToUTC("2026-03-29", 14).toISOString(), "2026-03-29T12:00:00.000Z");
  assert.equal(copenhagenWallTimeToUTC("2026-10-18", 8, 30).toISOString(), "2026-10-18T06:30:00.000Z");
});

test("copenhagenWallTimeToUTC: kl. 01 den 25/10 er stadig sommertid (det naive offset-trick rammer forkert)", () => {
  assert.equal(copenhagenWallTimeToUTC("2026-10-25", 1).toISOString(), "2026-10-24T23:00:00.000Z");
  // Det gamle trick (et offset maalt paa "datoen som UTC") giver 02:00 sommertid her.
  assert.equal(copenhagenHourToUTC("2026-10-25", 1).toISOString(), "2026-10-25T00:00:00.000Z");
});

test("copenhagenWallTimeToUTC: et klokkeslaet der ikke findes (sommertids-spring) giver null", () => {
  assert.equal(copenhagenWallTimeToUTC("2026-03-29", 2, 0), null);
  assert.equal(copenhagenWallTimeToUTC("2026-03-29", 2, 30), null);
  assert.equal(copenhagenWallTimeToUTC("2026-03-29", 3, 0).toISOString(), "2026-03-29T01:00:00.000Z");
});

test("copenhagenWallTimeToUTC: det dobbelte klokkeslaet ved vintertid giver en gyldig forekomst", () => {
  const t = copenhagenWallTimeToUTC("2026-10-25", 2, 0).toISOString();
  assert.ok(["2026-10-25T00:00:00.000Z", "2026-10-25T01:00:00.000Z"].includes(t), t);
});

// ── nextWallClockSlotMs (ren funktion) ───────────────────────────────────────

test("naeste forekomst: soendag foer 14:00 giver samme dag kl. 14:00", () => {
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-18T11:59:59Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-10-18T12:00:00.000Z");
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-18T04:00:00Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-10-18T12:00:00.000Z");
});

test("naeste forekomst er STRENGT efter: paa selve 14:00 gives naeste time / naeste soendag", () => {
  const slot = at("2026-10-18T12:00:00Z");
  assert.equal(iso(nextWallClockSlotMs(slot, SUNDAY_VALUE_WALL_CLOCK)), "2026-10-18T13:00:00.000Z"); // genforsoeg kl. 15
  // Det faste tidspunkt alene: naeste soendag, og den er i vintertid.
  assert.equal(iso(nextWallClockSlotMs(slot, SUNDAY_VALUE_WALL_CLOCK, { primaryOnly: true })), "2026-10-25T13:00:00.000Z");
  assert.equal(iso(nextWallClockSlotMs(slot, SUNDAY_14_PRIMARY)), "2026-10-25T13:00:00.000Z");
});

test("naeste forekomst: soendag efter sidste genforsoeg (23:00) springer til naeste soendag 14:00", () => {
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-18T21:00:00Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-10-25T13:00:00.000Z");
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-18T21:30:00Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-10-25T13:00:00.000Z");
});

test("naeste forekomst: vintertid 25/10 og sommertid 29/3 rammer 14:00 dansk tid", () => {
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-24T12:00:00Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-10-25T13:00:00.000Z");
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-25T00:30:00Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-10-25T13:00:00.000Z"); // midt i skiftet
  assert.equal(iso(nextWallClockSlotMs(at("2026-03-28T12:00:00Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-03-29T12:00:00.000Z");
  assert.equal(iso(nextWallClockSlotMs(at("2026-03-29T01:30:00Z"), SUNDAY_VALUE_WALL_CLOCK)), "2026-03-29T12:00:00.000Z");
});

test("naeste forekomst: hverdage springes over for et soendags-skema", () => {
  for (const day of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) {
    assert.equal(iso(nextWallClockSlotMs(at(`${day}T13:30:00Z`), SUNDAY_VALUE_WALL_CLOCK)), "2026-10-25T13:00:00.000Z", day);
  }
});

test("timeligt genforsoeg paa skiftedagene: hver lokal time en gang, i stigende orden", () => {
  const collect = (fromIso, untilIso) => {
    const out = [];
    let t = at(fromIso);
    for (;;) {
      t = nextWallClockSlotMs(t, SUNDAY_START_WALL_CLOCK);
      if (t >= at(untilIso)) break;
      out.push(t);
    }
    return out;
  };
  // 25/10: 25 timer lange; kl. 02 findes to gange, men koeres en gang.
  const winter = collect("2026-10-24T21:00:00Z", "2026-10-25T23:00:00Z");
  assert.equal(winter.length, 24);
  assert.equal(iso(winter[0]), "2026-10-24T22:00:00.000Z"); // 00:00 sommertid
  // 29/3: 23 timer lange; kl. 02 findes ikke og springes over.
  const spring = collect("2026-03-28T22:00:00Z", "2026-03-29T22:00:00Z");
  assert.equal(spring.length, 23);
  assert.equal(iso(spring[0]), "2026-03-28T23:00:00.000Z"); // 00:00 vintertid
  for (const list of [winter, spring]) {
    for (let i = 1; i < list.length; i++) assert.ok(list[i] > list[i - 1], "strengt stigende");
  }
});

test("daglig skema (mail-sundhedsrapport kl. 08): genforsoeg samme dag, ellers naeste dag kl. 08", () => {
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-24T07:00:00Z"), EMAIL_HEALTH_WALL_CLOCK)), "2026-10-24T08:00:00.000Z");
  assert.equal(iso(nextWallClockSlotMs(at("2026-10-24T07:00:00Z"), EMAIL_HEALTH_WALL_CLOCK, { primaryOnly: true })), "2026-10-25T07:00:00.000Z");
});

// ── crontab / periode / validering ───────────────────────────────────────────

test("crontab for Sentry: soendag 14:00 = '0 14 * * 0'", () => {
  assert.equal(crontabFromWallClock(SUNDAY_VALUE_WALL_CLOCK), "0 14 * * 0");
  assert.equal(CRON_MONITOR_SUNDAY_VALUE.schedule.value, "0 14 * * 0");
  assert.equal(CRON_MONITOR_SUNDAY_VALUE.timezone, "Europe/Copenhagen");
  assert.equal(crontabFromWallClock(EMAIL_HEALTH_WALL_CLOCK), "0 8 * * *");
  assert.equal(crontabFromWallClock({ weekdays: ["sun", "sat"], hour: 6, minute: 30 }), "30 6 * * 0,6");
});

test("periode: ugentlig 7 doegn, daglig 1 doegn, mandag+fredag stoerste hul 4 doegn", () => {
  assert.equal(wallClockPeriodSeconds(SUNDAY_VALUE_WALL_CLOCK), 7 * 86400);
  assert.equal(wallClockPeriodSeconds(EMAIL_HEALTH_WALL_CLOCK), 86400);
  assert.equal(wallClockPeriodSeconds({ weekdays: ["mon", "fri"], hour: 9 }), 4 * 86400);
});

test("forkerte skemaer stopper med det samme", () => {
  assert.throws(() => normalizeWallClockSpec({ hour: 24 }), RangeError);
  assert.throws(() => normalizeWallClockSpec({ hour: 14, minute: 60 }), RangeError);
  assert.throws(() => normalizeWallClockSpec({ hour: 14.5 }), RangeError);
  assert.throws(() => normalizeWallClockSpec({ hour: 14, weekdays: ["son"] }), RangeError);
  assert.throws(() => normalizeWallClockSpec({ hour: 14, weekdays: [] }), RangeError);
  assert.throws(() => nextWallClockSlotMs(Number.NaN, SUNDAY_VALUE_WALL_CLOCK), RangeError);
});

// ── startWallClockSchedule (falsk ur + timere) ───────────────────────────────

test("planlaeggeren fyrer praecis soendag 14:00:00 og logger tidspunktet i dansk tid", async () => {
  const clock = makeFakeClock(at("2026-10-17T10:00:00Z")); // loerdag
  const runs = [];
  const { handle, logs } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  assert.equal(iso(handle.nextRunAt()), "2026-10-18T12:00:00.000Z");
  assert.match(logs[0], /test-job: naeste koersel 2026-10-18 14:00 dansk tid/);
  // Lang soevn deles op i hop paa hoejst en time.
  assert.ok(clock.timers.every((t) => t.delay <= MAX_SLEEP_MS));

  await clock.advanceTo(at("2026-10-18T12:00:00Z"));
  assert.deepEqual(runs.map(iso), ["2026-10-18T12:00:00.000Z"]);
  assert.equal(iso(handle.nextRunAt()), "2026-10-18T13:00:00.000Z"); // genforsoeg kl. 15
  handle.stop();
});

test("planlaeggeren rammer 14:00 vintertid den 25/10 efter skiftet om natten", async () => {
  const clock = makeFakeClock(at("2026-10-24T12:00:00Z"));
  const runs = [];
  const { handle, logs } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_14_PRIMARY);
  assert.match(logs[0], /2026-10-25 14:00 dansk tid/);
  await clock.advanceTo(at("2026-10-25T13:30:00Z"));
  assert.deepEqual(runs.map(iso), ["2026-10-25T13:00:00.000Z"]);
  assert.equal(iso(handle.nextRunAt()), "2026-11-01T13:00:00.000Z");
  handle.stop();
});

test("planlaeggeren rammer 14:00 sommertid den 29/3", async () => {
  const clock = makeFakeClock(at("2026-03-28T12:00:00Z"));
  const runs = [];
  const { handle } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_14_PRIMARY);
  await clock.advanceTo(at("2026-03-29T13:00:00Z"));
  assert.deepEqual(runs.map(iso), ["2026-03-29T12:00:00.000Z"]);
  handle.stop();
});

test("en timer der vaagner for tidligt sover videre i stedet for at koere", async () => {
  const clock = makeFakeClock(at("2026-10-18T11:59:00Z"));
  const runs = [];
  const { handle } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  const timer = clock.timers.shift();
  clock.set(at("2026-10-18T11:59:59.995Z")); // 5 ms foer tid
  timer.fn();
  assert.equal(runs.length, 0);
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0].delay, 5);
  await clock.advanceTo(at("2026-10-18T12:00:00Z"));
  assert.equal(runs.length, 1);
  handle.stop();
});

test("ingen dobbeltkoersel: samme forekomst koeres aldrig to gange, heller ikke hvis uret gaar baglaens", async () => {
  const clock = makeFakeClock(at("2026-10-18T11:00:00Z"));
  const runs = [];
  const { handle } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_14_PRIMARY);
  await clock.advanceTo(at("2026-10-18T12:00:00Z"));
  assert.equal(runs.length, 1);
  // Uret justeres et minut tilbage (NTP): den ventende timer sigter mod naeste soendag.
  clock.set(at("2026-10-18T11:59:00Z"));
  const timer = clock.timers.shift();
  timer.fn();
  assert.equal(runs.length, 1);
  assert.equal(iso(handle.nextRunAt()), "2026-10-25T13:00:00.000Z");
  handle.stop();
});

test("hele soendagen: 14:00 + et genforsoeg hver hele time til midnat, ingen andre dage", async () => {
  const clock = makeFakeClock(at("2026-10-17T00:00:00Z"));
  const runs = [];
  const { handle } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  await clock.advanceTo(at("2026-10-24T23:00:00Z"));
  assert.deepEqual(
    runs.map(iso),
    Array.from({ length: 10 }, (_, i) => `2026-10-18T${String(12 + i).padStart(2, "0")}:00:00.000Z`) // 14:00..23:00 sommertid
  );
  handle.stop();
});

test("opstarts-frist: en forekomst lige efter boot udskydes til fristen, og koeres en gang", async () => {
  const clock = makeFakeClock(at("2026-10-18T11:58:00Z")); // boot 13:58
  const runs = [];
  const { handle, logs } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_VALUE_WALL_CLOCK, {
    startupGraceMs: DEPLOY_OVERLAP_GRACE_MS,
  });
  assert.equal(iso(handle.nextSlotAt()), "2026-10-18T12:00:00.000Z");
  assert.equal(iso(handle.nextRunAt()), "2026-10-18T12:03:00.000Z");
  assert.match(logs[0], /efter opstarts-frist: 2026-10-18 14:03/);
  await clock.advanceTo(at("2026-10-18T13:30:00Z"));
  assert.deepEqual(runs.map(iso), ["2026-10-18T12:03:00.000Z", "2026-10-18T13:00:00.000Z"]);
  handle.stop();
});

test("standard-fristen (30 s) roerer ikke en forekomst der ligger laengere fremme", () => {
  assert.equal(DEFAULT_STARTUP_GRACE_MS, 30_000);
  const clock = makeFakeClock(at("2026-10-18T11:59:00Z"));
  const { handle } = startWithClock(clock, () => {}, SUNDAY_VALUE_WALL_CLOCK);
  assert.equal(iso(handle.nextRunAt()), "2026-10-18T12:00:00.000Z");
  handle.stop();
});

test("en fejl i jobbet stopper ikke kaeden; naeste forekomst er allerede planlagt", async () => {
  const clock = makeFakeClock(at("2026-10-18T11:59:00Z"));
  const errors = [];
  let calls = 0;
  const { handle } = startWithClock(
    clock,
    () => {
      calls++;
      if (calls === 1) throw new Error("synkron fejl");
      return Promise.reject(new Error("asynkron fejl"));
    },
    SUNDAY_VALUE_WALL_CLOCK,
    { onError: (err) => errors.push(err.message) }
  );
  await clock.advanceTo(at("2026-10-18T13:00:00Z"));
  assert.equal(calls, 2);
  assert.deepEqual(errors, ["synkron fejl", "asynkron fejl"]);
  assert.equal(iso(handle.nextRunAt()), "2026-10-18T14:00:00.000Z");
  handle.stop();
});

test("nedlukning: shouldStop stopper genplanlaegningen, stop() rydder timeren", async () => {
  const clock = makeFakeClock(at("2026-10-18T11:00:00Z"));
  let stopped = false;
  const runs = [];
  const { handle } = startWithClock(clock, () => runs.push(clock.now()), SUNDAY_VALUE_WALL_CLOCK, {
    shouldStop: () => stopped,
  });
  stopped = true;
  await clock.advanceTo(at("2026-10-18T22:00:00Z"));
  assert.equal(runs.length, 0);
  assert.equal(clock.timers.length, 0);
  assert.equal(handle.nextRunAt(), null);

  const clock2 = makeFakeClock(at("2026-10-18T11:00:00Z"));
  const second = startWithClock(clock2, () => runs.push(clock2.now()), SUNDAY_VALUE_WALL_CLOCK);
  assert.equal(clock2.timers.length, 1);
  second.handle.stop();
  assert.equal(clock2.timers.length, 0);
  assert.equal(second.handle.nextRunAt(), null);
});

// ── Soendagens vaerdier end-to-end: planlaegger + boot-run + dato-claim ──────

function makeSundayValueJob() {
  const claimed = new Set();
  const refreshes = [];
  const state = { transition: { latestSeason: { status: "active" }, lastRaceAt: "2026-11-30T12:00:00Z", latestAnchor: null } };
  const job = (nowMs) =>
    runSundayValueSweep({
      supabase: { from: () => ({}) },
      now: new Date(nowMs),
      claimRunDate: async ({ runDate }) => {
        if (claimed.has(runDate)) return { claimed: false, tableMissing: false };
        claimed.add(runDate);
        return { claimed: true, tableMissing: false };
      },
      releaseRunDate: async ({ runDate }) => {
        claimed.delete(runDate);
      },
      completeRun: async () => {},
      readPhaseStep: async () => 0,
      advancePhaseStep: async () => {},
      loadTransitionState: async () => state.transition,
      refreshValues: async () => {
        refreshes.push(nowMs);
        return { scanned: 1, changed: 1, written: 1 };
      },
      captureExceptionFn: () => {},
    });
  return { job, refreshes, state };
}

test("soendagens vaerdier: koerer praecis kl. 14:00 og kun en gang hele soendagen", async () => {
  const clock = makeFakeClock(at("2026-10-17T09:00:00Z"));
  const { job, refreshes } = makeSundayValueJob();
  const results = [];
  const { handle } = startWithClock(clock, async () => results.push(await job(clock.now())), SUNDAY_VALUE_WALL_CLOCK);
  await clock.advanceTo(at("2026-10-18T22:30:00Z"));
  assert.deepEqual(refreshes.map(iso), ["2026-10-18T12:00:00.000Z"]);
  assert.equal(results.length, 10);
  assert.ok(results.slice(1).every((r) => r.skipped === "already_ran_today"));
  handle.stop();
});

test("soendagens vaerdier: boot efter 14:00 indhenter med det samme, og planlaeggeren koerer ikke igen", async () => {
  const bootMs = at("2026-10-18T12:20:00Z"); // processen var nede kl. 14, booter 14:20
  const clock = makeFakeClock(bootMs);
  const { job, refreshes } = makeSundayValueJob();
  const { handle } = startWithClock(clock, () => job(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  // cron.js' boot-run (claim-idempotent) koerer straks:
  const boot = await job(bootMs);
  assert.equal(boot.ran, true);
  assert.equal(iso(handle.nextRunAt()), "2026-10-18T13:00:00.000Z");
  await clock.advanceTo(at("2026-10-18T22:30:00Z"));
  assert.deepEqual(refreshes.map(iso), ["2026-10-18T12:20:00.000Z"]);
  handle.stop();
});

test("soendagens vaerdier: boot foer 14:00 er en no-op, og 14:00 koerer som planlagt", async () => {
  const bootMs = at("2026-10-18T11:17:00Z"); // deploy 13:17, som 18/10
  const clock = makeFakeClock(bootMs);
  const { job, refreshes } = makeSundayValueJob();
  const { handle } = startWithClock(clock, () => job(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  const boot = await job(bootMs);
  assert.equal(boot.skipped, "before_window");
  await clock.advanceTo(at("2026-10-18T13:30:00Z"));
  assert.deepEqual(refreshes.map(iso), ["2026-10-18T12:00:00.000Z"]); // ikke 14:17:45
  handle.stop();
});

test("soendagens vaerdier: to processer der fyrer i samme sekund skriver kun en gang (claim)", async () => {
  const clock = makeFakeClock(at("2026-10-18T11:50:00Z"));
  const { job, refreshes } = makeSundayValueJob();
  const a = startWithClock(clock, () => job(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  const b = startWithClock(clock, () => job(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  await clock.advanceTo(at("2026-10-18T12:10:00Z"));
  assert.equal(refreshes.length, 1);
  a.handle.stop();
  b.handle.stop();
});

test("soendagens vaerdier: venter paa saesonskiftet og koerer ved foerste hele time efter", async () => {
  const clock = makeFakeClock(at("2026-10-18T11:50:00Z"));
  const { job, refreshes, state } = makeSundayValueJob();
  state.transition = { latestSeason: { status: "active" }, lastRaceAt: null, latestAnchor: { status: "started" } };
  const { handle } = startWithClock(clock, () => job(clock.now()), SUNDAY_VALUE_WALL_CLOCK);
  await clock.advanceTo(at("2026-10-18T13:30:00Z")); // 14:00 og 15:00 blokeret
  assert.equal(refreshes.length, 0);
  state.transition = { latestSeason: { status: "active" }, lastRaceAt: null, latestAnchor: { status: "completed" } };
  await clock.advanceTo(at("2026-10-18T22:30:00Z"));
  assert.deepEqual(refreshes.map(iso), ["2026-10-18T14:00:00.000Z"]); // 16:00 dansk tid
  handle.stop();
});

// ── Heartbeat-vagten (cronHeartbeat.js) for faste tidspunkter ────────────────

test("heartbeat: crontab-monitor har ugentlig kadence og frist ved naeste faste tidspunkt", () => {
  assert.equal(cadenceSecondsFromConfig(CRON_MONITOR_SUNDAY_VALUE), 7 * 86400);
  // Sidste check-in soendag 23:00 (sidste genforsoeg): fristen er NAESTE soendag
  // 14:00 + margin (15) + maxRuntime (60), ikke 23:00 + 7 doegn.
  const deadline = wallClockDeadlineMs({ lastCheckinAt: "2026-10-18T21:00:00Z", monitorConfig: CRON_MONITOR_SUNDAY_VALUE });
  assert.equal(iso(deadline), "2026-10-25T14:15:00.000Z");
});

test("heartbeat: et udeblevet soendags-tidspunkt meldes, et boot-check-in midt i ugen gemmer det ikke", () => {
  const monitors = [["sunday-value-refresh", CRON_MONITOR_SUNDAY_VALUE]];
  const checkinsBySlug = { "sunday-value-refresh": { last_checkin_at: "2026-10-21T10:00:00Z" } }; // onsdags-boot
  assert.deepEqual(computeOverdueSlugs({ monitors, checkinsBySlug, now: new Date("2026-10-25T14:00:00Z") }), []);
  const overdue = computeOverdueSlugs({ monitors, checkinsBySlug, now: new Date("2026-10-25T14:16:00Z") });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].slug, "sunday-value-refresh");
  assert.equal(iso(overdue[0].deadlineMs), "2026-10-25T14:15:00.000Z");
  // Koerslen 14:00 (check-in 14:05) => ingen alarm.
  const ok = { "sunday-value-refresh": { last_checkin_at: "2026-10-25T13:05:00Z" } };
  assert.deepEqual(computeOverdueSlugs({ monitors, checkinsBySlug: ok, now: new Date("2026-10-25T20:00:00Z") }), []);
});
