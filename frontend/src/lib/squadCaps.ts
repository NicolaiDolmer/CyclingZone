// #5568: loftet pr. ungdomstrup i frontenden (U23 / junior), ét sted.
//
// Før denne fil talte fire frontend-flader mod det gamle fælles akademi-loft på
// 8: budrummet (auctionBidRoom.js), nedrykningsdialogen (rytterprofil + holdside),
// akademi-siden og hjælpeteksterne. Databasen tæller siden #5547 pr. MÅL-trup
// med backend/lib/squads.js SQUAD_CAPS, så de 8 stoppede hold der reelt havde
// plads, og dialogen kunne vise "9 af 8".
//
// Tallene her er et SPEJL af backend (samme mønster som rulesNumbers.js):
//   SQUAD_CAPS                      <- squads.js SQUAD_CAPS
//   JUNIOR_MAX_SEASON_AGE           <- squads.js SQUAD_MAX_AGE.junior
//   ACADEMY_SQUAD_WHEN_AGE_UNKNOWN  <- squads.js ACADEMY_SQUAD_WHEN_AGE_UNKNOWN
// backend/lib/squadCapsDrift.test.js læser denne fil og fejler, hvis et af dem
// afviger fra backend, og fælder et nyt håndskrevet akademi-loft andre steder.
// Skal et loft ændres: ret squads.js og denne fil i samme PR.
//
// Ren .ts uden React-import, så node --test kan loade den.

import { ageForSeason } from "./riderAge.js";
import { YOUTH_SQUADS, type YouthSquad } from "./youthSquadPages.ts";

/** Loft pr. ungdomstrup. Spejl af backend/lib/squads.js SQUAD_CAPS. */
export const SQUAD_CAPS: Readonly<Record<YouthSquad, number>> = Object.freeze({ u23: 12, junior: 10 });

/** Højeste sæsonalder i junior-truppen. Spejl af squads.js SQUAD_MAX_AGE.junior. */
export const JUNIOR_MAX_SEASON_AGE = 18;

/** Trup for en akademirytter uden brugbar fødselsdato. Spejl af squads.js. */
export const ACADEMY_SQUAD_WHEN_AGE_UNKNOWN: YouthSquad = "junior";

/** Antal ryttere pr. ungdomstrup. null = endnu ikke hentet. */
export type SquadCounts = Record<YouthSquad, number | null>;

export const EMPTY_SQUAD_COUNTS: Readonly<SquadCounts> = Object.freeze({ u23: null, junior: null });

/**
 * Ungdomstruppen en rytter lander i, når han optages i akademiet (ungdomsauktion,
 * intake, nedrykning). Samme regel som backend academyPlacementSquad:
 * sæsonalder <= 18 -> junior, ellers u23 (også 23+, han skal da igennem
 * Graduation Day). Ukendt fødselsdato -> junior.
 *
 * Ukendt SÆSON giver null i stedet for et gæt: backend kaster i det tilfælde,
 * og et gæt her kunne vise den forkerte trup som fuld.
 */
export function academyTargetSquad(birthdate: string | null | undefined, seasonYear: number | null | undefined): YouthSquad | null {
  if (!Number.isFinite(seasonYear)) return null;
  const age = ageForSeason(birthdate, seasonYear);
  if (age === null) return ACADEMY_SQUAD_WHEN_AGE_UNKNOWN;
  return age <= JUNIOR_MAX_SEASON_AGE ? "junior" : "u23";
}

/**
 * Er truppen fuld? Et ukendt antal (null) eller en ukendt trup er aldrig fuld:
 * frontenden er kun et UX-spejl, backend-RPC'en er den autoritative gate, og vi
 * må hellere lade et bud gå til serveren end spærre en spiller der har plads.
 */
export function isSquadFull(squad: YouthSquad | null | undefined, counts: Partial<SquadCounts> | null | undefined): boolean {
  if (!squad || !(squad in SQUAD_CAPS)) return false;
  const used = counts?.[squad];
  return typeof used === "number" && Number.isFinite(used) && used >= SQUAD_CAPS[squad];
}

/** Rækkerne i trup-linjen "U23 5/12 · Junior 3/10", i fast rækkefølge. */
export function squadCapRows(counts: Partial<SquadCounts> | null | undefined): Array<{ squad: YouthSquad; used: number; max: number; full: boolean }> {
  return YOUTH_SQUADS.map((squad) => {
    const raw = counts?.[squad];
    const used = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    return { squad, used, max: SQUAD_CAPS[squad], full: used >= SQUAD_CAPS[squad] };
  });
}

interface DemoteQuoteSquad {
  targetSquad?: unknown;
  squadUsed?: unknown;
  squadMax?: unknown;
}

/**
 * Loft-rækken i nedrykningsdialogen: "U23 5 / 12 -> 6 / 12" for den trup
 * rytteren faktisk rykker ned i. Alle tre tal kommer fra backendens
 * academy-demote-quote (samme trup-valg og samme tælling som selve demote()).
 * Mangler quoten (netværk) returneres null, og dialogen udelader rækken i stedet
 * for at vise et fladt tal.
 */
export function demoteCapLabels(quote: DemoteQuoteSquad | null | undefined): { capSquad: YouthSquad; capLabel: string; capAfterLabel: string } | null {
  const squad = quote?.targetSquad;
  const used = quote?.squadUsed;
  const max = quote?.squadMax;
  if (squad !== "u23" && squad !== "junior") return null;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  if (typeof max !== "number" || !Number.isFinite(max)) return null;
  return { capSquad: squad, capLabel: `${used} / ${max}`, capAfterLabel: `${used + 1} / ${max}` };
}

interface CountQueryResult { count?: number | null; error?: unknown }
interface CountQueryBuilder extends PromiseLike<CountQueryResult> {
  eq(column: string, value: unknown): CountQueryBuilder;
}
interface RidersCountClient {
  from(table: "riders"): { select(columns: string, opts: { count: "exact"; head: true }): CountQueryBuilder };
}

/**
 * Holdets antal ryttere pr. ungdomstrup: to head-optællinger på `riders.squad`,
 * samme tælling som backend countSquadMembers (academyGraduation.js). Et fejlet
 * kald giver null for den trup (= "ikke fuld", se isSquadFull).
 */
export async function fetchAcademySquadCounts(client: RidersCountClient, teamId: string | null | undefined): Promise<SquadCounts> {
  if (!teamId) return { ...EMPTY_SQUAD_COUNTS };
  const results = await Promise.all(YOUTH_SQUADS.map((squad) =>
    client.from("riders").select("id", { count: "exact", head: true }).eq("team_id", teamId).eq("squad", squad),
  ));
  const counts: SquadCounts = { ...EMPTY_SQUAD_COUNTS };
  YOUTH_SQUADS.forEach((squad, i) => {
    const res = results[i];
    counts[squad] = !res?.error && typeof res?.count === "number" ? res.count : null;
  });
  return counts;
}
