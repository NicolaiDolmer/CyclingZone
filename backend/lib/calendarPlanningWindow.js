// backend/lib/calendarPlanningWindow.js
// #5592 (ejer 23/9 kl. 22): mindst 24 timer til trupudtagelse.
//
// Ejeren ordret: "Sørge for at løbene om søndagen slutter tidligere og at løbene om
// mandagen starter senere end normalt, så der kommer til at være en noget længere periode
// end normalt, til at udtage trupper" + "gør det med flere timer, sådan det er mindst 24
// timer til at planlægge. Skal også tage højde for sæsonskiftet, der skal være nok tid til
// planlægning for managers fremadrettet."
//
// KUN VED SÆSONSKIFTET (ejer-præcisering 24/9 kl. 07:35, ordret): "Husk det kun er i
// forbindelse med sæsonskiftet. Det er ikke alle mandage og søndage der skal være påvirket.
// Kun disse der er i forbindelse med sæsonskiftet." Alle andre dage, også søndage og
// mandage midt i sæsonen, har TIER_STAGE_SLOTS uændret.
//
// TO REGLER, begge i dansk tid (Europe/Copenhagen) og målt i VIRKELIGE timer:
//
//   1. SÆSONENS SIDSTE LØBSDAG (dagen før skiftet) slutter tidligt: dagens slots presses
//      sammen fra dagens normale første slot til SEASON_LAST_DAY_END_SLOT (15:00), så
//      skiftet kan ske tidligt på dagen, og den nye sæsons første dag ikke skubbes sent.
//      Dagen starter som normalt, så kun dens sidste etaper rykker frem.
//
//   2. DEN NYE SÆSONS FØRSTE LØBSDAG. Første etape ligger, i HVER division, mindst 24
//      timer efter det TIDLIGST MULIGE sæsonskifte (resolveEarliestSeasonTransition):
//      starten på den afsluttende sæsons seneste etape på tværs af ALLE divisioner +
//      SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES. Skiftet kan ikke ske før, fordi
//      sæsonafslutningen er spærret til sidste løb er afviklet. Er
//      app_config.season_transition_planned_at sat og SENERE, vinder den. Kendes forrige
//      sæsons etaper ikke, gælder konventionen (aftenen før første løbsdag kl. 18,
//      seasonTransitionBoundary.js). Divisionens egen sidste etape tæller også (spiller-
//      teksten lover 24 t fra den gamle sæsons sidste løb), men den ligger aldrig senere
//      end det globale anker.
//
// ÉN KILDE. TIER_STAGE_SLOTS (en almindelig dag) bor her og re-eksporteres af
// tierCalendarMaterializer.js. Sæsonens sidste og første løbsdag UDLEDES af den med
// slotsFor(tier, dato, { seasonLastRaceDay, notBefore }); der findes ingen tabel ved siden
// af. Ændres en divisions normale slots, følger de to dage med af sig selv.
//
// Antal slots ændres aldrig: en dag har stadig præcis density slots (CALENDAR_RULES §1),
// og bane k kører stadig i slot k, så etaperækkefølgen inden for en dag er uændret.
//
// Alt her er RENT (ingen DB, intet ur) og testet i calendarPlanningWindow.test.js.

import { copenhagenDateString } from "./copenhagenTime.js";
import { computeSeasonTransitionBoundary } from "./seasonTransitionBoundary.js";

// Etape-tids-slots pr. division på en ALMINDELIG dag (alle ugedage, undtagen sæsonens
// sidste og første løbsdag): bane k → slots[k] (ejer-låst: div 3 = 12/15/18). Antal slots =
// density, så en dag aldrig har flere etaper end slots.
// #4270 (ejer-beslutning 3/9): D4 2 -> 3 slots, samme klokkeslaet som D3 (12/15/18).
// Antal slots skal FOELGE TIER_DENSITY - en dag maa aldrig have flere etaper end slots.
// #5592: flyttet hertil fra tierCalendarMaterializer.js (re-eksporteret der), saa
// slotsFor() kan udlede saesonens sidste/foerste dag uden en cirkulaer import.
export const TIER_STAGE_SLOTS = Object.freeze({
  1: Object.freeze(["11:00", "13:00", "15:00", "17:00", "19:00"]),
  2: Object.freeze(["12:00", "14:00", "16:00", "18:00"]),
  3: Object.freeze(["12:00", "15:00", "18:00"]),
  4: Object.freeze(["12:00", "15:00", "18:00"]),
});

