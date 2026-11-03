// #2328 — "Kommende løb"-kortet på Dashboard viste forkerte løb: top-3 blev
// valgt ved at sortere på pool_race.date_text (en statisk PCM-kalenderdato,
// ikke relateret til det ægte real-time-forløb) FØR den ægte etape-tid
// (race_stage_schedule.scheduled_at) overhovedet var hentet. Resultatet var
// et vilkårligt udsnit af puljens løb — ikke nødvendigvis de faktisk
// kommende (fx dagens etaper).
//
// pickUpcomingRaces sorterer i stedet på den ÆGTE næste-etape-tid
// (nextStageMsById, hentet fra race_stage_schedule) — så etaper der køres
// I DAG kommer først; er alle dagens etaper kørt, kommer næste dags etaper
// naturligt næst efter (højere scheduled_at-værdi). Løb hvor den ægte tid
// endnu ikke er hentet/kendt (mangler i nextStageMsById) placeres sidst,
// med den gamle PCM-dato som stabilt (men sekundært) sorteringskriterie.
//
// Pure → node --test-dækket, ingen React/I/O.

import { dateTextToDayOfYear } from "./raceCalendar.js";
import { deriveRaceStatus } from "./raceHubLogic.js";

type RaceLike = {
  id?: string | null;
  status?: string | null;
  stages?: number | null;
  stages_completed?: number | null;
  pool_race?: { date_text?: string | null } | null;
} & Record<string, unknown>;

// #3751 — kortet viste puljens løb, ikke holdets EGNE løb. Et hold der kommer
// til midt i et etapeløb er korrekt holdt ude af det løb (trup låst, se
// nextSelectableRace.js), men det igangværende løbs snarlige næste-etape-tid
// vandt alligevel sorteringen, så kortet viste en nedtælling til noget holdet
// ikke deltog i.
//
// #7539 — #3751-filteret krævede mindst én race_entries-række. En udtagelse der
// ikke er gemt giver ingen række, selvom assistenten stiller hold i alle
// divisionens løb, når de køres. Over halvdelen af de aktive menneskehold så
// derfor "Ingen planlagte løb" (prod 2/11).
//
// Regel nu: et løb vises når holdet er tilmeldt (race_entries) ELLER løbet ikke
// er startet endnu (status scheduled, 0 etaper kørt). Et løb der ikke er startet
// kan holdet ikke være låst ude af. Et løb i gang uden holdet, herunder et løb
// der startede før holdet fandtes, vises fortsat ikke (#3751).
//
// Filtreringen sker FØR sortering/limit, som et selvstændigt trin; sorterings-
// logikken i pickUpcomingRaces er uændret (#2328, må ikke rulles tilbage).
export function filterTeamUpcomingRaces<T extends RaceLike>(
  races: T[] | null | undefined,
  enteredRaceIds: Set<string> | string[] | null | undefined,
): T[] {
  if (!Array.isArray(races)) return [];
  const entered = enteredRaceIds instanceof Set ? enteredRaceIds : new Set(enteredRaceIds ?? []);
  return races.filter((race) => {
    if (race?.id != null && entered.has(race.id)) return true;
    return deriveRaceStatus(race?.status, race?.stages_completed, race?.stages) === "scheduled";
  });
}

/**
 * @param races
 * @param nextStageMsById race id -> ms (Date.parse af race_stage_schedule.scheduled_at
 *   for den næste uafviklede etape)
 * @param limit
 * @returns ny array, muterer ikke input
 */
export function pickUpcomingRaces<T extends RaceLike>(
  races: T[] | null | undefined,
  nextStageMsById: Record<string, number> = {},
  limit = 3,
): T[] {
  if (!Array.isArray(races)) return [];
  const msFor = (race: T): number | undefined =>
    race?.id != null ? nextStageMsById?.[race.id] : undefined;
  return races
    .map((race, index) => ({ race, index }))
    .sort((a, b) => {
      const aMs = msFor(a.race);
      const bMs = msFor(b.race);
      const aKnown = Number.isFinite(aMs);
      const bKnown = Number.isFinite(bMs);
      if (aKnown && bKnown && aMs !== bMs) return (aMs as number) - (bMs as number);
      if (aKnown && !bKnown) return -1;
      if (!aKnown && bKnown) return 1;
      const aDate = dateTextToDayOfYear(a.race?.pool_race?.date_text);
      const bDate = dateTextToDayOfYear(b.race?.pool_race?.date_text);
      if (aDate !== bDate) return aDate - bDate;
      return a.index - b.index; // stabil
    })
    .slice(0, limit)
    .map((entry) => entry.race);
}
