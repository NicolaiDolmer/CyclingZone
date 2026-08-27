// #3858 (bølge 2 — Race Centre, mockup-kontrakt godkendt 17/8): ren afledning
// af "dagens løb som sendeflade". AL logik der afgør hvilke etaper der hører til
// i dag, hvilken korttilstand de har, og hvor langt den deterministiske
// LIVE-afspilning er nået, bor HER — testbar uden DOM (`node --test`).
// RaceCentrePage/RaceCentreCard er kun datahentning + rendering.
//
// ÆRLIGHED (samme princip som stageScheduleConfig.js): vi opfinder ingen tider.
// Kilden er race_stage_schedule.scheduled_at (absolut TIMESTAMPTZ) + races
// .stages_completed — præcis de to felter backend-scheduleren selv bruger.
//
// LIVE er DETERMINISTISK AFSPILNING, ikke realtime (issue-kontrakt: "INGEN
// websockets/realtime i v1"): når etapens slot er passeret, afledes afspilnings-
// positionen af (nu − scheduled_at) / afspilningsvinduet. Alle spillere ser
// derfor det samme uden en eneste socket.

import { RACE_TIMEZONE } from "./stageScheduleConfig.js";

// Afspilningsvinduet: hvor længe en kørt etape præsenteres som LIVE efter sit
// slot. 30 minutter er valgt så et etape-slot altid er "live" mens motoren
// skriver resultaterne og et stykke tid efter, uden at to slots på samme dag
// kan overlappe (slots ligger timer fra hinanden, se stageScheduler.js).
export const LIVE_PLAYBACK_WINDOW_MS = 30 * 60 * 1000;

