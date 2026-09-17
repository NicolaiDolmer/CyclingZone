// #5330 — ÉT sted at afgrænse race_pool til seniorkataloget.
//
// Baggrund: #4620/#5262 tilføjer `race_pool.squad` (TEXT NOT NULL DEFAULT 'senior',
// CHECK IN ('senior','u23','junior')) og lægger U23-/juniorløb i SAMME tabel som
// seniorløbene. Alle eksisterende læsere af race_pool er seniorlæsere: kalender-
// materializeren, admin-preview, den offentlige katalogrute og whitelist-/udvalgs-
// stierne. Uden et filter ville U23-løb kunne vælges til seniorkalenderen i det
// øjeblik #5262 merges.
//
// To krav styrer designet:
//  1. NULL = senior. Kolonnen er NOT NULL DEFAULT 'senior' efter migrationen, men
//     filteret behandler NULL som senior, så en fremtidig nullable-variant (eller en
//     fixture uden feltet) ikke tavst taber hele kataloget.
//  2. Kolonnen kan MANGLE. #5330 merges FØR #5262, og auto-migrate.yml kører
//     migrationen ved merge af #5262 — dvs. der findes et vindue hvor koden her kører
//     mod et skema uden `squad`. PostgREST fejler hårdt på både et select af en ukendt
//     kolonne (42703) og på et filter mod den (PGRST204 fra skema-cachen). Derfor
//     kører selectSeniorRacePool ET fallback-kald uden squad, hvor HELE kataloget pr.
//     definition er senior.
//
// Fallback'et caches bevidst IKKE: backend'en kører videre mens auto-migrate.yml
// applier migrationen, og et cachet "kolonnen mangler" ville lade ungdomsløb sive ind
// i seniorkalenderen indtil næste restart. Stierne her er admin-/generator-stier plus
// én rute med 10 minutters cache, så den ekstra rundtur i overgangsvinduet er billig.

export const SENIOR_SQUAD = "senior";
export const YOUTH_SQUADS = Object.freeze(["u23", "junior"]);
export const SQUAD_COLUMN = "squad";

/** PostgREST-filteret der afgrænser en race_pool-query til seniorkataloget. */
export const SENIOR_SQUAD_OR_FILTER = `${SQUAD_COLUMN}.is.null,${SQUAD_COLUMN}.eq.${SENIOR_SQUAD}`;

/** NULL/undefined = senior (bagudkompatibelt, jf. #5330 "Default for raekker uden squad"). */
export function isSeniorSquad(value) {
  return value == null || value === SENIOR_SQUAD;
}

/** Defensivt JS-filter: samme dom som SQL-filteret, også for rækker der ikke kom fra DB. */
export function filterSeniorSquadRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => isSeniorSquad(row?.[SQUAD_COLUMN]));
}

/**
 * Tilføj `squad` til en select-liste hvis den ikke allerede er der, så det defensive
 * JS-filter har noget at dømme på. Kolonne-listerne i kaldstederne er komma-separerede
 * PostgREST-strenge ("id, external_id, name").
 */
export function withSeniorSquadColumns(columns) {
  const parts = String(columns || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (parts.some((c) => c === SQUAD_COLUMN)) return parts.join(", ");
  return [...parts, SQUAD_COLUMN].join(", ");
}

/** Læg senior-filteret på en PostgREST-builder (AND'es sammen med kaldstedets øvrige filtre). */
export function applySeniorSquadFilter(query) {
  return query.or(SENIOR_SQUAD_OR_FILTER);
}

/**
 * Er fejlen "kolonnen squad findes ikke (endnu)"? 42703 = Postgres undefined_column,
 * PGRST204 = PostgREST's skema-cache kender ikke kolonnen. Begge betyder: kør uden
 * squad. Alt andet (netværk, RLS, syntaks) skal boble op uændret.
 */
export function isMissingSquadColumnError(error) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (!text.includes(SQUAD_COLUMN)) return false;
  if (code === "42703" || code === "PGRST204") return true;
  return /does not exist|schema cache|unknown column|undefined column/.test(text);
}

/**
 * Kør en race_pool-læsning afgrænset til seniorkataloget.
 *
 * buildQuery(columns) SKAL bygge en frisk PostgREST-builder hver gang (builderen er
 * one-shot/thenable) og bruge den udleverede kolonne-liste. Kaldstedet lægger selv
 * sine egne filtre/ordre på — de AND'es med senior-filteret.
 *
 * Returnerer PostgREST-formen { data, error } så kaldstederne kan beholde deres
 * eksisterende fejlhåndtering uændret.
 */
/**
 * Som selectSeniorRacePool, men UDEN at filtrere: rækkerne kommer tilbage med `squad`
 * (eller uden feltet, hvis kolonnen endnu ikke findes → alt er senior). Bruges hvor
 * kaldstedet skal kunne SKELNE "findes ikke" fra "findes, men er et ungdomsløb" —
 * fx whitelist-validering, der skal afvise et u23-id højlydt uden at ændre adfærd for
 * ukendte ids.
 */
export async function selectRacePoolWithSquad(buildQuery, { columns = "*" } = {}) {
  if (typeof buildQuery !== "function") {
    throw new TypeError("selectRacePoolWithSquad: buildQuery must be a function returning a fresh query");
  }
  const withSquad = await buildQuery(withSeniorSquadColumns(columns));
  if (!withSquad?.error || !isMissingSquadColumnError(withSquad.error)) return withSquad;
  return buildQuery(columns);
}

/**
 * Samme fallback som selectRacePoolWithSquad, men for de KASTENDE hentere
 * (fetchAllRows/fetchAllRowsChunkedIn kaster ved DB-fejl i stedet for at returnere
 * { error }). runFetch(columns) skal selv bygge og køre hentningen.
 */
export async function fetchRacePoolWithSquad(runFetch, { columns = "*" } = {}) {
  if (typeof runFetch !== "function") {
    throw new TypeError("fetchRacePoolWithSquad: runFetch must be a function");
  }
  try {
    return await runFetch(withSeniorSquadColumns(columns));
  } catch (err) {
    if (!isMissingSquadColumnError(err)) throw err;
    return runFetch(columns);
  }
}

export async function selectSeniorRacePool(buildQuery, { columns = "*" } = {}) {
  if (typeof buildQuery !== "function") {
    throw new TypeError("selectSeniorRacePool: buildQuery must be a function returning a fresh query");
  }
  const withSquad = await applySeniorSquadFilter(buildQuery(withSeniorSquadColumns(columns)));
  if (!withSquad?.error) {
    return { ...withSquad, data: filterSeniorSquadRows(withSquad?.data) };
  }
  if (!isMissingSquadColumnError(withSquad.error)) return withSquad;
  // Skemaet har endnu ikke squad (#5262 ikke merged/applied) → hele kataloget er senior.
  const withoutSquad = await buildQuery(columns);
  if (withoutSquad?.error) return withoutSquad;
  return { ...withoutSquad, data: filterSeniorSquadRows(withoutSquad?.data) };
}
