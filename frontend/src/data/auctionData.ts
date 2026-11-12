import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Database } from "../types/database.types.ts";
import { supabase } from "../lib/supabase.ts";
import { apiFetch } from "../lib/apiFetch.ts";
import { ABILITY_SELECT, flattenAbilities } from "../lib/abilities.js";
import { fetchAcademySquadCounts, EMPTY_SQUAD_COUNTS } from "../lib/squadCaps.ts";
import { subscribeAuthedChannel } from "../lib/realtimeChannel.js";
import { createAuctionRealtime, type AuctionRealtime } from "./auctionRealtime.ts";
import { privateKey } from "./queryRuntime.ts";
import { type DataRecord } from "./apiQuery.ts";
import { useDataScope, scopedHeaders, invalidateScope } from "./useDataScope.ts";
import { serverReply, type MarketPath, type ServerReplyResult } from "./marketData.ts";

type AuctionRow = Database["public"]["Tables"]["auctions"]["Row"];
type TeamName = Pick<Database["public"]["Tables"]["teams"]["Row"], "id" | "name">;
export type AuctionView = Pick<AuctionRow, "rider_id" | "id" | "current_price" | "min_increment" | "calculated_end" | "status" | "is_guaranteed_sale" | "is_flash" | "is_youth" | "seller_team_id" | "current_bidder_id"> & {
  rider: DataRecord | null; seller: TeamName | null; current_bidder: TeamName | null;
  myHighestBid?: number | null; myProxyMax?: number | null;
};
export type BidRow = Pick<Database["public"]["Tables"]["auction_bids"]["Row"], "id" | "auction_id" | "team_id" | "amount" | "bid_time">;
const EMPTY_AUCTIONS: AuctionView[] = [];
const EMPTY_BIDS: BidRow[] = [];
const EMPTY_WATCHLIST = new Set<string>();

