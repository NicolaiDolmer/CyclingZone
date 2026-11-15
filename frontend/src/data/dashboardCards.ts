import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { apiFetch } from "../lib/apiFetch.ts";
import { getGlobalRank } from "../lib/rankingsApi.ts";
import { isHiddenYouthCareerEvent } from "../lib/youthClassification.ts";
import { inviteDismissKey, isInviteDismissed, isSurveyPastClose } from "../lib/survey.js";
import { readFirstRacePreviewParam, normalizeFirstRaceCardPayload } from "../lib/firstRaceCardPayload.js";
import { privateKey, viewerKey } from "./queryRuntime.ts";
import { useDataScope, scopedHeaders } from "./useDataScope.ts";

// #6494: the Dashboard's self-fetching cards read through the shared scope instead of each
// repeating auth.getUser() + a teams lookup. Every card stays best-effort: a failure renders
// nothing (null), never an error surface, exactly as before.
type Row = Record<string, any>;

/** #2453: own team's global rank and weekly movement. null = no card. */
export function useGlobalRankWidgetData(): Row | null {
  const { runtime, scope, team, ready } = useDataScope();
  const teamId = (team as Row | null)?.id ?? null;
  const query = useQuery({
    queryKey: privateKey(scope, "dashboard:global-rank-widget"),
    enabled: ready && teamId !== null,
    queryFn: async ({ signal }): Promise<Row | null> => {
      const revision = await runtime.beforeRead(signal);
      const [{ data: mv }, { data: weekly }] = await Promise.all([
        getGlobalRank(teamId),
        supabase.from("global_rank_weekly_snapshot").select("global_rank").eq("team_id", teamId as string).abortSignal(signal).maybeSingle(),
      ]) as [{ data: Row | null }, { data: Row | null }];
      runtime.assertReadCurrent(scope, revision);
      if (!mv) return null;
      const currentRank = mv.global_rank == null ? null : Number(mv.global_rank);
      const prevRank = weekly?.global_rank == null ? null : Number(weekly.global_rank);
      const movement = currentRank == null || prevRank == null ? null : prevRank - currentRank;
      return { ...mv, global_rank: currentRank, movement };
    },
  }, runtime.client);
  return query.data ?? null;
}

const MAX_CAREER_EVENTS = 3;
/** #3398: the team's latest career-first moments. null = loading, [] = no card. */
export function useCareerFirstsData(): Row[] | null {
  const { runtime, scope, team, ready } = useDataScope();
  const teamId = (team as Row | null)?.id ?? null;
  const query = useQuery({
    queryKey: privateKey(scope, "dashboard:career-firsts"),
    enabled: ready && teamId !== null,
    queryFn: async ({ signal }): Promise<Row[]> => {
      const revision = await runtime.beforeRead(signal);
      // pagination-safe: career firsts are rare per team; the limit keeps the payload small.
      const { data, error } = await supabase.from("rider_career_events")
        .select("id, event_type, rider_id, rider_name, team_name, race_id, params, occurred_at, race:race_id(squad)")
        .eq("team_id", teamId as string)
        .order("occurred_at", { ascending: false })
        // #7031: fetch a little extra so hidden youth-jersey moments do not empty the card.
        .limit(MAX_CAREER_EVENTS * 2)
        .abortSignal(signal);
      runtime.assertReadCurrent(scope, revision);
      if (error) {
        // Honest degradation (e.g. table not migrated yet): no banner, just no card.
        console.warn("rider_career_events fetch failed (table may not be migrated yet):", error.message);
        return [];
      }
      return (data || []).filter((event: Row) => !isHiddenYouthCareerEvent(event, event.race?.squad)).slice(0, MAX_CAREER_EVENTS);
    },
  }, runtime.client);
  if (query.isError) return [];
  return query.data ?? null;
}