/** Mindste pause fra det tidligst mulige sæsonskifte til den nye sæsons første etape. */
export const PLANNING_WINDOW_HOURS = 24;

/**
 * Minutter fra STARTEN på den afsluttende sæsons seneste etape (på tværs af alle
 * divisioner) til det tidligst mulige sæsonskifte. Dækker to ting:
 *   1. Afviklingen af den sidste etape. "Afslut sæson" er spærret så længe et løb ikke er
 *      afviklet (assessSeasonEndBlockers, seasonTransitionReadiness.js), og en slot med
 *      mange etaper er målt op til 10,7 min forsinket.
 *   2. Selve skiftet: sæsonafslutning + transition er en manuel admin-handling.
 * 30 min er diff-tjekkets tal (24/9 nat). Loftet er 60: S3 slutter med D1's etape kl. 19,
 * og med 30 min mindste-afstand kan D1's 5 etaper på S4's første dag højst starte kl. 20
 * for at slutte inden LATEST_STAGE_SLOT kl. 22 (testet i calendarPlanningWindow.test.js).
 */
export const SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES = 30;

/**
 * Sæsonens sidste løbsdag: dagens sidste etape, alle divisioner. Med skiftet 30 min efter
 * (bufferen) kan den nye sæsons første etape tidligst ligge kl. 15:30 dagen efter.
 */
export const SEASON_LAST_DAY_END_SLOT = "15:00";

/**
 * Mindste afstand mellem to slots når en dag presses sammen (sæsonens sidste og første dag).
 * Kun et gulv: normalt giver den jævne fordeling større afstand (D1's sidste dag = 1 time).
 */
export const COMPRESSED_SLOT_MIN_GAP_MINUTES = 30;

/**
 * Loft for enhver etape. Træningssweepen venter på dagens sidste etape og har
 * MAX_WAIT_HOUR 23 (trainingDayCloseTrigger.js), og dry-runnets dato-gruppering læser
 * UTC-datoen. En sæsonstart der ikke kan nå sine etaper inden loftet er en fejl, ikke et
 * klokkeslæt der skal skubbes over midnat.
 */
export const LATEST_STAGE_SLOT = "22:00";

const SLOT_ROUNDING_MINUTES = 5;
const HOUR_MS = 3_600_000;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** n slots jævnt fordelt fra lo til hi (minutter), afrundet til 5 minutter. n = 1 → [lo]. */
function spread(lo, hi, n) {
  if (n <= 1) return [toHHMM(lo)];
  const step = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const raw = i === n - 1 ? hi : lo + i * step;
    return toHHMM(Math.round(raw / SLOT_ROUNDING_MINUTES) * SLOT_ROUNDING_MINUTES);
  });
}

/** Sæsonens sidste løbsdag: fra dagens normale første slot til SEASON_LAST_DAY_END_SLOT. */
export function seasonLastDaySlots(base, { end = SEASON_LAST_DAY_END_SLOT, minGap = COMPRESSED_SLOT_MIN_GAP_MINUTES } = {}) {
  const n = base.length;
  if (!n) return [];
  const e = toMinutes(end);
  if (toMinutes(base[n - 1]) <= e) return [...base];
  const lo = Math.min(toMinutes(base[0]), e - (n - 1) * minGap);
  return spread(lo, e, n);
}

/** Dansk vægur for et øjeblik: { date: "YYYY-MM-DD", minutes } (sekunder rundes OP). */
const CLOCK_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
export function copenhagenClock(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = Object.fromEntries(CLOCK_FMT.formatToParts(d).map((p) => [p.type, p.value]));
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute) + (Number(parts.second) > 0 ? 1 : 0);
  return { date: copenhagenDateString(d), minutes };
}

