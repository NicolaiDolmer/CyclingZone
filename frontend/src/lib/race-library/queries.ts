import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.types.ts";
import { fetchAllRows } from "../supabasePagination.js";
import { applySeniorSquadFilter, isSeniorSquad } from "../seniorScope.ts";
import { poolMatchesSelection } from "../resultsFilter.js";
import { raceHasReportableResults } from "../raceResultVisibility.js";
import { summariseRace } from "./model.ts";
import type {
  LibraryScope,
  LibrarySeason,
  LibraryPool,
  RawRace,
  LibraryStage,
  LibraryProfile,
  LibraryResult,
  RaceEditionSummary,
  RaceEditionDetail,
} from "./types.ts";

const RACE_FIELDS =
  "id,name,race_type,race_class,stages,stages_completed,status,season_id,league_division_id,pool_race_id,edition_year,squad,scheduled_for,game_day_start" as const;
const RESULT_FIELDS =
  "id,race_id,stage_number,result_type,rank,rider_id,rider_name,team_id,team_name,points_earned" as const;
const batches = <T>(rows: T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / 100) }, (_, i) =>
    rows.slice(i * 100, i * 100 + 100)
  );
type Family = Pick<RawRace, "name" | "race_type">;
type FamilyFilter = Pick<RawRace, "name"> & Partial<Pick<RawRace, "race_type">>;
function assertScope(scope: LibraryScope, seasons: LibrarySeason[], pools: LibraryPool[]) {
  if (scope.squad !== "senior" || !seasons.some((s) => s.id === scope.seasonId))
    throw new Error("Invalid library scope");
  if (
    scope.poolId !== null &&
    !pools.some((p) => p.id === scope.poolId && (scope.tier === null || p.tier === scope.tier))
  )
    throw new Error("Invalid library pool scope");
  if (scope.tier !== null && !pools.some((p) => p.tier === scope.tier))
    throw new Error("Invalid library division scope");
}
// Keep the canonical frontend predicate; the callback form also makes scope visible to the shared reader guard.
function withSeniorSquadScope<T>(build: (scope: typeof applySeniorSquadFilter) => T): T {
  return build(applySeniorSquadFilter);
}
export function createRaceLibraryReader(client: unknown) {
  const db = client as SupabaseClient<Database>;
  async function readRaces(
    scope: LibraryScope,
    seasons: LibrarySeason[],
    pools: LibraryPool[],
    signal: AbortSignal,
    family?: FamilyFilter,
    id?: string,
    allSeasons = false
  ): Promise<RawRace[]> {
    assertScope(scope, seasons, pools);
    signal.throwIfAborted();
    const ids = pools
      .filter((p) =>
        scope.poolId !== null ? p.id === scope.poolId : scope.tier === null || p.tier === scope.tier
      )
      .map((p) => p.id);
    const rowsById = new Map<string, RawRace>();
    const seasonGroups = allSeasons ? batches(seasons.map((s) => s.id)) : [[scope.seasonId]];
    const poolGroups = ids.length ? batches(ids) : [[]];
    for (const seasonIds of seasonGroups) {
      for (const [poolIndex, poolIds] of poolGroups.entries()) {
        const rows = (await fetchAllRows(() => {
          let query = applySeniorSquadFilter(db.from("races").select(RACE_FIELDS));
          query = allSeasons
            ? query.in("season_id", seasonIds)
            : query.eq("season_id", scope.seasonId);
          if (poolIds.length) {
            query =
              poolIndex === 0
                ? query.or(
                    "league_division_id.is.null,league_division_id.in.(" + poolIds.join(",") + ")"
                  )
                : query.in("league_division_id", poolIds);
          } else query = query.is("league_division_id", null);
          if (family) {
            query = query.eq("name", family.name);
            if (family.race_type !== undefined) {
              query =
                family.race_type === null
                  ? query.is("race_type", null)
                  : query.eq("race_type", family.race_type);
            }
          }
          if (id) query = query.eq("id", id);
          return query.order("id", { ascending: true }).abortSignal(signal);
        })) as RawRace[];
        for (const row of rows) rowsById.set(row.id, row);
      }
    }
    const rows = [...rowsById.values()];
    signal.throwIfAborted();
    const map = new Map(pools.map((p) => [p.id, p]));
    return rows.filter(
      (r) =>
        isSeniorSquad(r.squad) &&
        seasons.some((s) => s.id === r.season_id) &&
        (allSeasons || r.season_id === scope.seasonId) &&
        poolMatchesSelection(r.league_division_id, { tier: scope.tier, poolId: scope.poolId }, map)
    );
  }
  async function hydrate(
    races: RawRace[],
    seasons: LibrarySeason[],
    signal: AbortSignal
  ): Promise<RaceEditionSummary[]> {
    if (!races.length) return [];
    const schedules: LibraryStage[] = [];
    const profiles: LibraryProfile[] = [];
    const results: LibraryResult[] = [];
    for (const ids of batches(races.map((r) => r.id))) {
      signal.throwIfAborted();
      const [days, route] = await Promise.all([
        fetchAllRows(() =>
          db
            .from("race_stage_schedule")
            .select("race_id,stage_number,scheduled_at,game_day")
            .in("race_id", ids)
            .order("race_id")
            .order("stage_number")
            .abortSignal(signal)
        ),
        fetchAllRows(() =>
          db
            .from("race_stage_profiles")
            .select("race_id,stage_number,distance_km")
            .in("race_id", ids)
            .order("race_id")
            .order("stage_number")
            .abortSignal(signal)
        ),
      ]);
      schedules.push(...days);
      profiles.push(...route);
    }
    const completed = races.filter(
      (r) =>
        raceHasReportableResults(r) &&
        summariseRace(
          r,
          seasons.find((s) => s.id === r.season_id)!,
          [],
          [],
          []
        ).status === "completed"
    );
    for (const ids of batches(completed.map((r) => r.id))) {
      signal.throwIfAborted();
      const rows = await fetchAllRows(() =>
        db
          .from("race_results")
          .select(RESULT_FIELDS)
          .in("race_id", ids)
          .eq("rank", 1)
          .in("result_type", ["gc", "stage"])
          .order("id")
          .abortSignal(signal)
      );
      results.push(...rows);
    }
    signal.throwIfAborted();
    const group = <T extends { race_id?: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        if (row.race_id) {
          const list = map.get(row.race_id) ?? [];
          list.push(row);
          map.set(row.race_id, list);
        }
      }
      return map;
    };
    const days = group(schedules),
      routes = group(profiles),
      winners = group(results);
    return races.map((r) =>
      summariseRace(
        r,
        seasons.find((s) => s.id === r.season_id)!,
        days.get(r.id) ?? [],
        routes.get(r.id) ?? [],
        winners.get(r.id) ?? []
      )
    );
  }
  async function listRaceLibrary(
    scope: LibraryScope,
    seasons: LibrarySeason[],
    pools: LibraryPool[],
    signal: AbortSignal,
    tab: "upcoming" | "history" = "upcoming"
  ) {
    const races = await readRaces(scope, seasons, pools, signal);
    const visible = races.filter((r) => {
      const status = summariseRace(
        r,
        seasons.find((s) => s.id === r.season_id)!,
        [],
        [],
        []
      ).status;
      return tab === "history"
        ? status === "completed"
        : status === "scheduled" || status === "live";
    });
    return hydrate(visible, seasons, signal);
  }
  async function listRaceEditions(
    family: Family,
    scope: LibraryScope,
    seasons: LibrarySeason[],
    pools: LibraryPool[],
    signal: AbortSignal
  ) {
    const rows = await hydrate(
      await readRaces(scope, seasons, pools, signal, family, undefined, true),
      seasons,
      signal
    );
    return rows.sort((a, b) => b.seasonNumber - a.seasonNumber || a.id.localeCompare(b.id));
  }
  async function findRaceByName(
    name: string,
    scope: LibraryScope,
    seasons: LibrarySeason[],
    pools: LibraryPool[],
    signal: AbortSignal
  ) {
    const races = await readRaces(scope, seasons, pools, signal, { name }, undefined, true);
    return hydrate(
      races.filter((r) => r.name === name),
      seasons,
      signal
    );
  }
  async function getRaceEdition(
    id: string,
    scope: LibraryScope,
    seasons: LibrarySeason[],
    pools: LibraryPool[],
    signal: AbortSignal
  ): Promise<RaceEditionDetail | null> {
    const races = await readRaces(scope, seasons, pools, signal, undefined, id);
    if (!races.length) return null;
    const [summaries, profiles, schedule] = await Promise.all([
      hydrate(races, seasons, signal),
      fetchAllRows(() =>
        db
          .from("race_stage_profiles")
          .select(
            "race_id,stage_number,distance_km,profile_type,elevation_gain_m,elevation_profile,sectors,climbs"
          )
          .eq("race_id", id)
          .order("stage_number")
          .order("id")
          .abortSignal(signal)
      ),
      fetchAllRows(() =>
        db
          .from("race_stage_schedule")
          .select("race_id,stage_number,scheduled_at,game_day")
          .eq("race_id", id)
          .order("stage_number")
          .abortSignal(signal)
      ),
    ]);
    signal.throwIfAborted();
    return { summary: summaries[0], schedule, profiles };
  }
  async function listRaceStats(
    family: Family,
    scope: LibraryScope,
    seasons: LibrarySeason[],
    pools: LibraryPool[],
    signal: AbortSignal
  ) {
    const races = (await readRaces(scope, seasons, pools, signal, family, undefined, true)).filter(
      (r) =>
        summariseRace(
          r,
          seasons.find((s) => s.id === r.season_id)!,
          [],
          [],
          []
        ).status === "completed" && raceHasReportableResults(r)
    );
    const results: LibraryResult[] = [];
    for (const ids of batches(races.map((r) => r.id))) {
      const rows = await fetchAllRows(() =>
        db
          .from("race_results")
          .select(RESULT_FIELDS)
          .in("race_id", ids)
          .order("id")
          .abortSignal(signal)
      );
      results.push(...rows);
    }
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        stageWins: number;
        gcWins: number;
        podiums: number;
        points: number;
      }
    >();
    for (const row of results) {
      if (!row.rider_id) continue;
      const stat = map.get(row.rider_id) ?? {
        id: row.rider_id,
        name: row.rider_name ?? "",
        stageWins: 0,
        gcWins: 0,
        podiums: 0,
        points: 0,
      };
      if (row.rank === 1 && row.result_type === "stage") stat.stageWins++;
      if (row.rank === 1 && row.result_type === "gc") stat.gcWins++;
      if (row.rank !== null && row.rank >= 1 && row.rank <= 3) stat.podiums++;
      stat.points += row.points_earned ?? 0;
      map.set(row.rider_id, stat);
    }
    signal.throwIfAborted();
    return [...map.values()]
      .sort(
        (a, b) =>
          b.stageWins + b.gcWins - (a.stageWins + a.gcWins) ||
          b.points - a.points ||
          a.id.localeCompare(b.id)
      )
      .slice(0, 10);
  }
  async function bootstrap(signal: AbortSignal) {
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    if (authError) throw authError;
    const [seasons, pools, team] = await Promise.all([
      fetchAllRows(() =>
        db
          .from("seasons")
          .select("id,number,status")
          .gt("number", 0)
          .order("number", { ascending: false })
          .order("id")
          .abortSignal(signal)
      ),
      fetchAllRows(() =>
        withSeniorSquadScope((scope) =>
          scope(db.from("league_divisions").select("id,tier,pool_index,label,retired_at"))
            .order("tier")
            .order("pool_index")
            .order("id")
            .abortSignal(signal)
        )
      ),
      user
        ? db
            .from("teams")
            .select("league_division_id")
            .eq("user_id", user.id)
            .abortSignal(signal)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (team.error) throw team.error;
    signal.throwIfAborted();
    return {
      seasons: seasons as LibrarySeason[],
      pools: pools as LibraryPool[],
      ownPoolId: team.data?.league_division_id ?? null,
    };
  }
  return {
    bootstrap,
    listRaceLibrary,
    listRaceEditions,
    getRaceEdition,
    findRaceByName,
    listRaceStats,
  };
}
