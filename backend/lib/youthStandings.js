// #5647 (Y7 / plan S4): U23- og juniorstillingen pr. sæson, trup og gruppe.
//
// Data bor i `youth_season_standings` (database/2026-09-25-4620-youth-season-
// standings.sql), ikke i `season_standings`: seniorstillingen, op/nedrykning,
// divisionsbonus og Global Rank ser derfor aldrig et ungdomsresultat (plan
// 2026-09-23 §2.0 V1). Genberegningen er RPC'en recompute_youth_season_standings
// (mængdebaseret, fuld genberegning af én trup i én sæson), så et gentaget kald
// giver samme rækker.
//
// refreshYouthStandings er BEST-EFFORT, som refreshRankingMatviewsSafe: den
// kaldes fra løbsfinaliseringen EFTER at resultaterne er skrevet, og en fejl her
// må aldrig vælte en afvikling. Den kaster derfor aldrig; den returnerer et
// udfald og rapporterer fejl til Sentry via captureExceptionFn. Seniorløb (og
// løb uden trup) er en no-op, så kaldet kan ligge ubetinget i finaliseringen.
//
// Mangler RPC'en (migrationen er ikke applied endnu), er udfaldet
// "unavailable" uden Sentry-støj.

import { fetchAllRows } from "./supabasePagination.js";

export const YOUTH_SQUADS = Object.freeze(["u23", "junior"]);

export const YOUTH_STANDINGS_COLUMNS =
  "season_id,squad,league_division_id,team_id,total_points,wins,podiums,races,rank_in_pool,updated_at";

export function isYouthSquad(squad) {
  return YOUTH_SQUADS.includes(squad);
}

// PostgREST: PGRST202 = funktionen findes ikke i schema-cachen; 42883 = Postgres
// "function does not exist" (fx lige efter deploy, før cachen er genindlæst).
function isMissingRpcError(error) {
  const code = error?.code;
  return code === "PGRST202" || code === "42883";
}

async function loadRace(supabase, raceId) {
  const { data, error } = await supabase
    .from("races")
    .select("id,season_id,squad")
    .eq("id", raceId)
    .maybeSingle();
  if (error) throw new Error(`youthStandings: race lookup failed: ${error.message}`);
  return data;
}

/**
 * Genberegn ungdomsstillingen for løbets trup og sæson. Idempotent og best-effort.
 *
 * @param {object} args
 * @param {object} args.supabase service_role-klient
 * @param {string} args.raceId løbet der lige er afgjort
 * @param {{ season_id?: string, squad?: string }} [args.race] valgfri løbsrække
 *   (spar opslaget når kalderen allerede har den; skal have season_id + squad)
 * @param {(err: Error, ctx?: object) => void} [args.captureExceptionFn]
 * @returns {Promise<{ status: "skipped"|"updated"|"unavailable"|"error", [key: string]: unknown }>}
 */
export async function refreshYouthStandings({ supabase, raceId, race = null, captureExceptionFn } = {}) {
  try {
    if (!supabase) throw new Error("youthStandings: supabase client is required");
    if (!raceId && !race?.id) throw new Error("youthStandings: raceId is required");
    const id = raceId || race.id;

    const hasFields = race && race.season_id && "squad" in race;
    const row = hasFields ? race : await loadRace(supabase, id);
    if (!row) return { status: "skipped", reason: "race_not_found", raceId: id };
    if (!isYouthSquad(row.squad)) return { status: "skipped", reason: "senior", raceId: id };
    if (!row.season_id) return { status: "skipped", reason: "no_season", raceId: id };

    const { data, error } = await supabase.rpc("recompute_youth_season_standings", {
      p_season_id: row.season_id,
      p_squad: row.squad,
    });
    if (error) {
      if (isMissingRpcError(error)) {
        console.warn(`⚠️  recompute_youth_season_standings findes ikke endnu (migration ikke applied): ${error.message}`);
        return { status: "unavailable", raceId: id, squad: row.squad };
      }
      throw new Error(`recompute_youth_season_standings failed: ${error.message}`);
    }
    return { status: "updated", raceId: id, seasonId: row.season_id, squad: row.squad, result: data ?? null };
  } catch (err) {
    console.warn(`⚠️  refreshYouthStandings fejlede (best-effort): ${err.message}`);
    if (captureExceptionFn) {
      captureExceptionFn(err, { tags: { lib: "youthStandings" }, extra: { raceId: raceId ?? race?.id ?? null } });
    }
    return { status: "error", raceId: raceId ?? race?.id ?? null, message: err.message };
  }
}

/**
 * Stillingen for én trup i én sæson, valgfrit én gruppe. Sorteret pr. gruppe og
 * placering. Kaster ved databasefejl (ruten svarer 500 + Sentry).
 *
 * @param {object} args
 * @param {object} args.supabase service_role-klient
 * @param {string} args.seasonId
 * @param {"u23"|"junior"} args.squad
 * @param {number | null} [args.leagueDivisionId] gruppen (league_divisions.id); udeladt = alle grupper
 * @returns {Promise<object[]>}
 */
export async function listYouthStandings({ supabase, seasonId, squad, leagueDivisionId = null } = {}) {
  if (!supabase) throw new Error("youthStandings: supabase client is required");
  if (!seasonId) throw new Error("youthStandings: seasonId is required");
  if (!isYouthSquad(squad)) throw new Error(`youthStandings: invalid youth squad: ${squad}`);
  return fetchAllRows(() => {
    let query = supabase
      .from("youth_season_standings")
      .select(YOUTH_STANDINGS_COLUMNS)
      .eq("season_id", seasonId)
      .eq("squad", squad);
    if (leagueDivisionId != null) query = query.eq("league_division_id", leagueDivisionId);
    return query
      .order("league_division_id", { ascending: true, nullsFirst: false })
      .order("rank_in_pool", { ascending: true, nullsFirst: false })
      .order("team_id");
  });
}
