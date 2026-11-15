import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { apiFetch } from "../lib/apiFetch.ts";
import { timeoutSignal } from "../lib/timeoutSignal.ts";
import { fetchSquadCountInputs } from "../lib/dashboardSquadStats.js";
import { mergeStandings } from "../lib/standingsMerge.js";
import { computeOverallBoardSatisfaction } from "../lib/boardUtils.js";
import { hasSignedBoardPlan } from "../lib/boardCopy.js";
import { dateTextToDayOfYear } from "../lib/raceCalendar.js";
import { poolStageTotals, deriveRaceStatus } from "../lib/raceHubLogic.js";
import { withActiveSeniorPools } from "../lib/seniorScope.ts";
import { fetchReservedBalance } from "../lib/availableBalance.js";
import { teamNudgeCandidates } from "../lib/dashboardNextRace.ts";
import { isSquadSelectionMissing } from "../lib/raceSquadSelectionStatus.js";
import { resolveSeasonMovement } from "../lib/seasonRecapData.js";
import { fetchBoardMeeting } from "../pages/annualMeeting/meetingApi.js";
import { privateKey, viewerKey, type DataRuntime, type DataScope } from "./queryRuntime.ts";
import { useDataScope, scopedHeaders } from "./useDataScope.ts";
import { DataError } from "./apiQuery.ts";
import { transferOffersQuery } from "./marketData.ts";
import { LIVE_RESOURCES, isScopeResource, cancelledWithoutData, settledList } from "./dashboardQueryPolicy.ts";

// #6494: the Dashboard's page-owned server data. Every resource is one Query key under the
// viewer/team scope; the page keeps only UI state (dismissals, menus, pending submits).
// Module semantics are unchanged from the legacy loadAll (DASHBOARD_RULES.md §3: a module
// never takes the dashboard down): only the core block and the team bootstrap can raise the
// page error, every other module settles to its own empty/absent state.

type Row = Record<string, any>;
type SupabaseResult = { data: any; error?: unknown; count?: number | null };

// #5301: measured lookahead for the squad nudge (see the legacy comment kept in git history).
export const SQUAD_NUDGE_LOOKAHEAD = 5;

/** Bound a request: Query's signal (unmount/scope change) or the timeout aborts it. */
function boundedSignal(parent: AbortSignal, ms: number) {
  const timer = timeoutSignal(ms);
  const abort = () => timer.abort();
  if (parent.aborted) timer.abort(); else parent.addEventListener("abort", abort, { once: true });
  return { signal: timer.signal, dispose() { timer.dispose(); parent.removeEventListener("abort", abort); } };
}

/** Best-effort JSON from an API module: limited/unauthorized/failed reads are an error
 * (Query keeps known data), never a successful empty value. */
async function readApi(runtime: DataRuntime, scope: DataScope, path: string, signal?: AbortSignal): Promise<any> {
  const revision = await runtime.beforeRead(signal);
  const result = await apiFetch(path, { signal, headers: await scopedHeaders(runtime, scope, false) });
  runtime.assertReadCurrent(scope, revision);
  if (!result.ok || result.limited || result.unauthorized) {
    throw new DataError(result.limited ? "limited" : result.unauthorized ? "unauthorized" : result.networkError ? "network" : "http", result.status, result.retryAt ?? null);
  }
  return result.data;
}

export interface DashboardCore {
  reservedBalance: number;
  pools: Row[];
  poolStages: ReturnType<typeof poolStageTotals>;
  riders: Row[];
  seniorRosterReady: boolean;
  pendingIncomingCount: number;
  nextRaces: Row[];
  board: Row | null;
  boardSatisfaction: number | null;
  boardOutlook: Row | null;
  boardPlanMissing: boolean;
  boardStatusLoaded: boolean;
  standings: Row[];
}