// Hvilken København-kalenderdag falder et tidspunkt på? Samme Intl-baserede
// metode som relativeDayKey (stageScheduleConfig.js), så midnat-grænsen er
// korrekt uanset hvor spilleren selv sidder ([[feedback_timezone_copenhagen]]).
// Kontrakt: KASTER ALDRIG. Intl.DateTimeFormat kaster RangeError på en runtime
// der ikke kender zonen (stripped ICU), og kaldestederne bruger dagsnøglen midt
// i data-hentninger hvor et kast ville rive resten af hentningen med sig
// (#4293). En ukendt zone giver derfor null, præcis som en ugyldig ms, og hver
// kalder har allerede en null-gren.
export function copenhagenDayKey(ms, timeZone = RACE_TIMEZONE) {
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

// Zonens offset (ms) på et givet tidspunkt — afledt af Intl, så sommertid
// håndteres af tz-databasen i stedet for en hårdkodet +1/+2.
function zoneOffsetMs(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUtc = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}Z`);
  return asUtc - ms;
}

/** Absolut ms for København-midnat på det døgn `ms` falder i. */
export function copenhagenDayStart(ms, timeZone = RACE_TIMEZONE) {
  const key = copenhagenDayKey(ms, timeZone);
  if (key == null) return null;
  const guess = Date.parse(`${key}T00:00:00Z`);
  const first = guess - zoneOffsetMs(guess, timeZone);
  // Én korrektionsrunde rammer også de to DST-skiftedøgn.
  return guess - zoneOffsetMs(first, timeZone);
}

/**
 * [start, slut) for "i dag" i København som absolutte ms — bruges KUN til at
 * afgrænse scheduled_at-forespørgslen. Den præcise dag-filtrering sker bagefter
 * med isRaceDayToday, så et par timers slør i vinduet er harmløst (og bevidst:
 * padding gør at ingen slot-række kan falde ud på en DST-grænse).
 */
export function copenhagenDayRange(nowMs, timeZone = RACE_TIMEZONE, padMs = 2 * 60 * 60 * 1000) {
  const startMs = copenhagenDayStart(nowMs, timeZone);
  if (startMs == null) return null;
  // +25 t lander altid på næste kalenderdag, uanset sommertidsskifte.
  const endMs = copenhagenDayStart(startMs + 25 * 60 * 60 * 1000, timeZone);
  return { startMs: startMs - padMs, endMs: endMs + padMs };
}

/** Ligger `ms` på samme København-dag som `nowMs`? */
export function isRaceDayToday(ms, nowMs, timeZone = RACE_TIMEZONE) {
  const day = copenhagenDayKey(ms, timeZone);
  return day != null && day === copenhagenDayKey(nowMs, timeZone);
}

/**
 * Korttilstanden for ét etape-slot. Tre tilstande, præcis som mockup-kontrakten:
 *   "upcoming" — slottet er ikke nået endnu (nedtælling + opstillings-status)
 *   "live"     — slottet er passeret og enten (a) motoren har endnu ikke skrevet
 *                etapen færdig, eller (b) vi er inde i afspilningsvinduet
 *   "finished" — etapen er kørt OG afspilningsvinduet er passeret
 *
 * (a) er den ærlige tilstand: et slot der er forfaldent men uden resultater må
 * ALDRIG vises som færdigt (samme fælde som #3333's igangværende etapeløb).
 */
export function stageCardState({ scheduledMs, nowMs, stageCompleted, windowMs = LIVE_PLAYBACK_WINDOW_MS }) {
  if (!Number.isFinite(scheduledMs) || !Number.isFinite(nowMs)) return null;
  if (nowMs < scheduledMs) return "upcoming";
  if (!stageCompleted) return "live";
  return nowMs - scheduledMs < windowMs ? "live" : "finished";
}

/**
 * Deterministisk afspilningsposition i km. Lineær over afspilningsvinduet:
 * ved slot-tid = km 0, ved vinduets slut = mål. Samme (scheduled_at, nu) giver
 * samme km for alle spillere — ingen servertilstand involveret.
 */
export function playbackKm({ scheduledMs, nowMs, distanceKm, windowMs = LIVE_PLAYBACK_WINDOW_MS }) {
  if (!Number.isFinite(scheduledMs) || !Number.isFinite(nowMs)) return 0;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return distanceKm;
  const frac = Math.max(0, Math.min((nowMs - scheduledMs) / windowMs, 1));
  return frac * distanceKm;
}

// gap_update er kurvepunkter, ikke narrative linjer — samme udelukkelse som
// stageTimelineFilm.js' NON_FEED_TYPES og stageTimelineStory.js.
const NON_FEED_TYPES = new Set(["gap_update"]);

/**
 * Seneste film-linje: det sidste narrative event hvis km er nået i afspilningen.
 * Returnerer null når intet er sket endnu (afspilleren står ved km 0) eller når
 * etapen ikke har en tidslinje (S3-forward-only, spec §4 valg 3A) — kortet viser
 * da INGEN linje i stedet for en opfundet.
 */
export function latestFilmEvent(events, km) {
  if (!Array.isArray(events) || !events.length) return null;
  if (!Number.isFinite(km)) return null;
  let best = null;
  for (const event of events) {
    if (!event || NON_FEED_TYPES.has(event.type)) continue;
    if (!Number.isFinite(event.km) || event.km > km) continue;
    if (!best || event.km >= best.km) best = event;
  }
  return best;
}

const STATE_ORDER = { live: 0, upcoming: 1, finished: 2 };

/**
 * Byg dagens kort ud af (etape-slots × løbs-fremdrift) og sortér dem som
 * sendefladen kræver: LIVE først, derefter det der venter (nærmeste slot
 * øverst), til sidst det der er kørt (nyeste øverst).
 *
 * @param {Array<{raceId:string, stageNumber:number, scheduledMs:number, stagesCompleted?:number}>} slots
 * @param {{nowMs:number, windowMs?:number, timeZone?:string, todayOnly?:boolean}} opts
 * @returns {Array} nye objekter med `state`; muterer ikke input
 */
export function buildRaceCentreCards(slots, {
  nowMs,
  windowMs = LIVE_PLAYBACK_WINDOW_MS,
  timeZone = RACE_TIMEZONE,
  todayOnly = true,
} = {}) {
  if (!Array.isArray(slots)) return [];
  return slots
    .filter((slot) => Number.isFinite(slot?.scheduledMs))
    .filter((slot) => !todayOnly || isRaceDayToday(slot.scheduledMs, nowMs, timeZone))
    .map((slot) => ({
      ...slot,
      state: stageCardState({
        scheduledMs: slot.scheduledMs,
        nowMs,
        stageCompleted: (slot.stagesCompleted ?? 0) >= slot.stageNumber,
        windowMs,
      }),
    }))
    .filter((card) => card.state != null)
    .sort((a, b) => {
      const order = STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (order !== 0) return order;
      // Færdige løb vises nyeste-først; live/kommende nærmeste-først.
      return a.state === "finished" ? b.scheduledMs - a.scheduledMs : a.scheduledMs - b.scheduledMs;
    });
}

/**
 * Top-N af en etapes resultater med managerens egne ryttere markeret. Ren
 * projektion — resultaterne kommer altid fra race_results (aldrig genberegnet).
 */
export function stagePodium(results, { ownTeamId, limit = 3 } = {}) {
  if (!Array.isArray(results)) return [];
  return results
    .filter((row) => Number.isFinite(row?.rank))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((row) => ({ ...row, isOwn: ownTeamId != null && row.team_id === ownTeamId }));
}

/**
 * Managerens bedst placerede rytter i etapen — kortets "din dag"-linje når
 * ingen af holdets ryttere nåede top-N. Returnerer null hvis holdet ikke kørte.
 */
export function ownBestResult(results, ownTeamId) {
  if (!Array.isArray(results) || ownTeamId == null) return null;
  let best = null;
  for (const row of results) {
    if (row?.team_id !== ownTeamId || !Number.isFinite(row?.rank)) continue;
    if (!best || row.rank < best.rank) best = row;
  }
  return best;
}