/**
 * Sæsonskifte-reglen på én dag: ligger dagens første slot før `notBefore`, presses dagen
 * sammen fra `notBefore` (rundet op til 5 min). Dagens sidste slot flyttes kun så langt
 * som mindste-afstanden kræver.
 *
 * Kaster hvis dagen ligger FØR notBefore's dato, eller hvis slottene ikke kan nå at ligge
 * inden LATEST_STAGE_SLOT: så er sæsonstart og sæsonskifte uforenelige, og det skal et
 * menneske se - ikke en kalender der tavst afvikler etaper om natten.
 */
export function applySeasonStartNotBefore(slots, localDate, notBefore, {
  minGap = COMPRESSED_SLOT_MIN_GAP_MINUTES, latest = LATEST_STAGE_SLOT,
} = {}) {
  if (notBefore == null || !slots.length) return [...slots];
  const nb = copenhagenClock(notBefore);
  if (nb.date < localDate) return [...slots];
  if (nb.date > localDate) {
    throw new Error(`#5592: season start ${localDate} lies before the planning window ends (${new Date(notBefore).toISOString()}) — move the first race day or the season transition`);
  }
  const start = Math.ceil(nb.minutes / SLOT_ROUNDING_MINUTES) * SLOT_ROUNDING_MINUTES;
  const n = slots.length;
  if (toMinutes(slots[0]) >= start) return [...slots];
  const hi = Math.max(toMinutes(slots[n - 1]), start + (n - 1) * minGap);
  if (hi > toMinutes(latest)) {
    throw new Error(`#5592: ${n} stages on ${localDate} cannot start at ${toHHMM(start)} and end by ${latest} — move the first race day or the season transition`);
  }
  return spread(start, hi, n);
}

/**
 * DEN ENE KILDE til en dags etape-tider. Almindelig dag = TIER_STAGE_SLOTS, også søndage og
 * mandage midt i sæsonen. Kun de to dage omkring sæsonskiftet afviger:
 *   - `seasonLastRaceDay`: sæsonens sidste løbsdag slutter kl. 15 (seasonLastDaySlots).
 *   - `notBefore`: den nye sæsons første løbsdag starter tidligst 24 t efter det tidligst
 *     mulige skifte (applySeasonStartNotBefore; rører kun datoen for notBefore).
 *
 * @param {number} tier
 * @param {string} localDate  dansk kalenderdato "YYYY-MM-DD"
 * @param {{ slots?: object, notBefore?: Date|string|null, seasonLastRaceDay?: string|null }} [context]
 *        slots = tabel pr. tier (default TIER_STAGE_SLOTS); ukendt tier falder tilbage til tier 3,
 *        præcis som materializeren altid har gjort. seasonLastRaceDay = dansk dato "YYYY-MM-DD"
 *        for sæsonens sidste løbsdag (null = ingen).
 * @returns {string[]} "HH:MM"-slots, stigende, samme antal som tabellens
 */
export function slotsFor(tier, localDate, { slots = TIER_STAGE_SLOTS, notBefore = null, seasonLastRaceDay = null } = {}) {
  const base = slots?.[tier] ?? slots?.[3] ?? TIER_STAGE_SLOTS[3];
  const daySlots = seasonLastRaceDay != null && localDate === seasonLastRaceDay ? seasonLastDaySlots(base) : [...base];
  return applySeasonStartNotBefore(daySlots, localDate, notBefore);
}

/** Den danske kalenderdato for kalenderens første dag (buildScheduleRows: real_day 0 = from + 1). */
export function firstCalendarDay(from) {
  return addDaysToDate(copenhagenDateString(from), 1);
}

/**
 * Den danske kalenderdato for kalenderens SIDSTE dag: real_day realDays-1 = from + realDays
 * (buildScheduleRows). Det er sæsonens sidste løbsdag: horisonten er sæsonvinduet (§2's
 * søndags-slut i buildSeasonCalendar, sæsonens sidste etape-dato i en midt-sæson-aktivering).
 */
export function lastCalendarDay(from, realDays) {
  return addDaysToDate(copenhagenDateString(from), realDays);
}

function validInstant(value, label) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`#5592: ${label} is not a valid timestamp: ${value}`);
  return d;
}

