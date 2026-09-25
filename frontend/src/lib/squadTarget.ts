// #5748 (ejer-go A 25/9): én flyt-dialog for alle trupper. Denne fil afgør,
// for en given rytter, hvilke af de tre trupper (senior / U23 / junior) han kan
// flyttes til, og hvorfor en række er spærret. Dialogen (AcademyTransferConfirm-
// Modal) og begge flader der åbner den (rytterprofilen og My Team) læser reglen
// herfra, så der kun findes ÉN frontend-udgave af den.
//
// Reglen er YOUTH_RULES.md §2 (ejer 2/9, LÅST) og backend moveRider() (#5432):
//   • OPAD er altid tilladt (en 17-årig må stå på U23-holdet eller i senior).
//   • NEDAD kun inden for mål-truppens aldersloft: junior <= 18, U23 <= 22.
//   • Altid kun med ledig plads i mål-truppen.
// Backend håndhæver reglen igen under låsen; frontenden er kun et UX-spejl, der
// forklarer spærringen FØR klikket i stedet for bagefter.
//
// SPEJL af backend/lib/squads.js SQUAD_MAX_AGE og effectiveSquad (samme mønster
// som squadCaps.ts). Ret squads.js og denne fil i samme PR, hvis grænserne
// nogensinde ændres.
//
// #5742-forgængeren (demoteNaturalTargetSquad/demoteSquadOptions) kunne kun
// navngive den "naturlige" ungdomstrup for en senior-rytter; den er erstattet
// af moveSquadRows nedenfor, der dækker alle tre retninger.
//
// Ren .ts uden React-import, så node --test kan loade den.

import { ACADEMY_SQUAD_WHEN_AGE_UNKNOWN, JUNIOR_MAX_SEASON_AGE } from "./squadCaps.ts";
import { isYouthSquad, type YouthSquad } from "./youthSquadPages.ts";

export type Squad = "senior" | YouthSquad;

/** Højeste sæsonalder i U23-truppen. Spejl af backend/lib/squads.js SQUAD_MAX_AGE.u23. */
export const U23_MAX_SEASON_AGE = 22;

/** Dialogens faste rækkefølge: højeste trup øverst. */
export const MOVE_SQUAD_ORDER: readonly Squad[] = Object.freeze(["senior", "u23", "junior"]);

/** Aldersloft pr. trup. null = intet loft (senior). */
export const SQUAD_MAX_SEASON_AGE: Readonly<Record<Squad, number | null>> = Object.freeze({
  junior: JUNIOR_MAX_SEASON_AGE,
  u23: U23_MAX_SEASON_AGE,
  senior: null,
});

const SQUAD_RANK: Readonly<Record<Squad, number>> = Object.freeze({ junior: 0, u23: 1, senior: 2 });

export function isSquad(value: unknown): value is Squad {
  return value === "senior" || isYouthSquad(value);
}

