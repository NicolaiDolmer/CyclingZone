import test from "node:test";
import assert from "node:assert/strict";

import { primeCronMonitorCheckIns } from "./cron.js";

// ── #2440: deploy-storm cron-monitor dæmpning ─────────────────────────────────
//
// Denne fil verificerer TO ting:
//  1. primeCronMonitorCheckIns() sender faktisk et "ok" check-in for HVER
//     monitor-config ved boot, og gør det best-effort (én fejlende monitor
//     stopper ikke de andre, og blokerer aldrig boot).
//  2. Den matematiske påstand fra PR'en: boot-priming + checkinMargin=10 på
//     CRON_MONITOR_5MIN gør at en deploy-KLYNGE (flere redeploys på kort tid)
//     ALDRIG ophober nok sammenhængende misses til at nå
//     failureIssueThreshold — mens en REELT død cron (ingen flere genstarter)
//     stadig alarmerer inden for dokumenteret tid.
//
// Simulatoren nedenfor er en forenklet, dokumenteret model af Sentry Cron
// Monitors' offentlige semantik (https://docs.sentry.io/product/crons/):
// et check-in-slot forventes hvert `intervalMin`; er der intet check-in inden
// `marginMin` efter det forventede tidspunkt, bekræftes slottet som MISSED.
// Sammenhængende misses tælles; når tallet når `thresholdN` alarmeres der. Et
// nyt "ok"-check-in (её fra en reel tick ELLER fra boot-priming) nulstiller
// streaken til 0 med det samme (Sentrys recovery-adfærd).

function simulateCronMonitor({ intervalMin, marginMin, thresholdN, okTimes, horizonMin }) {
  const events = [...new Set(okTimes)].sort((a, b) => a - b);
  if (events[0] !== 0) events.unshift(0); // t=0: proces booter, priming sender ok

  for (let i = 0; i < events.length; i++) {
    const base = events[i];
    const nextEventTime = i + 1 < events.length ? events[i + 1] : horizonMin;
    let misses = 0;
    for (let k = 1; ; k++) {
      const missConfirmTime = base + k * intervalMin + marginMin;
      if (missConfirmTime > nextEventTime) break;
      misses++;
      if (misses >= thresholdN) {
        return { alarmFired: true, alarmTime: missConfirmTime };
      }
    }
  }
  return { alarmFired: false, alarmTime: null };
}

// ── 1. primeCronMonitorCheckIns — adfærd ─────────────────────────────────────