/**
 * Hvornår en ny sæsons første etape tidligst må ligge (sæsonskifte-reglen).
 *
 * @param {{ from: Date, seasonTransitionAt?: Date|string|null, previousSeasonLastStageAt?: Date|string|null }} args
 *   seasonTransitionAt: undefined = udled konventionen (aftenen før første kalenderdag kl. 18,
 *     computeSeasonTransitionBoundary); null = reglen er slået fra (en pulje der aktiveres midt
 *     i en sæson er ikke en sæsonstart, §2e); en værdi = det faktiske sæsonskifte.
 *   previousSeasonLastStageAt: divisionens sidste etape i forrige sæson, hvis kendt.
 * @returns {Date|null}
 */
export function resolveSeasonStartNotBefore({ from, seasonTransitionAt, previousSeasonLastStageAt = null } = {}) {
  const anchors = [];
  if (seasonTransitionAt === undefined) {
    const derived = computeSeasonTransitionBoundary({ upcomingSeasonStartDate: firstCalendarDay(from) });
    if (derived) anchors.push(derived);
  } else if (seasonTransitionAt !== null) {
    anchors.push(validInstant(seasonTransitionAt, "seasonTransitionAt"));
  }
  if (previousSeasonLastStageAt != null) anchors.push(validInstant(previousSeasonLastStageAt, "previousSeasonLastStageAt"));
  if (!anchors.length) return null;
  const latestAnchor = Math.max(...anchors.map((a) => a.getTime()));
  return new Date(latestAnchor + PLANNING_WINDOW_HOURS * HOUR_MS);
}