export function useAuctionData() {
  const context = useDataScope();
  const { runtime, scope, team, ready } = context;
  const key = privateKey(scope, "auctions");
  const realtime = useMemo(() => createAuctionRealtime({ runtime, scope, resolveTeam: async (id, signal) => {
    runtime.assertCurrent(scope);
    const { data, error } = await supabase.from("teams").select("id, name").eq("id", id).abortSignal(signal).maybeSingle();
    runtime.assertCurrent(scope);
    if (error) throw error;
    return data;
  } }), [runtime, scope]);

  const query = useQuery({
    queryKey: key,
    enabled: ready && !!team,
    queryFn: async ({ signal }) => {
      const ticket = realtime.beginRead(signal, true);
      try {
      const revision = await runtime.beforeRead(signal);
      runtime.assertCurrent(scope);
      const teamId = scope.teamId!;
      const [auctions, bids, riderCount, proxies, counts, watchlist] = await Promise.all([
        supabase.from("auctions").select(`id, rider_id, current_price, min_increment, calculated_end, status, is_guaranteed_sale, is_flash, is_youth,
          seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, market_value, is_u25, team_id, birthdate, nationality_code,
            prize_earnings_bonus, salary, current_production_value, primary_type, secondary_type, contract_length, contract_end_season, popularity, reputation, ${ABILITY_SELECT}),
          seller:seller_team_id(id, name), current_bidder:current_bidder_id(id, name)`)
          .in("status", ["active", "extended"]).order("calculated_end", { ascending: true }).abortSignal(signal).returns<AuctionView[]>(),
        supabase.from("auction_bids").select("auction_id, amount").eq("team_id", teamId).abortSignal(signal),
        supabase.from("riders").select("id", { count: "exact", head: true }).eq("team_id", teamId).eq("is_academy", false).eq("is_retired", false).abortSignal(signal),
        supabase.from("auction_proxy_bids").select("auction_id, max_amount").eq("team_id", teamId).abortSignal(signal),
        fetchAcademySquadCounts(supabase, teamId),
        supabase.from("rider_watchlist").select("rider_id").eq("user_id", scope.viewerId!).abortSignal(signal),
      ]);
      runtime.assertCurrent(scope);
      for (const result of [auctions, bids, riderCount, proxies, watchlist]) if (result.error) throw result.error;
      const bidMap = new Map<string, number>();
      for (const bid of bids.data ?? []) bidMap.set(bid.auction_id, Math.max(bidMap.get(bid.auction_id) ?? 0, bid.amount));
      const proxyMap = new Map((proxies.data ?? []).map(proxy => [proxy.auction_id, proxy.max_amount]));
      const participatingIds = [...new Set([...bidMap.keys(), ...proxyMap.keys()])];
      let recentBids: BidRow[] = [];
      if (participatingIds.length) {
        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const recent = await supabase.from("auction_bids").select("id, auction_id, team_id, amount, bid_time")
          .in("auction_id", participatingIds).gte("bid_time", cutoff).order("bid_time", { ascending: true }).limit(60).abortSignal(signal);
        if (recent.error) throw recent.error;
        recentBids = recent.data ?? [];
      }
      runtime.assertReadCurrent(scope, revision);
      return realtime.completeRead({
        auctions: (auctions.data ?? []).map((auction): AuctionView => ({ ...auction, rider: flattenAbilities(auction.rider), myHighestBid: bidMap.get(auction.id) ?? null, myProxyMax: proxyMap.get(auction.id) ?? null })),
        watchlist: new Set((watchlist.data ?? []).map(row => row.rider_id)),
        currentRiderCount: riderCount.count,
        academySquadCounts: counts,
        recentBids, teamNamesById: {} as Record<string, string>, moneyPending: false, _moneyNeedsTeam: false, _serverRead: 0,
      }, ticket, signal);
      } finally { realtime.settledRead(ticket); }
    },
  }, runtime.client);
  const getHeaders = useCallback(async () => { await realtime.moneyReady(); return scopedHeaders(runtime, scope); }, [runtime, scope, realtime]);
  const request = useCallback(async (path: MarketPath, options: RequestInit = {}): Promise<ServerReplyResult> => {
    runtime.assertCurrent(scope);
    if (options.method && options.method !== "GET") await realtime.moneyReady();
    const finish = options.method && options.method !== "GET" ? runtime.beginWrite(scope) : null;
    try {
      const result = await apiFetch(path, { ...options, headers: await scopedHeaders(runtime, scope, options.method !== undefined) });
      runtime.assertCurrent(scope);
      return { ...result, data: result.data == null ? null : serverReply(result.data) };
    } finally {
      finish?.();
      if (finish && runtime.scope().generation === scope.generation && runtime.scope().viewerId === scope.viewerId) void invalidateScope(runtime, scope);
    }
  }, [runtime, scope, realtime]);
  const loadAll = useCallback(() => query.data?.moneyPending ? realtime.moneyReady() : invalidateScope(runtime, scope), [runtime, scope, realtime, query.data?.moneyPending]);
  const setWatchlist = useCallback((update: (current: Set<string>) => Set<string>) => {
    if (runtime.scope().generation !== scope.generation || runtime.scope().viewerId !== scope.viewerId) return;
    void runtime.client.cancelQueries({ queryKey: key });
    runtime.client.setQueryData<NonNullable<typeof query.data>>(key, previous => previous ? { ...previous, watchlist: update(previous.watchlist) } : previous);
  }, [runtime, scope, key]);
  const saveWatchlist = useCallback(async (riderId: string, remove: boolean) => {
    const headers = await scopedHeaders(runtime, scope);
    const finish = runtime.beginWrite(scope);
    try {
      const result = remove
        ? await supabase.from("rider_watchlist").delete().eq("user_id", scope.viewerId!).eq("rider_id", riderId).setHeader("Authorization", headers.Authorization)
        : await supabase.from("rider_watchlist").insert({ user_id: scope.viewerId!, rider_id: riderId }).setHeader("Authorization", headers.Authorization);
      runtime.assertCurrent(scope);
      if (result.error) throw result.error;
    } finally {
      finish();
      if (runtime.scope().generation === scope.generation && runtime.scope().viewerId === scope.viewerId) void invalidateScope(runtime, scope);
    }
  }, [runtime, scope]);
  return {
    auctions: ready ? query.data?.auctions ?? EMPTY_AUCTIONS : EMPTY_AUCTIONS,
    watchlist: ready ? query.data?.watchlist ?? EMPTY_WATCHLIST : EMPTY_WATCHLIST,
    currentRiderCount: query.data?.currentRiderCount ?? null,
    academySquadCounts: query.data?.academySquadCounts ?? EMPTY_SQUAD_COUNTS,
    recentBids: query.data?.recentBids ?? EMPTY_BIDS,
    teamNamesById: query.data?.teamNamesById ?? {}, moneyPending: query.data?.moneyPending ?? false, realtime,
    myTeamId: team?.id ?? null, myBalance: team?.balance ?? 0, userId: scope.viewerId,
    loading: context.bootstrapLoading || (ready && !!team && query.isPending),
    loadError: !!(context.error || query.error) && !query.data,
    loadAll, request, setWatchlist, saveWatchlist, getHeaders,
  };
}

export function useAuctionEvents(owner: AuctionRealtime, onAuction: (value: AuctionView, previous: AuctionView) => void, onBid: (value: BidRow) => void) {
  const { scope } = useDataScope();
  const callbacks = useRef({ onAuction, onBid });
  useEffect(() => { callbacks.current = { onAuction, onBid }; });
  useEffect(() => {
    if (!scope.viewerId || !scope.teamId) return;
    const lease = owner.start();
    const unsubscribe = subscribeAuthedChannel("auctions-live", channel => channel
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, (payload: Parameters<AuctionRealtime["auction"]>[0]) => owner.auction(payload, (next, previous) => callbacks.current.onAuction(next, previous), lease))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "auction_bids" }, (payload: Parameters<AuctionRealtime["bid"]>[0]) => owner.bid(payload, bid => callbacks.current.onBid(bid), lease)));
    return () => { unsubscribe(); owner.dispose(); };
  }, [owner, scope.generation, scope.viewerId, scope.teamId]);
}
