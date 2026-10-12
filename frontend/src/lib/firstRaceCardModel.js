// #1140 Pakke A: ren model til "Your first race"-kortet paa dashboardet.
// Ingen React, ingen DB: DashboardPage sender de data den allerede har hentet
// (loeb, naeste etape-tid, "mangler udtagelse"-signalet) plus de server-afgjorte
// booleans fra GET /api/me/first-race-card, og faar tilbage hvad kortet skal sige.
//
// Tider vises i SPILLERENS egen tidszone (Intl uden eksplicit zone), ikke i
// Koebenhavn-tid. Dag-tilstanden (i dag / i morgen / dato) afgoeres i samme zone,
// saa "tomorrow" aldrig siger noget andet end uret paa spillerens skaerm.
//
// Tre tilstande:
//   upcoming  loebet er ikke startet; truppen kan udtages (eller er gemt)
//   started   loebet er i gang; truppen er laast, naeste etape + tidspunkt
//   pause     intet kommende udtageligt loeb: hvornaar starter naeste saeson/loeb
import { orderedSelectableRaces } from "./nextSelectableRace.js";
import { dateTextToDayOfYear } from "./raceCalendar.js";
import { deriveRaceStatus } from "./raceHubLogic.js";

// Forventet tid fra etapestart til resultatet staar paa dashboardet. Matcher
// mockuppen ("12:00 -> ca. 13:00"); kortet siger altid "ca.".
export const RESULT_DELAY_MS = 60 * 60 * 1000;

function dayStamp(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

/** "today" | "tomorrow" | "date": kalenderdagen i spillerens zone, relativt til nu. */
export function dayKeyFor(targetMs, nowMs, timeZone) {
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) return "date";
  const target = dayStamp(targetMs, timeZone);
  if (target === dayStamp(nowMs, timeZone)) return "today";
  // "I morgen" = naeste KALENDERDAG, ikke nu + 24 t (ved sommertid-skift er en
  // dag 23 eller 25 timer).
  const [y, m, d] = dayStamp(nowMs, timeZone).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return target === next ? "tomorrow" : "date";
}

export function formatClock(ms, { timeZone, locale } = {}) {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

export function formatDayLabel(ms, { timeZone, locale } = {}) {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
}

/** Et tidspunkt som tre dele kortet saetter sammen med oversatte noegler. */
export function describeMoment(ms, nowMs, opts = {}) {
  return {
    ms,
    dayKey: dayKeyFor(ms, nowMs, opts.timeZone),
    clock: formatClock(ms, opts),
    dayLabel: formatDayLabel(ms, opts),
  };
}

/**
 * Hvilket loeb handler kortet om? Det tidligste udtagelige loeb (det spilleren
 * kan handle paa), ellers et loeb der allerede er i gang. Intet → null (pause).
 * @returns {{race: object, kind: "upcoming"|"started"}|null}
 */
export function pickFirstRaceCardRace(nextRaces, enteredRaceIds = null) {
  const selectable = orderedSelectableRaces(nextRaces)[0];
  if (selectable) return { race: selectable, kind: "upcoming" };
  // Et loeb i gang er kun holdets hvis holdet ER tilmeldt det (#3751: et nyt hold
  // der kommer midt i et etapeloeb er ikke med, trup laast). Ukendt = ikke vist.
  const live = (Array.isArray(nextRaces) ? nextRaces : [])
    .filter((r) => deriveRaceStatus(r?.status, r?.stages_completed, r?.stages) === "live")
    .filter((r) => enteredRaceIds instanceof Set && enteredRaceIds.has(r.id))
    .sort((a, b) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text))[0];
  return live ? { race: live, kind: "started" } : null;
}

/**
 * @param {object} p
 * @param {object[]} p.nextRaces                holdets puljeloeb (DashboardPage)
 * @param {Record<string, number>} p.nextStageByRace  loeb-id → ms for naeste etape
 * @param {object|null} p.squadSelectionMissingRace   loebet der mangler udtagelse (eller null)
 * @param {Set<string>|null} p.enteredRaceIds   loeb holdet er tilmeldt (kun disse tæller som "i gang")
 * @param {{assistant_picks?: boolean, mail?: boolean, next_season_start?: string|null}} p.card
 * @param {number} p.nowMs
 * @param {string} [p.timeZone]  default: spillerens egen
 * @param {string} [p.locale]
 */
export function buildFirstRaceCardModel({
  nextRaces, nextStageByRace = {}, squadSelectionMissingRace = null, enteredRaceIds = null, card = {}, nowMs, timeZone, locale,
}) {
  const opts = { timeZone, locale };
  const picked = pickFirstRaceCardRace(nextRaces, enteredRaceIds);

  if (!picked) {
    const seasonMs = card.next_season_start ? Date.parse(card.next_season_start) : NaN;
    return {
      kind: "pause",
      race: null,
      nextSeasonStart: Number.isFinite(seasonMs) ? describeMoment(seasonMs, nowMs, { ...opts, timeZone: timeZone ?? "UTC" }) : null,
      showCta: false,
    };
  }

  const { race, kind } = picked;
  const startMs = nextStageByRace[race.id];
  const hasStart = Number.isFinite(startMs);
  const stages = Number.isFinite(race.stages) && race.stages > 0 ? race.stages : 1;
  const stageNumber = (race.stages_completed ?? 0) + 1;
  const selectionMissing = Boolean(squadSelectionMissingRace && squadSelectionMissingRace.id === race.id);
  const upcoming = kind === "upcoming";

  return {
    kind,
    race,
    raceName: race.name,
    stages,
    isStageRace: stages > 1,
    stageNumber,
    start: hasStart ? describeMoment(startMs, nowMs, opts) : null,
    startMs: hasStart ? startMs : null,
    // Foerste etapes resultat foeres her ca. en time efter start.
    resultAt: hasStart ? describeMoment(startMs + RESULT_DELAY_MS, nowMs, opts) : null,
    // "Now"-linjen findes kun foer start. Gemt trup: en kortere variant uden knap.
    showNow: upcoming,
    selectionMissing: upcoming && selectionMissing,
    // KUN naar assistenten faktisk vaelger for holdet (serveren afgoer det).
    showAssistant: upcoming && selectionMissing && card.assistant_picks === true,
    // KUN naar spilleren faktisk faar en mail (serveren afgoer det).
    mentionMail: card.mail === true,
    // Den ene guld-knap: kun naar der er noget at udtage.
    showCta: upcoming && selectionMissing,
    ctaTo: `/races/${race.id}#selection`,
  };
}
