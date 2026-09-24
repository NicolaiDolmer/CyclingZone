// #5648 (Y2, delissue af #5536) — frontend-siden af senior-scopet.
//
// A2 (#5517/#5525) lagde `squad` på `league_divisions` og `races` — uden et
// filter ville et U23-/juniorløb eller en ungdomspulje dukke op på siderne her,
// selvom kun senior kører i dag. Samme dom og samme or-filter som backend's
// `racePoolCatalog.js`/`squads.js` (`withSeniorSquadScope`), skrevet ÉN gang
// her i stedet for i hver side.
//
// S4-strukturens spec (risiko 3, docs/drafts/spec-s4-struktur-2026-09-24.md)
// lægger DESUDEN et andet filter oven på ÉT sted: `league_divisions.retired_at`
// (migrationen `2026-09-25-4592-d4-retire-pools.sql`, spor A2 #5642) skjuler
// pensionerede D4-puljer (E-H) for den AKTIVE sæson, men historiske sæsoner skal
// stadig kunne vise dem uændret. Migrationen er IKKE kørt endnu (schema-snapshot
// 24/9 har ingen `retired_at`-kolonne på `league_divisions`), så
// `withActiveSeniorPools` nedenfor kører defensivt: fejler Postgres med 42703
// (kolonnen findes ikke), gentages kaldet uden retired_at-filteret — samme
// mønster som backend's `isMissingSquadColumnError`-fallback.
//
// `retired_at`-filteret bruges KUN på `league_divisions`-forespørgsler (aldrig
// på `races` eller `season_standings` — de kolonner findes ikke der, og
// migrationen tilføjer dem ikke). Se PR #5648 for hvilke sider der bruger hvad.

export const SQUAD_COLUMN = "squad";
export const SENIOR_SQUAD = "senior";
export const RETIRED_AT_COLUMN = "retired_at";

/** PostgREST-filteret der afgrænser en query til seniorkataloget (delt med backend). */
export const SENIOR_SQUAD_OR_FILTER = `${SQUAD_COLUMN}.is.null,${SQUAD_COLUMN}.eq.${SENIOR_SQUAD}`;

/** NULL/undefined = senior (bagudkompatibelt — rækker uden `squad`-kolonne er senior). */
export function isSeniorSquad(value: unknown): boolean {
  return value == null || value === SENIOR_SQUAD;
}

/**
 * Defensivt JS-filter over rækker der allerede er hentet. `getSquad` peger på
 * hvor `squad`-værdien bor på rækken — direkte (`league_divisions`/`races`,
 * default) eller indlejret (fx `season_standings`' `pool.squad`-embed).
 */
export function filterSeniorSquadRows<T>(
  rows: readonly T[] | null | undefined,
  getSquad: (row: T) => unknown = (row: unknown) => (row as { squad?: unknown } | null | undefined)?.squad,
): T[] {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => isSeniorSquad(getSquad(row)));
}

interface OrFilterable {
  or: (filters: string) => this;
}

/**
 * Læg senior-scopet på en direkte `league_divisions`- eller `races`-query
 * (begge har `squad`-kolonnen, migreret med A2 #5525 — ingen defensiv fallback
 * nødvendig her). AND'es med kaldstedets øvrige filtre.
 */
export function applySeniorSquadFilter<Q extends OrFilterable>(query: Q): Q {
  return query.or(SENIOR_SQUAD_OR_FILTER);
}

interface IsFilterable {
  is: (column: string, value: null) => this;
}

/** Kun `league_divisions`: skjul pensionerede puljer. Brug via `withActiveSeniorPools`. */
function applyActivePoolsFilter<Q extends IsFilterable>(query: Q): Q {
  return query.is(RETIRED_AT_COLUMN, null);
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Er fejlen "`retired_at` findes IKKE i databasen"? Kun `42703` (Postgres
 * `undefined_column`) tæller — samme dom (og samme begrundelse) som backend's
 * `isMissingSquadColumnError` (racePoolCatalog.js): en stale skema-cache
 * (`PGRST204`/"schema cache") er IKKE bevis for at kolonnen mangler, og der
 * fejler vi lukket i stedet for at risikere at vise pensionerede puljer.
 */
export function isMissingRetiredAtColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (!text.includes(RETIRED_AT_COLUMN)) return false;
  if (code === "PGRST204" || text.includes("schema cache")) return false;
  if (code === "42703") return true;
  return /does not exist|undefined column/.test(text);
}

type SeniorPoolsScope = <Q extends OrFilterable & IsFilterable>(query: Q) => Q;

const seniorActivePools: SeniorPoolsScope = (query) => applyActivePoolsFilter(applySeniorSquadFilter(query));
const seniorPoolsOnly: SeniorPoolsScope = (query) => applySeniorSquadFilter(query);

/**
 * Kør en `league_divisions`-læsning scopet til senior + IKKE-pensionerede
 * puljer (den aktive sæsons visning — historiske sæsoner skal bruge
 * `applySeniorSquadFilter` direkte i stedet, uden `retired_at`, jf. risiko 3).
 *
 * `run(scope)` SKAL bygge en frisk PostgREST-builder ved hvert kald (en
 * builder er one-shot) og kæde `scope(...)` lige efter `.select(...)`:
 *
 *   withActiveSeniorPools((scope) =>
 *     scope(supabase.from("league_divisions").select("id, tier, pool_index, label"))
 *       .order("tier").order("pool_index"))
 *
 * Svarer databasen 42703 på `retired_at`, køres `run` én gang til uden det
 * filter. Begge fejl-former håndteres: en returneret `{ data, error }`
 * (almindelig builder) og en kastet fejl.
 */
export async function withActiveSeniorPools<R extends { error?: unknown } | unknown>(
  run: (scope: SeniorPoolsScope) => R | PromiseLike<R>,
): Promise<R> {
  let result: R;
  try {
    result = await run(seniorActivePools);
  } catch (err) {
    if (!isMissingRetiredAtColumnError(err as PostgrestLikeError)) throw err;
    return run(seniorPoolsOnly);
  }
  const maybeError = (result as { error?: unknown } | null)?.error;
  if (maybeError && isMissingRetiredAtColumnError(maybeError as PostgrestLikeError)) {
    return run(seniorPoolsOnly);
  }
  return result;
}