async function readCore(runtime: DataRuntime, scope: DataScope, team: Row, activeSeason: Row | null, signal: AbortSignal): Promise<DashboardCore> {
  const revision = await runtime.beforeRead(signal);
  const headers = await scopedHeaders(runtime, scope, false);
  // #5322: the board status is on the blocking path, so "never reached the server" raises
  // the page's offline state instead of a silently half-empty dashboard.
  const boardStatusPromise = apiFetch("/api/board/status", { headers, signal }).then((res) => {
    if (res.networkError) throw res;
    return res.limited || res.unauthorized ? null : (res.ok ? res.data : null);
  });
  // #1829: all races in the manager's own pool (incl. finished) for the per-pool day counter.
  const poolRacesPromise: Promise<SupabaseResult> = activeSeason && team.league_division_id != null
    ? Promise.resolve(supabase.from("races").select("stages, stages_completed, status")
      .eq("season_id", activeSeason.id).eq("league_division_id", team.league_division_id).abortSignal(signal))
    : Promise.resolve({ data: [] });
  const [teamsRes, ridersRes, squadCountInputs, racesRes, standingsRes, boardStatus, poolRacesRes, poolsRes, reservedBalanceValue] = await Promise.all([
    // #2182/#3506: same "real team" scope as the standings page (AI teams count).
    supabase.from("teams").select("id, name, division, is_ai, league_division_id")
      .eq("is_test_account", false).eq("is_frozen", false).order("division").order("name").abortSignal(signal),
    // #1308/#2748/#1150: academy and retired riders excluded; contract_end_season drives the expiry notice.
    supabase.from("riders").select("id, salary, is_u25, pending_team_id, contract_end_season, squad, is_academy, is_retired")
      .eq("team_id", team.id).eq("is_academy", false).eq("is_retired", false).abortSignal(signal),
    // #1090: pending-in + incoming loans with the backend's discriminators.
    fetchSquadCountInputs(supabase, team.id),
    // #1906: only the team's own pool, broad enough (~14 races) for client-side date sorting.
    activeSeason
      ? supabase.from("races").select("*, pool_race:pool_race_id(date_text)")
        .eq("season_id", activeSeason.id).eq("league_division_id", team.league_division_id)
        .not("status", "eq", "completed").order("name").limit(50).abortSignal(signal)
      : Promise.resolve({ data: [] }),
    activeSeason
      ? supabase.from("season_standings").select("*, team:team_id(id, name, division, is_ai, league_division_id)")
        .eq("season_id", activeSeason.id).order("total_points", { ascending: false }).abortSignal(signal)
      : Promise.resolve({ data: [] }),
    boardStatusPromise,
    poolRacesPromise,
    // #2182/#5648: active senior pools only.
    withActiveSeniorPools((poolScope) => poolScope(supabase.from("league_divisions").select("id, tier, pool_index, label"))),
    // #3508: reserved in leading bids + proxy max, shared with the finance page.
    fetchReservedBalance(supabase, team.id),
  ]) as [SupabaseResult, SupabaseResult, { pendingIncomingCount: number }, SupabaseResult, SupabaseResult, any, SupabaseResult, SupabaseResult, number];
  runtime.assertReadCurrent(scope, revision);
  // #2328: all of the team's coming pool races, sorted by the calendar date.
  const nextRaces = [...(racesRes.data || [])]
    .sort((a: Row, b: Row) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text));
  const activePlan = boardStatus?.plans?.["1yr"] || boardStatus?.plans?.["3yr"] || boardStatus?.plans?.["5yr"] || null;
  const standingsMap: Record<string, Row> = {};
  for (const row of standingsRes.data || []) standingsMap[row.team_id] = row;
  return {
    reservedBalance: reservedBalanceValue || 0,
    pools: poolsRes.data || [],
    poolStages: poolStageTotals(poolRacesRes.data || []),
    riders: ridersRes.data || [],
    seniorRosterReady: !ridersRes.error,
    pendingIncomingCount: squadCountInputs.pendingIncomingCount,
    nextRaces,
    board: activePlan?.board || null,
    // #1830: aggregated across all plans, same helper as the board page.
    boardSatisfaction: computeOverallBoardSatisfaction(boardStatus?.plans),
    boardOutlook: activePlan?.outlook || null,
    boardPlanMissing: Boolean(boardStatus) && !boardStatus.is_baseline_phase && !hasSignedBoardPlan(boardStatus?.plans),
    boardStatusLoaded: Boolean(boardStatus),
    standings: mergeStandings(teamsRes.data || [], standingsMap),
  };
}

const AUCTION_CARD_COLUMNS = "id, current_price, calculated_end, status, is_guaranteed_sale, seller_team_id, current_bidder_id, rider:rider_id(firstname, lastname, team_id)";
const EMPTY_ROWS: Row[] = [];
const EMPTY_IDS = new Set<string>();
const EMPTY_MAP: Record<string, number> = {};

