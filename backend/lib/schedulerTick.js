/**
 * Klokke-justeret tick (#3624 trin 1).
 * ====================================
 * Rod-aarsag (natboelgen 23/9, 279 etaper): etape-scheduleren tikkede med et
 * `setInterval` paa 5 min, der taeller fra processens start, ikke fra klokken.
 * Etaperne er planlagt paa hele klokkeslaet, saa ventetiden fra planlagt tid til
 * foerste tick afhang af hvornaar Railway sidst genstartede backend'en: fra 0 til
 * knap 5 min, og samme fase hele dagen indtil naeste deploy. Opsamlings-ventetiden
 * var den stoerste enkeltpost i maalingen (47 % af etape-minutterne).
 *
 * Fix: tikket ligger paa faste klokkeslaet (hh:00:05, hh:05:05, hh:10:05 ...).
 * Hvert tick beregner selv sit naeste tidspunkt ud fra uret, saa hverken drift i
 * timeren eller en genstart kan flytte fasen. De 5 s efter det hele minut giver
 * etaper planlagt praecis paa minuttet en lille margen.
 *
 * Bevidst UAENDRET i forhold til setInterval:
 *   - Samme kadence (12 ticks i timen), saa samme antal DB-opslag.
 *   - Naeste tick armeres FOER det aktuelle koeres, og det aktuelle awaites
 *     ikke. Et langt tick flytter altsaa ikke fasen; overlap-guarden (#2090) i
 *     kalderen springer de mellemliggende ticks over praecis som foer.
 *   - Fejlhaandtering bor i kalderen (trackedTick), ikke her.
 *
 * Tiderne er epoch-ms. Kadencer der gaar op i en time (5 min) ligger paa samme
 * minuttal i UTC og i dansk tid, fordi tidszonerne kun adskiller sig med hele
 * timer.
 */

export const STAGE_TICK_PERIOD_MS = 5 * 60 * 1000;
export const STAGE_TICK_OFFSET_MS = 5 * 1000;
// Foerste tick efter boot ligger mindst saa langt fremme. Containerens netvaerk
// er ikke altid klar i de allerfoerste sekunder efter en kold start (#5015), og
// et tick der rammer der, fejler til Sentry uden at sige noget om scheduleren.
// Koster hoejst eet tick ekstra ventetid, og kun naar en genstart lander lige
// foer et tick-tidspunkt.
export const STAGE_TICK_MIN_FIRST_DELAY_MS = 30 * 1000;

function assertTiming({ periodMs, offsetMs, minDelayMs }) {
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw new RangeError(`periodMs skal vaere et positivt tal (fik ${periodMs})`);
  }
  if (!Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs >= periodMs) {
    throw new RangeError(`offsetMs skal ligge i [0, periodMs) (fik ${offsetMs})`);
  }
  if (!Number.isFinite(minDelayMs) || minDelayMs < 0) {
    throw new RangeError(`minDelayMs skal vaere >= 0 (fik ${minDelayMs})`);
  }
}

/**
 * Naeste tick-tidspunkt paa gitteret `k * periodMs + offsetMs`.
 *
 * Tidspunktet ligger altid STRENGT efter `nowMs` (et tick der fyrer praecis paa
 * sit slot, faar det naeste slot, aldrig sig selv igen) og mindst `minDelayMs`
 * efter `nowMs`.
 *
 * @param {number} nowMs epoch-ms
 * @param {{periodMs?: number, offsetMs?: number, minDelayMs?: number}} [opts]
 * @returns {number} epoch-ms for naeste tick
 */
export function nextClockAlignedTickMs(nowMs, {
  periodMs = STAGE_TICK_PERIOD_MS,
  offsetMs = STAGE_TICK_OFFSET_MS,
  minDelayMs = 0,
} = {}) {
  if (!Number.isFinite(nowMs)) throw new RangeError(`nowMs skal vaere et tal (fik ${nowMs})`);
  assertTiming({ periodMs, offsetMs, minDelayMs });
  let slot = Math.floor((nowMs - offsetMs) / periodMs) * periodMs + offsetMs + periodMs;
  const earliest = nowMs + minDelayMs;
  if (slot < earliest) slot += Math.ceil((earliest - slot) / periodMs) * periodMs;
  return slot;
}

/**
 * Koer `fn` paa klokke-justerede tidspunkter, som en erstatning for
 * `setInterval(fn, periodMs)`.
 *
 * Hver fyring armerer naeste timer ud fra uret, foer `fn` kaldes. Er timeren
 * fyret en anelse for tidligt (eller uret er justeret tilbage), regnes der fra
 * det slot timeren var armeret til, saa et slot aldrig koeres to gange.
 *
 * @param {() => unknown} fn kaldes uden await; skal selv haandtere sine fejl
 * @param {object} [opts]
 * @param {number} [opts.periodMs]
 * @param {number} [opts.offsetMs]
 * @param {number} [opts.minFirstDelayMs] mindste afstand fra start til foerste tick
 * @param {() => number} [opts.now] injicerbart ur (test)
 * @param {typeof setTimeout} [opts.setTimeoutFn] injicerbar timer (test)
 * @param {typeof clearTimeout} [opts.clearTimeoutFn]
 * @param {(err: unknown) => void} [opts.onError] fanger en fejl fra `fn`, saa kaeden lever videre
 * @returns {{ stop: () => void, nextTickAt: () => number | null }}
 */
export function startClockAlignedInterval(fn, {
  periodMs = STAGE_TICK_PERIOD_MS,
  offsetMs = STAGE_TICK_OFFSET_MS,
  minFirstDelayMs = STAGE_TICK_MIN_FIRST_DELAY_MS,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onError = (err) => console.error("Klokke-justeret tick fejlede:", err?.message || err),
} = {}) {
  if (typeof fn !== "function") throw new TypeError("fn skal vaere en funktion");
  assertTiming({ periodMs, offsetMs, minDelayMs: minFirstDelayMs });

  let timer = null;
  let armedFor = null;
  let stopped = false;

  const arm = (minDelayMs) => {
    const nowMs = now();
    const base = armedFor == null ? nowMs : Math.max(nowMs, armedFor);
    armedFor = nextClockAlignedTickMs(base, { periodMs, offsetMs, minDelayMs });
    timer = setTimeoutFn(fire, Math.max(0, armedFor - nowMs));
  };

  function fire() {
    if (stopped) return;
    arm(0);
    try {
      const result = fn();
      if (result && typeof result.then === "function") result.then(undefined, onError);
    } catch (err) {
      // best-effort: en fejl fra fn maa ikke stoppe kaeden (naeste timer er allerede
      // armeret ovenfor). Den sendes til onError; i cron.js er fn wrappet i
      // trackedTick, som selv logger og captureException'er alt.
      onError(err);
    }
  }

  arm(minFirstDelayMs);

  return {
    stop() {
      stopped = true;
      if (timer != null) clearTimeoutFn(timer);
    },
    nextTickAt: () => (stopped ? null : armedFor),
  };
}
