/**
 * Vaegur-planlaegning i dansk tid for job med fast tidspunkt (#6858).
 * =====================================================================
 * Rod-aarsag (maalt 18/10): soendagens vaerdiopdatering koerte kl. 14:17:45 i
 * stedet for kl. 14:00. Jobbet tikkede med `setInterval(..., 60 min)`, og den time
 * taelles fra processens start (Railway-deploy ca. kl. 13:17), ikke fra uret. Et
 * job med "efter kl. X"-gate ramte derfor X plus op til en time, alt efter
 * hvornaar der sidst blev deployet. Ejer-reglen (#5842) er "et fast tidspunkt".
 *
 * Denne fil er den lille egen planlaegger (ingen ny npm-pakke) oven paa
 * copenhagenTime.js:
 *   - nextWallClockSlotMs: REN funktion. Naeste forekomst af et vaegur-tidspunkt i
 *     Europe/Copenhagen strengt efter et givent instant. Sommer-/vintertid er
 *     indbygget, fordi hvert tidspunkt regnes fra den danske kalenderdato og
 *     klokkeslaettet, ikke ved at laegge 24 t til.
 *   - startWallClockSchedule: setTimeout til naeste forekomst, genplanlaeg efter
 *     koersel. Kaldes med en trackedTick-wrappet funktion, saa stopCronScheduling
 *     (#4150) og Sentry-capture virker uaendret.
 *
 * Et skema (spec) er { weekdays?, hour, minute?, repeatHourly? }:
 *   - weekdays: ugedags-noegler som copenhagenWeekdayKey ("sun".."sat"). Udeladt =
 *     hver dag.
 *   - hour/minute: det faste tidspunkt i dansk tid.
 *   - repeatHourly: koer ogsaa hver hele time derefter til midnat samme dag. Det er
 *     jobbenes eksisterende genforsoeg: gaten er "fra kl. X" (ikke "praecis kl.
 *     X"), og en fejlet eller udsat koersel (fx soendagens vaerdier mens
 *     saesonskiftet koerer) prøver igen naeste time. Det er samme vindue som det
 *     gamle times-interval gav, nu bare paa hele klokkeslaet.
 *
 * Bevidst:
 *   - Timeren sover hoejst MAX_SLEEP_MS ad gangen og regner efter hver opvaagning.
 *     En lang setTimeout foelger processens monotone ur; et justeret systemur eller
 *     en container der har sovet flytter saa hoejst tidspunktet indtil naeste
 *     opvaagning.
 *   - En timer der vaagner en anelse foer tid, sover videre. En forekomst koeres
 *     aldrig to gange: naeste forekomst regnes fra den der lige blev koert.
 *   - Er en forekomst gaaet tabt (processen var nede), koeres den ikke "bagud"
 *     her. Indhentning ved boot er jobbenes egen boot-run + claim (cron.js), eller
 *     naeste time via repeatHourly.
 *   - Opstarts-frist (startupGraceMs): en forekomst der falder kort efter boot,
 *     koeres foerst naar fristen er gaaet. Under et deploy lever den gamle og den
 *     nye proces samtidig (Railway healthcheckTimeout 60 s + drainingSeconds 150 s),
 *     og to processer der planlaegger efter samme ur ville fyre i samme sekund. Job
 *     med et atomisk claim taaler det; job der tjekker-og-sender (fx digest-DM'er)
 *     faar en frist der er laengere end overlappet.
 */
import {
  copenhagenDateString,
  copenhagenWallTimeToUTC,
  copenhagenWeekdayKey,
  formatCopenhagenDateTime,
} from "./copenhagenTime.js";