test("primeCronMonitorCheckIns — sender ét ok-checkin pr. registreret monitor", () => {
  const calls = [];
  primeCronMonitorCheckIns((payload, config) => calls.push({ payload, config }));

  assert.ok(calls.length >= 20, "forventer alle registrerede cron-monitors primet");
  for (const { payload, config } of calls) {
    assert.equal(payload.status, "ok");
    assert.equal(typeof payload.monitorSlug, "string");
    assert.ok(config.schedule, "config skal indeholde et schedule-objekt");
  }
  // Ingen dubletter — hver monitor-slug primes præcis én gang pr. boot.
  const slugs = calls.map((c) => c.payload.monitorSlug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("primeCronMonitorCheckIns — én fejlende monitor blokerer ikke de andre", () => {
  let count = 0;
  assert.doesNotThrow(() => {
    primeCronMonitorCheckIns(() => {
      count++;
      if (count === 3) throw new Error("simuleret Sentry-transport-fejl");
    });
  });
  assert.ok(count >= 20, "resten af monitors skal stadig primes efter én fejl");
});

// ── 2. Deploy-klynge: CRON_MONITOR_5MIN (interval=5, margin=10, threshold=2) ──
// Reproducerer det rapporterede mønster: 6 redeploys på 30 min (12/7+13/7).

test("deploy-klynge (6 redeploys/30min) på CRON_MONITOR_5MIN (margin=10) — ingen alarm", () => {
  const restarts = [0, 6, 11, 17, 23, 29]; // minutter — matcher #2440-issuets 6-på-30-min
  const result = simulateCronMonitor({
    intervalMin: 5,
    marginMin: 10, // #2440-fix
    thresholdN: 2,
    okTimes: restarts,
    horizonMin: 30,
  });
  assert.equal(result.alarmFired, false, "boot-priming + margin=10 skal absorbere klyngen");
});

test("en klynge med ét ujævnt gap (18 min) på DEN GAMLE margin=5 ville have alarmeret (root-cause-bevis)", () => {
  // Deploy-klynger er ikke perfekt jævnt fordelt — ét langsommere Railway-boot
  // midt i klyngen (fx health-check-retries) giver et enkelt større gap. Med
  // margin=5 er tærsklen for 2 sammenhængende misses 2×5+5=15 min: et gap på 18
  // min overskrider det → alarm, SELVOM boot-priming stadig nulstiller streaken
  // ved hver genstart. Det er præcis den sårbarhed #2440-bumpet (margin→10, som
  // hæver tærsklen til 20 min) lukker — se testen ovenfor for samme scenarie.
  const restarts = [0, 6, 11, 29];
  const result = simulateCronMonitor({
    intervalMin: 5,
    marginMin: 5, // pre-#2440 værdi
    thresholdN: 2,
    okTimes: restarts,
    horizonMin: 30,
  });
  assert.equal(
    result.alarmFired,
    true,
    "dokumenterer at margin=5 alene ikke var nok ved et ujævnt gap i klyngen — derfor bump til 10"
  );
});

test("samme ujævne klynge (18 min gap) på DEN NYE margin=10 — ingen alarm", () => {
  const restarts = [0, 6, 11, 29];
  const result = simulateCronMonitor({
    intervalMin: 5,
    marginMin: 10, // #2440-fix
    thresholdN: 2,
    okTimes: restarts,
    horizonMin: 30,
  });
  assert.equal(result.alarmFired, false, "margin=10 (tærskel 20 min) absorberer det 18-min gap");
});

test("selv en tættere/ujævn deploy-klynge (gaps ned til 4 min) klarer sig med margin=10", () => {
  // Worst-case variant: uens gaps, mindste gap 4 min (hurtigere end den observerede cadence).
  const restarts = [0, 4, 9, 14, 22, 29];
  const result = simulateCronMonitor({
    intervalMin: 5,
    marginMin: 10,
    thresholdN: 2,
    okTimes: restarts,
    horizonMin: 30,
  });
  assert.equal(result.alarmFired, false);
});

// ── 3. Reelt død cron: ALARM inden for dokumenteret tid ───────────────────────
// Ingen flere redeploys/priming efter t=0 — jobbet er reelt stoppet med at ticke.

test("reelt død 5-min-cron alarmerer inden for ≤45 min (dokumenteret bound)", () => {
  const result = simulateCronMonitor({
    intervalMin: 5,
    marginMin: 10,
    thresholdN: 2,
    okTimes: [0],
    horizonMin: 200,
  });
  assert.equal(result.alarmFired, true, "en ægte død cron skal stadig alarmere");
  assert.equal(result.alarmTime, 20, "2×5min + 10min margin = 20 min");
  assert.ok(result.alarmTime <= 45, "skal ligge inden for accept-kriteriets ≤30-45 min");
});

test("reelt død 1-min-cron (auctions, uændret config) alarmerer hurtigt", () => {
  const result = simulateCronMonitor({
    intervalMin: 1,
    marginMin: 3,
    thresholdN: 2,
    okTimes: [0],
    horizonMin: 60,
  });
  assert.equal(result.alarmFired, true);
  assert.equal(result.alarmTime, 5, "2×1min + 3min margin = 5 min");
});

test("reelt død 24h-cron (debt-warnings, uændret config) alarmerer inden for få timer efter dagen", () => {
  // 24h-jobbet har intet failureIssueThreshold sat (default Sentry-adfærd = 1),
  // så modellen her bruger threshold=1: ét udeblevet døgn-tick + 180min margin.
  const result = simulateCronMonitor({
    intervalMin: 24 * 60,
    marginMin: 180,
    thresholdN: 1,
    okTimes: [0],
    horizonMin: 24 * 60 + 200,
  });
  assert.equal(result.alarmFired, true);
  assert.equal(result.alarmTime, 24 * 60 + 180);
});
