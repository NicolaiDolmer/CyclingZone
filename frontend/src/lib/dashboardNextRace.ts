// #7296 — "Næste løb" på forsiden skal pege på HOLDETS næste løb.
//
// Årsag: dashboardets udtagelses-nudge/-link gik kalenderen igennem
// (orderedSelectableRaces: tidligste ikke-startede løb i puljen efter statisk
// PCM-dato) uden at se på hvilke løb holdet faktisk er tilmeldt. Efter
// sæsonskiftet er puljens første løb ofte et andet end det holdet er tilmeldt
// og har udtaget ryttere til, så linket førte spilleren til et løb uden hans trup.
//
// Regel (ejer 30/10): det første ikke-kørte løb holdet er tilmeldt eller har
// ryttere udtaget til (mindst én race_entries-række). Har holdet intet sådant
// løb, bruges kalenderens næste løb. Et igangværende etapeløb er ikke udtageligt
// (trup låst, se nextSelectableRace.js) og springes derfor over her som dér.
//
// Ren funktion, ingen React/I/O. Muterer ikke input.

import { orderedSelectableRaces } from "./nextSelectableRace.js";

type RaceLike = { id?: string | null } & Record<string, unknown>;

/**
 * Kandidatløb i prioriteret rækkefølge: holdets egne løb først (kalenderorden),
 * derefter resten af kalenderen (kalenderorden) som fallback.
 */
export function orderedTeamNextRaces<T extends RaceLike>(
  races: T[] | null | undefined,
  enteredRaceIds: Set<string> | string[] | null | undefined,
): T[] {
  const calendar = orderedSelectableRaces(races) as T[];
  const entered = enteredRaceIds instanceof Set ? enteredRaceIds : new Set(enteredRaceIds ?? []);
  if (!entered.size) return calendar;
  const own = calendar.filter((r) => r?.id != null && entered.has(r.id));
  const rest = calendar.filter((r) => !(r?.id != null && entered.has(r.id)));
  return [...own, ...rest];
}

/**
 * Kandidater til udtagelses-nudgen med loft. Holdets egne løb og kalenderens
 * fallback får hver sit loft, så afmeldte egne løb (race_entries bevares ved
 * afmelding, stageRaceTransferDefer.js) aldrig kan skubbe kalenderens næste løb
 * ud af listen. Afmelding kendes først fra /selection, derfor ikke filtreret her.
 */
export function teamNudgeCandidates<T extends RaceLike>(
  races: T[] | null | undefined,
  enteredRaceIds: Set<string> | string[] | null | undefined,
  limit: number,
): T[] {
  const ordered = orderedTeamNextRaces(races, enteredRaceIds);
  const entered = enteredRaceIds instanceof Set ? enteredRaceIds : new Set(enteredRaceIds ?? []);
  const isOwn = (r: T) => r?.id != null && entered.has(r.id);
  return [...ordered.filter(isOwn).slice(0, limit), ...ordered.filter((r) => !isOwn(r)).slice(0, limit)];
}

/** Holdets næste løb, eller kalenderens næste hvis holdet intet har; ellers null. */
export function pickTeamNextRace<T extends RaceLike>(
  races: T[] | null | undefined,
  enteredRaceIds: Set<string> | string[] | null | undefined,
): T | null {
  return orderedTeamNextRaces(races, enteredRaceIds)[0] ?? null;
}