export const WEEKDAY_KEYS = Object.freeze(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]); // crontab-raekkefoelge (0 = soendag)
export const MAX_SLEEP_MS = 60 * 60 * 1000;
// Netvaerket i en kold container er ikke altid klar i de foerste sekunder (#5015).
export const DEFAULT_STARTUP_GRACE_MS = 30 * 1000;
// Laengere end det vaerste deploy-overlap (healthcheckTimeout 60 s + drainingSeconds
// 150 s i backend/railway.json) med god margin. Til job uden atomisk claim.
export const DEPLOY_OVERLAP_GRACE_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_DAYS = 8; // en uge + den dag vi staar i

/**
 * Validerer og normaliserer et skema. Kaster RangeError ved fejl, saa et forkert
 * skema stopper boot i stedet for at ligge tavst.
 * @param {{weekdays?: string[], hour: number, minute?: number, repeatHourly?: boolean}} spec
 */
export function normalizeWallClockSpec(spec) {
  if (!spec || typeof spec !== "object") throw new RangeError("vaegur-skema mangler");
  const { hour, minute = 0, weekdays = null, repeatHourly = false } = spec;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError(`hour skal vaere et heltal 0-23 (fik ${hour})`);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new RangeError(`minute skal vaere et heltal 0-59 (fik ${minute})`);
  if (weekdays !== null) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) throw new RangeError("weekdays skal vaere en ikke-tom liste eller udeladt");
    for (const key of weekdays) {
      if (!WEEKDAY_KEYS.includes(key)) throw new RangeError(`ukendt ugedag "${key}"`);
    }
  }
  return { hour, minute, weekdays: weekdays ? [...new Set(weekdays)] : null, repeatHourly: Boolean(repeatHourly) };
}