export interface DashboardOptions {
  discordNudgeDismissed: boolean;
  onboardingNeeded: boolean;
  recentResultsVisible: boolean;
  riderRankingVisible: boolean;
  myLatestResultVisible: boolean;
  racePause: boolean;
  nowMs: number;
  seasonStartWindowOpen: (season: Row | null) => boolean;
  academyEnabled: boolean;
}

export function useDashboardData(options: DashboardOptions) {
  const context = useDataScope();
  const { runtime, scope, team, ready } = context;
  const client = runtime.client;
  const viewer = ready && scope.viewerId !== null;
  const hasTeam = ready && !!team;
  const noTeam = ready && !team && !context.bootstrapLoading;

  const seasonQuery = useQuery({
    queryKey: viewerKey(scope, "dashboard:season"),
    enabled: viewer,
    queryFn: async ({ signal }): Promise<Row | null> => {
      const revision = await runtime.beforeRead(signal);
      const { data } = await supabase.from("seasons")
        .select("id, number, status, start_date, end_date, race_days_total, race_days_completed")
        .eq("status", "active").abortSignal(signal).single();
      runtime.assertReadCurrent(scope, revision);
      return data ?? null;
    },
  }, client);
  const season = seasonQuery.data ?? null;
  const seasonSettled = seasonQuery.data !== undefined || seasonQuery.isError;

  const coreQuery = useQuery({
    queryKey: privateKey(scope, "dashboard:core", season?.id ?? null),
    enabled: hasTeam && seasonSettled,
    queryFn: ({ signal }) => readCore(runtime, scope, team as Row, season, signal),
  }, client);
  const core = coreQuery.data;

  const auctionsQuery = useQuery({
    queryKey: privateKey(scope, "dashboard:auctions"),
    enabled: hasTeam,
    queryFn: async ({ signal }): Promise<Row[]> => {
      const revision = await runtime.beforeRead(signal);
      const { data, error } = await supabase.from("auctions").select(AUCTION_CARD_COLUMNS)
        .in("status", ["active", "extended"]).abortSignal(signal);
      if (error) throw error;
      runtime.assertReadCurrent(scope, revision);
      return data || [];
    },
  }, client);
  const offersQuery = useQuery({ ...transferOffersQuery(runtime, scope), enabled: hasTeam }, client);
  const activeOffers = useMemo(() => [
    ...(offersQuery.data?.received || []).map((offer) => ({ ...offer, _dir: "received" })),
    ...(offersQuery.data?.sent || []).map((offer) => ({ ...offer, _dir: "sent" })),
  ], [offersQuery.data]);

  // #3751/#4160: the team's own registrations, only for the races the Dashboard shows (<=50).
  const nextRaces = core?.nextRaces ?? EMPTY_ROWS;
  const raceIds = useMemo(() => nextRaces.map((race) => race.id as string), [nextRaces]);
  const entriesQuery = useQuery({
    queryKey: privateKey(scope, "dashboard:team-race-entries", raceIds),
    enabled: hasTeam && core !== undefined,
    queryFn: async ({ signal }): Promise<Set<string>> => {
      if (!raceIds.length) return new Set();
      const revision = await runtime.beforeRead(signal);
      const request = boundedSignal(signal, 8000);
      try {
        // pagination-safe: one team (RLS team_id) and at most 50 race ids, far under 1000 rows.
        const { data, error } = await supabase.from("race_entries").select("race_id")
          .eq("team_id", (team as Row).id).in("race_id", raceIds).abortSignal(request.signal);
        if (error) throw error;
        runtime.assertReadCurrent(scope, revision);
        return new Set((data || []).map((entry: Row) => entry.race_id as string));
      } finally { request.dispose(); }
    },
  }, client);
  const teamRaceIds = entriesQuery.data ?? EMPTY_IDS;
  const teamRaceIdsLoaded = noTeam || (core !== undefined && entriesQuery.status !== "pending");

  // #4160: the optional modules depend only on the session and settle their own cards.
  const forecastQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:forecast"), enabled: viewer,
    queryFn: ({ signal }) => readApi(runtime, scope, "/api/me/finance-forecast", signal) }, client);
  const discordQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:discord"), enabled: viewer && !options.discordNudgeDismissed,
    queryFn: ({ signal }) => readApi(runtime, scope, "/api/me/discord-status", signal) }, client);
  const onboardingQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:onboarding"), enabled: viewer && options.onboardingNeeded,
    queryFn: ({ signal }) => readApi(runtime, scope, "/api/me/onboarding-progress", signal) }, client);
  const signupQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:signup"), enabled: viewer,
    queryFn: ({ signal }) => readApi(runtime, scope, "/api/season/signup-status", signal) }, client);
  const optionalModulesSettled = (ready && scope.viewerId === null) || (viewer && ([
    [forecastQuery, true], [discordQuery, !options.discordNudgeDismissed], [onboardingQuery, options.onboardingNeeded], [signupQuery, true],
  ] as const).every(([query, enabled]) => !enabled || query.data !== undefined || query.isError));

  // #4557: annual meeting shortcut, never blocking.
  const meetingQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:annual-meeting"), enabled: viewer,
    queryFn: async () => {
      const revision = await runtime.beforeRead();
      const data = await fetchBoardMeeting();
      runtime.assertReadCurrent(scope, revision);
      return data?.available && data.mandate ? data : null;
    } }, client);

  // #1828/#2171: real calendar time of the next stage for live and scheduled races.
  const scheduledIds = useMemo(() => nextRaces.filter((race) => {
    const status = deriveRaceStatus(race.status, race.stages_completed, race.stages);
    return status === "live" || status === "scheduled";
  }).map((race) => race.id as string), [nextRaces]);
  const nextStageQuery = useQuery({
    queryKey: privateKey(scope, "dashboard:next-stage", scheduledIds),
    enabled: hasTeam && scheduledIds.length > 0 && !options.racePause,
    queryFn: async ({ signal }): Promise<Record<string, number>> => {
      const revision = await runtime.beforeRead(signal);
      // pagination-safe: only the own pool's live/scheduled races (~14) x their stages (<=21).
      const { data } = await supabase.from("race_stage_schedule")
        .select("race_id, stage_number, scheduled_at").in("race_id", scheduledIds).abortSignal(signal);
      runtime.assertReadCurrent(scope, revision);
      const map: Record<string, number> = {};
      for (const race of nextRaces) {
        if (!scheduledIds.includes(race.id)) continue;
        const next = (data || []).find((slot: Row) => slot.race_id === race.id && slot.stage_number === (race.stages_completed ?? 0) + 1);
        const ms = next ? Date.parse(next.scheduled_at) : NaN;
        if (Number.isFinite(ms)) map[race.id] = ms;
      }
      return map;
    },
  }, client);
  const nextStageByRace = scheduledIds.length && !options.racePause ? nextStageQuery.data ?? EMPTY_MAP : EMPTY_MAP;

  // #2288 D1/#3042/#5301/#7296: same selection contract as the race page; withdrawn races
  // are skipped, an unknown answer keeps the previous nudge (thrown, so Query retains it).
  const candidates = useMemo(() => teamNudgeCandidates(nextRaces, teamRaceIds, SQUAD_NUDGE_LOOKAHEAD) as Row[], [nextRaces, teamRaceIds]);
  const selectionQuery = useQuery({
    queryKey: privateKey(scope, "dashboard:squad-selection", candidates.map((race) => race.id)),
    enabled: hasTeam && teamRaceIdsLoaded && candidates.length > 0,
    queryFn: async ({ signal }): Promise<Row | null> => {
      const request = boundedSignal(signal, 8000);
      try {
        for (const race of candidates) {
          const response = await apiFetch(`/api/races/${race.id}/selection`, { signal: request.signal, headers: await scopedHeaders(runtime, scope, false) });
          runtime.assertCurrent(scope);
          if (!response.ok || response.limited || response.unauthorized) throw new DataError("http", response.status);
          if ((response.data as Row | null)?.withdrawn) continue;
          return isSquadSelectionMissing(response.data) ? race : null;
        }
        return null;
      } finally { request.dispose(); }
    },
  }, client);
  const squadSelectionMissingRace = hasTeam && teamRaceIdsLoaded && candidates.length ? selectionQuery.data ?? null : null;
  const selectionReady = noTeam || (teamRaceIdsLoaded && hasTeam && (candidates.length === 0 || selectionQuery.status !== "pending"));

  // #2288 D2: did the team train today?
  const trainingQuery = useQuery({ queryKey: privateKey(scope, "dashboard:training-today"), enabled: hasTeam,
    queryFn: async ({ signal }) => {
      const data = await readApi(runtime, scope, "/api/training/today-status", signal);
      return Boolean(data?.enabled) && !data?.ran_today;
    } }, client);

  // #2925: the two "done" signals of the season-start guide, only inside the window.
  const windowOpen = options.seasonStartWindowOpen(season);
  const countsQuery = useQuery({
    queryKey: privateKey(scope, "dashboard:season-start-counts", season?.id ?? null, options.academyEnabled),
    enabled: hasTeam && windowOpen && !!season,
    queryFn: async ({ signal }) => {
      const revision = await runtime.beforeRead(signal);
      const [trainingRes, gradRes] = await Promise.all([
        supabase.from("training_plans").select("rider_id", { count: "exact", head: true })
          .eq("team_id", (team as Row).id).eq("season_id", (season as Row).id).abortSignal(signal),
        options.academyEnabled
          ? supabase.from("academy_graduation").select("rider_id", { count: "exact", head: true })
            .eq("team_id", (team as Row).id).eq("status", "pending").abortSignal(signal)
          : Promise.resolve({ count: 0 }),
      ]) as [SupabaseResult, SupabaseResult];
      runtime.assertReadCurrent(scope, revision);
      // count===null (error/unknown) stays null: the item shows without a check mark.
      return { trainingPlanCount: trainingRes.count ?? null, pendingGraduations: gradRes.count ?? null };
    },
  }, client);

  // #2752/#2361: my final standing in the season the active one followed.
  const recapQuery = useQuery({
    queryKey: privateKey(scope, "dashboard:season-recap", season?.id ?? null, season?.number ?? null, season?.status ?? null, team?.division ?? null),
    enabled: hasTeam && windowOpen && !!season,
    queryFn: async ({ signal }): Promise<Row | null> => {
      const ownTeam = team as Row;
      const active = season as Row;
      const revision = await runtime.beforeRead(signal);
      const { data: completedSeason } = await supabase.from("seasons").select("id, number")
        .eq("status", "completed").order("number", { ascending: false }).limit(1).abortSignal(signal).maybeSingle();
      if (!completedSeason || completedSeason.number !== active.number - 1) return null;
      const { data: standingsRow } = await supabase.from("season_standings")
        .select("division, rank_in_division, total_points, stage_wins")
        .eq("team_id", ownTeam.id).eq("season_id", completedSeason.id).abortSignal(signal).maybeSingle();
      if (!standingsRow) return null;
      const { data: divTeams } = await supabase.from("season_standings")
        .select("team_id, team:team_id(is_ai, is_test_account, is_frozen)")
        .eq("season_id", completedSeason.id).eq("division", standingsRow.division).abortSignal(signal);
      const divisionSize = (divTeams || []).filter((row: Row) => !row.team?.is_ai && !row.team?.is_test_account && !row.team?.is_frozen).length;
      const { data: nextRow } = await supabase.from("season_standings").select("division")
        .eq("team_id", ownTeam.id).eq("season_id", active.id).abortSignal(signal).maybeSingle();
      runtime.assertReadCurrent(scope, revision);
      return {
        seasonId: completedSeason.id,
        seasonNumber: completedSeason.number,
        division: standingsRow.division,
        divisionSize,
        rank: standingsRow.rank_in_division,
        movement: resolveSeasonMovement({
          finishedDivision: standingsRow.division,
          nextSeasonStandingDivision: nextRow?.division ?? null,
          nextSeasonStatus: active.status ?? null,
          currentTeamDivision: ownTeam.division,
        }),
        points: standingsRow.total_points,
        wins: standingsRow.stage_wins,
      };
    },
  }, client);

  // #1005/#2466: the three push modules, only while visible; each retains known data.
  const recentQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:recent-results"), enabled: viewer && options.recentResultsVisible,
    queryFn: async ({ signal }): Promise<Row[]> => (await readApi(runtime, scope, "/api/dashboard/recent-results", signal))?.races || [] }, client);
  const rankingQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:rider-ranking"), enabled: viewer && options.riderRankingVisible,
    queryFn: async ({ signal }): Promise<Row[]> => (await readApi(runtime, scope, "/api/dashboard/rider-ranking", signal))?.riders || [] }, client);
  const latestQuery = useQuery({ queryKey: viewerKey(scope, "dashboard:my-latest-result"), enabled: viewer && options.myLatestResultVisible,
    queryFn: async ({ signal }): Promise<Row> => {
      const request = boundedSignal(signal, 8000);
      try {
        const data = await readApi(runtime, scope, "/api/dashboard/my-latest-result", request.signal);
        // race === undefined (e.g. mock fallback {}) becomes null: the card's empty state.
        return { ...data, race: data?.race ?? null };
      } finally { request.dispose(); }
    } }, client);
  // undefined = pending; null = failed/absent (no session also settles to absent).
  const myLatestResult = latestQuery.data ?? (latestQuery.isError || (ready && scope.viewerId === null) ? null : undefined);

  const coreError = core === undefined ? coreQuery.error : null;
  const bootstrapError = team ? null : context.error;
  const error = bootstrapError ?? coreError ?? null;
  const loading = !ready || context.bootstrapLoading || (hasTeam && (!seasonSettled || core === undefined) && !coreError);

  const refreshLive = useCallback(() => client.invalidateQueries(
    { predicate: (query) => isScopeResource(query, scope, LIVE_RESOURCES) }, { cancelRefetch: false },
  ), [client, scope]);
  const retry = useCallback(() => client.refetchQueries(
    { predicate: (query) => isScopeResource(query, scope, LIVE_RESOURCES) && query.state.status === "error" },
  ), [client, scope]);

  // Writes bind to the captured viewer and hold reads while in flight; nothing is optimistic
  // on the server's behalf. Reads cancelled by the barrier without data are refetched after.
  const write = useCallback(async (path: string) => {
    const finish = runtime.beginWrite(scope);
    try {
      return await apiFetch(path, { method: "POST", headers: await scopedHeaders(runtime, scope, false) });
    } finally {
      finish();
      void client.invalidateQueries({ predicate: (query) => cancelledWithoutData(query, scope) });
    }
  }, [client, runtime, scope]);

  const signupStatus = signupQuery.data ?? null;
  const submitSeasonSignup = useCallback(async () => {
    const res = await write("/api/season/signup");
    // Server-confirmed only: a failed POST never shows a false confirmation.
    if (res.ok) client.setQueryData(viewerKey(scope, "dashboard:signup"), (previous: Row | undefined) => ({
      ...(previous || {}), signed_up: true, next_season_number: (res.data as Row | null)?.next_season_number ?? previous?.next_season_number,
    }));
    return res.ok;
  }, [client, scope, write]);
  const dismissOnboardingOnServer = useCallback(async () => {
    try { await write("/api/me/onboarding-progress/dismiss"); } catch { /* best-effort: the local dismiss already applies */ }
  }, [write]);

  return {
    runtime,
    scope,
    team: team as Row | null,
    loading,
    error,
    retry,
    refreshLive,
    season,
    core,
    allAuctions: auctionsQuery.data ?? EMPTY_ROWS,
    activeOffers,
    cardReady: {
      auctions: noTeam || (hasTeam && auctionsQuery.status !== "pending"),
      transfers: noTeam || (hasTeam && offersQuery.status !== "pending"),
    },
    teamRaceIds,
    teamRaceIdsLoaded,
    forecast: forecastQuery.data ?? null,
    discordStatus: discordQuery.data ?? null,
    onboardingProgress: onboardingQuery.data ?? null,
    seasonSignupStatus: signupStatus,
    optionalModulesSettled,
    annualMeeting: meetingQuery.data ?? null,
    nextStageByRace,
    squadSelectionMissingRace,
    selectionReady,
    notTrainedToday: hasTeam ? trainingQuery.data ?? false : false,
    seasonStartCounts: hasTeam && windowOpen && season ? countsQuery.data ?? { trainingPlanCount: null, pendingGraduations: null } : { trainingPlanCount: null, pendingGraduations: null },
    completedSeasonRecap: hasTeam && windowOpen && season ? recapQuery.data ?? null : null,
    recentResults: settledList(recentQuery, EMPTY_ROWS),
    riderRanking: settledList(rankingQuery, EMPTY_ROWS),
    myLatestResult,
    submitSeasonSignup,
    dismissOnboardingOnServer,
  };
}