/** #3746/#3803: one-off development transition panel. null = inactive/loading. */
export function useDevTransitionData() {
  const { runtime, scope, ready } = useDataScope();
  const key = viewerKey(scope, "dashboard:dev-transition");
  const query = useQuery({
    queryKey: key,
    enabled: ready && scope.viewerId !== null,
    queryFn: async ({ signal }): Promise<Row | null> => {
      const revision = await runtime.beforeRead(signal);
      const res = await apiFetch("/api/development/transition", { signal, headers: await scopedHeaders(runtime, scope, false) });
      runtime.assertReadCurrent(scope, revision);
      // Any failure (limited/unauthorized/network) renders nothing: it is an explanation, not a function.
      return res.ok && (res.data as Row | null)?.active ? res.data as Row : null;
    },
  }, runtime.client);
  const dismiss = useCallback(async () => {
    // Hiding an explanation panel is UI state, not money: hide now, persist in the background.
    // The barrier first: its cancel reverts in-flight reads, which must not restore the panel.
    const finish = runtime.beginWrite(scope);
    runtime.client.setQueryData(key, null);
    try {
      await apiFetch("/api/development/transition/dismiss", { method: "POST", headers: await scopedHeaders(runtime, scope, false) });
    } catch { /* best-effort: at worst the panel shows again */ } finally { finish(); }
  }, [runtime, scope, key]);
  return { data: query.isError ? null : query.data ?? null, dismiss };
}

/** #4943: the newest open survey the viewer has neither completed nor dismissed. `hide` clears
 * the cached invite too, so a dismissed card does not return from cache on the next visit. */
export function useSurveyInviteData(): { survey: Row | null; hide: () => void } {
  const { runtime, scope, ready } = useDataScope();
  const viewerId = scope.viewerId;
  const key = viewerKey(scope, "dashboard:survey-invite");
  const query = useQuery({
    queryKey: key,
    enabled: ready && viewerId !== null,
    queryFn: async ({ signal }): Promise<Row | null> => {
      const revision = await runtime.beforeRead(signal);
      // The close filter sits in the query itself, before order/limit, so an expired newest
      // survey never wins over an older valid one.
      const nowIso = new Date().toISOString();
      const { data: rows } = await supabase.from("surveys")
        .select("id, slug, status, closes_at")
        .eq("status", "open")
        .or(`closes_at.is.null,closes_at.gt.${nowIso}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .abortSignal(signal);
      const open = rows?.[0];
      if (!open || isSurveyPastClose(open.closes_at)) return null;
      let dismissed;
      try {
        dismissed = isInviteDismissed(window.localStorage.getItem(inviteDismissKey(open.slug)));
      } catch {
        dismissed = false; // private window / blocked storage: show the card
      }
      if (dismissed) return null;
      const { data: completions } = await supabase.from("survey_completions")
        .select("user_id").eq("survey_id", open.id).eq("user_id", viewerId as string).limit(1).abortSignal(signal);
      runtime.assertReadCurrent(scope, revision);
      return completions?.[0] ? null : open;
    },
  }, runtime.client);
  const hide = useCallback(() => { runtime.client.setQueryData(key, null); }, [runtime, key]);
  return { survey: query.isError ? null : query.data ?? null, hide };
}

/** #1140: server-decided "Your first race" card. null = no card (also while loading). */
export function useFirstRaceCardData(): Row | null {
  const { runtime, scope, team, ready } = useDataScope();
  const teamId = (team as Row | null)?.id ?? null;
  const preview = readFirstRacePreviewParam(typeof window !== "undefined" ? window.location.search : "");
  const query = useQuery({
    queryKey: privateKey(scope, "dashboard:first-race-card", preview ?? null),
    enabled: ready && teamId !== null,
    queryFn: async ({ signal }): Promise<Row | null> => {
      const revision = await runtime.beforeRead(signal);
      const res = await apiFetch(`/api/me/first-race-card${preview ? `?preview=${preview}` : ""}`, { signal, headers: await scopedHeaders(runtime, scope, false) });
      runtime.assertReadCurrent(scope, revision);
      return res.ok && !res.limited && !res.unauthorized ? normalizeFirstRaceCardPayload(res.data) : null;
    },
  }, runtime.client);
  return query.isError ? null : query.data ?? null;
}