/** Det seneste af en række tidspunkter (ugyldige/tomme springes over). null hvis ingen. */
export function latestInstant(values = []) {
  let best = null;
  for (const v of values) {
    if (v == null) continue;
    const t = (v instanceof Date ? v : new Date(v)).getTime();
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best == null ? null : new Date(best);
}

/**
 * Det sæsonskifte en ny sæsons kalender planlægges mod: det TIDLIGST MULIGE skifte.
 *
 * "Afslut sæson" er spærret til hvert løb er afviklet (assessSeasonEndBlockers), så skiftet
 * kan tidligst ske når den afsluttende sæsons seneste etape (på tværs af ALLE divisioner)
 * er afviklet og skiftet er kørt: dens start + bufferMinutes. Et planlagt skifte
 * (app_config.season_transition_planned_at) der ligger SENERE, vinder. Et planlagt skifte
 * der ligger tidligere, er umuligt (eller en efterladenskab fra en tidligere sæson) og taber.
 * Kendes forrige sæsons etaper ikke (første sæson, tom sæson), gælder den planlagte værdi,
 * og ellers konventionen: aftenen før første løbsdag kl. 18.
 *
 * Samme værdi sendes til kalenderen (seasonTransitionAt) og skrives til app_config ved
 * --apply, så de to aldrig kan komme ud af trit.
 *
 * @param {{ previousSeasonLastStageAt?: Date|string|null, plannedAt?: Date|string|null,
 *           firstRaceDay?: string|null, bufferMinutes?: number }} [args]
 *   previousSeasonLastStageAt: STARTEN på forrige sæsons seneste etape, alle divisioner.
 * @returns {{ at: Date|null, source: string, earliestPossibleAt: Date|null, plannedAt: Date|null }}
 */
export function resolveEarliestSeasonTransition({
  previousSeasonLastStageAt = null, plannedAt = null, firstRaceDay = null,
  bufferMinutes = SEASON_TRANSITION_PROCESSING_BUFFER_MINUTES,
} = {}) {
  const planned = plannedAt == null ? null : new Date(plannedAt);
  const plannedValid = planned != null && !Number.isNaN(planned.getTime()) ? planned : null;
  const lastStage = previousSeasonLastStageAt == null ? null : validInstant(previousSeasonLastStageAt, "previousSeasonLastStageAt");
  const earliestPossibleAt = lastStage ? new Date(lastStage.getTime() + bufferMinutes * 60_000) : null;

  if (earliestPossibleAt) {
    if (plannedValid && plannedValid.getTime() > earliestPossibleAt.getTime()) {
      return { at: plannedValid, source: "app_config (senere end det tidligst mulige skifte)", earliestPossibleAt, plannedAt: plannedValid };
    }
    return {
      at: earliestPossibleAt,
      source: `forrige sæsons seneste etape + ${bufferMinutes} min (afvikling + skifte)` +
        (plannedValid ? "; app_config-værdien er tidligere og kan ikke nås" : ""),
      earliestPossibleAt, plannedAt: plannedValid,
    };
  }
  // Ingen etaper at regne fra: det SENESTE af den planlagte værdi og konventionen, så en
  // efterladt værdi fra en tidligere sæson taber af sig selv.
  const derived = firstRaceDay ? computeSeasonTransitionBoundary({ upcomingSeasonStartDate: firstRaceDay }) : null;
  if (plannedValid && (!derived || plannedValid.getTime() > derived.getTime())) {
    return { at: plannedValid, source: "app_config", earliestPossibleAt: null, plannedAt: plannedValid };
  }
  return {
    at: derived,
    source: "konvention: aftenen før første løbsdag kl. 18" + (plannedValid ? " (app_config-værdien er ældre)" : ""),
    earliestPossibleAt: null, plannedAt: plannedValid,
  };
}

function addDaysToDate(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Mål de to dage omkring sæsonskiftet i en færdig tidsplan (race_stage_schedule-rækker for
 * ÉN pulje). Rent rapporterings-data: dommen ligger i detectPlanningWindowViolations.
 *
 * @param {Array<{scheduled_at: string}>} stageRows
 * @returns {{ firstStageAt: string|null, lastStageAt: string|null,
 *             days: Map<string, {first: number, last: number}> }}
 */
export function measurePlanningWindows(stageRows = []) {
  const days = new Map();
  let first = null;
  let last = null;
  for (const s of stageRows) {
    const t = Date.parse(s.scheduled_at);
    if (!Number.isFinite(t)) continue;
    const date = copenhagenDateString(new Date(t));
    const day = days.get(date) ?? { first: t, last: t };
    day.first = Math.min(day.first, t);
    day.last = Math.max(day.last, t);
    days.set(date, day);
    if (first == null || t < first) first = t;
    if (last == null || t > last) last = t;
  }
  return {
    firstStageAt: first == null ? null : new Date(first).toISOString(),
    lastStageAt: last == null ? null : new Date(last).toISOString(),
    days,
  };
}

/**
 * Hårdt krav uden override (#5592): begge regler, målt på den tidsplan der ville blive
 * skrevet. Returnerer brud som tekst; materializeren lægger dem i calendarViolations, så
 * de stopper --apply sammen med de øvrige kalender-invarianter.
 *   - første etape ligger ikke før `notBefore` (24 t efter det tidligst mulige skifte);
 *   - ingen etape på `seasonLastRaceDay` ligger efter SEASON_LAST_DAY_END_SLOT.
 */
export function detectPlanningWindowViolations({
  tier, stageRows = [], notBefore = null, seasonLastRaceDay = null,
  minHours = PLANNING_WINDOW_HOURS, lastDayEnd = SEASON_LAST_DAY_END_SLOT,
} = {}) {
  const violations = [];
  const { firstStageAt, days } = measurePlanningWindows(stageRows);
  if (notBefore != null && firstStageAt != null && Date.parse(firstStageAt) < validInstant(notBefore, "notBefore").getTime()) {
    violations.push(`tier ${tier}: season's first stage ${firstStageAt} lies before ${new Date(notBefore).toISOString()} (< ${minHours} h after the season transition) (#5592)`);
  }
  const lastDay = seasonLastRaceDay != null ? days.get(seasonLastRaceDay) : null;
  if (lastDay && copenhagenClock(lastDay.last).minutes > toMinutes(lastDayEnd)) {
    violations.push(`tier ${tier}: season's last race day ${seasonLastRaceDay} ends ${new Date(lastDay.last).toISOString()}, after ${lastDayEnd} Copenhagen time (#5592)`);
  }
  return violations;
}