function addDays(dateStr, days) {
  // UTC-middag: samme DST-robuste trick som copenhagenWeekdayKey.
  return new Date(Date.parse(`${dateStr}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * REN funktion: naeste forekomst (epoch-ms) STRENGT efter `afterMs`.
 * @param {number} afterMs epoch-ms
 * @param {object} spec se normalizeWallClockSpec
 * @param {{primaryOnly?: boolean}} [opts] primaryOnly ignorerer repeatHourly (det
 *   faste tidspunkt alene; bruges af heartbeat-vagten og Sentry-skemaet)
 * @returns {number}
 */
export function nextWallClockSlotMs(afterMs, spec, { primaryOnly = false } = {}) {
  if (!Number.isFinite(afterMs)) throw new RangeError(`afterMs skal vaere et tal (fik ${afterMs})`);
  const { hour, minute, weekdays, repeatHourly } = normalizeWallClockSpec(spec);
  const hours = [];
  for (let h = hour; h <= (repeatHourly && !primaryOnly ? 23 : hour); h++) hours.push(h);

  const startDate = copenhagenDateString(new Date(afterMs));
  for (let d = 0; d <= SEARCH_DAYS; d++) {
    const dateStr = addDays(startDate, d);
    if (weekdays && !weekdays.includes(copenhagenWeekdayKey(dateStr))) continue;
    for (const h of hours) {
      const slot = copenhagenWallTimeToUTC(dateStr, h, minute);
      if (slot && slot.getTime() > afterMs) return slot.getTime();
    }
  }
  throw new RangeError("ingen vaegur-forekomst fundet inden for en uge (umuligt skema?)");
}

/**
 * Sentry-crontab for det faste tidspunkt ("0 14 * * 0" = soendag 14:00). Tolkes i
 * tidszonen Europe/Copenhagen (se wallClockMonitorConfig i cronMonitorRegistry.js).
 * repeatHourly er bevidst ikke med: monitoren vogter selve tidspunktet.
 */
export function crontabFromWallClock(spec) {
  const { hour, minute, weekdays } = normalizeWallClockSpec(spec);
  const dow = weekdays ? weekdays.map((key) => WEEKDAY_KEYS.indexOf(key)).sort((a, b) => a - b).join(",") : "*";
  return `${minute} ${hour} * * ${dow}`;
}

/** Laengste afstand mellem to faste tidspunkter, i sekunder (1 doegn eller op til 7). */
export function wallClockPeriodSeconds(spec) {
  const { weekdays } = normalizeWallClockSpec(spec);
  if (!weekdays) return DAY_MS / 1000;
  const idx = weekdays.map((key) => WEEKDAY_KEYS.indexOf(key)).sort((a, b) => a - b);
  let maxGapDays = 0;
  for (let i = 0; i < idx.length; i++) {
    const next = i + 1 < idx.length ? idx[i + 1] : idx[0] + 7;
    maxGapDays = Math.max(maxGapDays, next - idx[i]);
  }
  return maxGapDays * (DAY_MS / 1000);
}

/**
 * Koer `fn` paa vaegur-tidspunkterne i `spec`, som erstatning for et
 * `setInterval` + "efter kl. X"-gate.
 *
 * @param {() => unknown} fn kaldes uden await (i cron.js en trackedTick-wrapper)
 * @param {object} spec se normalizeWallClockSpec
 * @param {object} [opts]
 * @param {string} [opts.label] til log-linjen
 * @param {number} [opts.startupGraceMs] se filens header
 * @param {() => boolean} [opts.shouldStop] fx isCronSchedulingStopped: stop med at genplanlaegge
 * @param {() => number} [opts.now] injicerbart ur (test)
 * @param {typeof setTimeout} [opts.setTimeoutFn]
 * @param {typeof clearTimeout} [opts.clearTimeoutFn]
 * @param {(line: string) => void} [opts.log]
 * @param {(err: unknown) => void} [opts.onError]
 * @returns {{ stop: () => void, nextRunAt: () => number | null, nextSlotAt: () => number | null }}
 */
export function startWallClockSchedule(fn, spec, {
  label = "wallclock-job",
  startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
  shouldStop = () => false,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  log = (line) => console.log(line),
  onError = (err) => console.error(`Vaegur-job (${label}) fejlede:`, err?.message || err),
} = {}) {
  if (typeof fn !== "function") throw new TypeError("fn skal vaere en funktion");
  const normalized = normalizeWallClockSpec(spec);
  if (!Number.isFinite(startupGraceMs) || startupGraceMs < 0) throw new RangeError(`startupGraceMs skal vaere >= 0 (fik ${startupGraceMs})`);

  const startedAt = now();
  let slot = null;
  let fireAt = null;
  let timer = null;
  let stopped = false;

  const sleep = () => {
    const delay = Math.max(0, fireAt - now());
    timer = setTimeoutFn(wake, Math.min(delay, MAX_SLEEP_MS));
  };

  const armAfter = (afterMs) => {
    slot = nextWallClockSlotMs(afterMs, normalized);
    fireAt = Math.max(slot, startedAt + startupGraceMs);
    const deferred = fireAt > slot ? ` (efter opstarts-frist: ${formatCopenhagenDateTime(new Date(fireAt))})` : "";
    log(`⏰ ${label}: naeste koersel ${formatCopenhagenDateTime(new Date(slot))} dansk tid${deferred}`);
    sleep();
  };

  function wake() {
    timer = null;
    if (stopped) return;
    if (shouldStop()) {
      stopped = true;
      return;
    }
    if (now() < fireAt) {
      sleep(); // tidlig opvaagning eller et mellem-hop i en lang soevn
      return;
    }
    const firedSlot = slot;
    armAfter(Math.max(now(), firedSlot)); // naeste armeres FOER koerslen, ligesom schedulerTick.js
    try {
      const result = fn();
      if (result && typeof result.then === "function") result.then(undefined, onError);
    } catch (err) {
      onError(err); // en fejl maa ikke stoppe kaeden; naeste timer er allerede sat
    }
  }

  armAfter(startedAt);

  return {
    stop() {
      stopped = true;
      if (timer != null) clearTimeoutFn(timer);
      timer = null;
    },
    nextRunAt: () => (stopped ? null : fireAt),
    nextSlotAt: () => (stopped ? null : slot),
  };
}