function isAge(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Truppen en sæsonalder hører til (junior <= 18, U23 19-22, ellers senior). null ved ukendt alder. */
export function squadForSeasonAge(seasonAge: number | null | undefined): Squad | null {
  if (!isAge(seasonAge)) return null;
  if (seasonAge <= JUNIOR_MAX_SEASON_AGE) return "junior";
  if (seasonAge <= U23_MAX_SEASON_AGE) return "u23";
  return "senior";
}

export interface SquadRiderState {
  squad?: string | null;
  is_academy?: boolean | null;
}

/**
 * Rytterens NUVÆRENDE trup. Spejl af backend squads.js effectiveSquad +
 * academyTransfer.js currentSquadOf: riders.squad ejer sandheden; en
 * akademirytter uden trup (før #4619-backfill'en) står i den ungdomstrup hans
 * alder hører til, og junior ved ukendt alder.
 */
export function currentSquadOf(rider: SquadRiderState | null | undefined, seasonAge: number | null | undefined): Squad {
  const squad = rider?.squad;
  if (isYouthSquad(squad)) return squad;
  if (rider?.is_academy === true) {
    const byAge = squadForSeasonAge(seasonAge);
    if (byAge === null) return ACADEMY_SQUAD_WHEN_AGE_UNKNOWN;
    return byAge === "senior" ? "u23" : byAge;
  }
  return "senior";
}

/** Retningen på en flytning. Spejl af squads.js squadMoveDirection. */
export function squadMoveDirection(from: Squad, to: Squad): "up" | "down" | "none" {
  const delta = SQUAD_RANK[to] - SQUAD_RANK[from];
  if (delta === 0) return "none";
  return delta > 0 ? "up" : "down";
}

/** Må en rytter med denne sæsonalder stå i truppen? Ukendt alder passer kun i senior. */
export function fitsSquadAge(squad: Squad, seasonAge: number | null | undefined): boolean {
  const max = SQUAD_MAX_SEASON_AGE[squad];
  if (max === null) return true;
  return isAge(seasonAge) && seasonAge <= max;
}

/** Tilladt ud fra alder og retning alene (pladser ikke medregnet). Samme gate som moveRider(). */
export function isAgeAllowedMove(from: Squad, to: Squad, seasonAge: number | null | undefined): boolean {
  const direction = squadMoveDirection(from, to);
  if (direction === "none") return false;
  return direction === "up" || fitsSquadAge(to, seasonAge);
}

/**
 * Har rytteren mindst ét lovligt mål? Styrer om "Move squad" overhovedet vises
 * (My Team-fanen og rytterprofilens knap). En fuld trup tæller stadig som et mål:
 * dialogen viser den i gråt med grunden, i stedet for at skjule handlingen.
 */
export function hasMoveTarget(from: Squad, seasonAge: number | null | undefined): boolean {
  return MOVE_SQUAD_ORDER.some((to) => isAgeAllowedMove(from, to, seasonAge));
}

export interface SquadPlaces {
  used: number | null;
  max: number | null;
}

export type MoveRowState = "current" | "tooOld" | "full" | "open";
/** Underteksten på en række. */
export type MoveRowHint = "current" | "tooOld" | "full" | "seniorPlace" | "natural" | "upward";

export interface MoveSquadRow {
  squad: Squad;
  state: MoveRowState;
  hint: MoveRowHint;
  used: number | null;
  max: number | null;
  /** Truppens aldersloft (til "Too old for Junior (max 18)"). */
  maxAge: number | null;
}

function isFull(places: SquadPlaces | null | undefined): boolean {
  const used = places?.used;
  const max = places?.max;
  return isAge(used) && isAge(max) && used >= max;
}

/**
 * Dialogens tre rækker i fast rækkefølge (senior, U23, junior), hver med sin
 * tilstand og undertekst. Et ukendt pladstal er aldrig "fuld": backend-RPC'en er
 * den autoritative gate (samme princip som squadCaps.isSquadFull).
 */
export function moveSquadRows({ currentSquad, seasonAge, places }: {
  currentSquad: Squad;
  seasonAge: number | null | undefined;
  places: Partial<Record<Squad, SquadPlaces | null>> | null | undefined;
}): MoveSquadRow[] {
  const natural = squadForSeasonAge(seasonAge);
  return MOVE_SQUAD_ORDER.map((squad) => {
    const p = places?.[squad] ?? null;
    const base = { squad, used: p?.used ?? null, max: p?.max ?? null, maxAge: SQUAD_MAX_SEASON_AGE[squad] };
    if (squad === currentSquad) return { ...base, state: "current", hint: "current" };
    if (!isAgeAllowedMove(currentSquad, squad, seasonAge)) return { ...base, state: "tooOld", hint: "tooOld" };
    if (isFull(p)) return { ...base, state: "full", hint: "full" };
    if (squad === "senior") return { ...base, state: "open", hint: "seniorPlace" };
    return { ...base, state: "open", hint: squad === natural ? "natural" : "upward" };
  });
}

/**
 * Forvalget når dialogen åbner (ejer-brief 25/9):
 *   • senior-rytter: hans naturlige ungdomstrup (sæsonalderen), ellers den
 *     anden åbne ungdomstrup.
 *   • ungdomsrytter: den ANDEN ungdomstrup hvis alderen og pladsen tillader det,
 *     ellers senior.
 * null = ingen række kan vælges (alt er spærret); bekræft-knappen er da låst.
 */
export function defaultMoveTarget(rows: readonly MoveSquadRow[], currentSquad: Squad, seasonAge: number | null | undefined): Squad | null {
  const open = new Set(rows.filter((r) => r.state === "open").map((r) => r.squad));
  const natural = squadForSeasonAge(seasonAge);
  const preference: Squad[] = currentSquad === "senior"
    ? [natural === "junior" || natural === "u23" ? natural : "u23", "u23", "junior"]
    : [currentSquad === "junior" ? "u23" : "junior", "senior"];
  return preference.find((squad) => open.has(squad)) ?? null;
}
