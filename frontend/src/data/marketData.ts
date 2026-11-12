import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, type ApiFetchResult } from "../lib/apiFetch.ts";
import { flattenAbilities } from "../lib/abilities.js";
import { record, rows, parseApiResult, type DataRecord, DataError } from "./apiQuery.ts";
import { privateKey } from "./queryRuntime.ts";
import { useDataScope, scopedHeaders, invalidateScope } from "./useDataScope.ts";

export interface MarketRow extends DataRecord { id: string; }
export interface ListingRow extends MarketRow { asking_price: number; }
function marketRows(value: unknown): MarketRow[] {
  return rows(value).map(row => {
    if (typeof row.id !== "string") throw new DataError("invalid");
    return { ...row, id: row.id };
  });
}
function listingRows(value: unknown): ListingRow[] {
  return marketRows(value).map(row => {
    if (typeof row.asking_price !== "number" || !Number.isFinite(row.asking_price)) throw new DataError("invalid");
    return { ...row, asking_price: row.asking_price };
  });
}
export interface ServerReply extends DataRecord {
  error?: string; action?: string; price?: number; currentPrice?: number; minimumBid?: number;
  warnings?: unknown[]; updated?: DataRecord[]; failed?: DataRecord[];
  steps?: Array<{ key: string; done: boolean }>;
}
export function serverReply(value: unknown): ServerReply {
  const data = record(value);
  const result: ServerReply = { ...data };
  for (const key of ["error", "action"] as const) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== "string") throw new DataError("invalid");
      result[key] = data[key];
    }
  }
  for (const key of ["price", "currentPrice", "minimumBid"] as const) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== "number") throw new DataError("invalid");
      result[key] = data[key];
    }
  }
  for (const key of ["warnings", "updated", "failed"] as const) {
    if (data[key] !== undefined) {
      if (!Array.isArray(data[key])) throw new DataError("invalid");
      if (key === "warnings") result.warnings = data[key];
      else result[key] = rows(data[key]);
    }
  }
  if (data.steps !== undefined) result.steps = rows(data.steps).map(step => {
    if (typeof step.key !== "string" || typeof step.done !== "boolean") throw new DataError("invalid");
    return { key: step.key, done: step.done };
  });
  return result;
}
export type ServerReplyResult = Omit<ApiFetchResult, "data"> & { data: ServerReply | null };
export interface OfferGroups {
  sent: MarketRow[]; received: MarketRow[];
  archivedSent: MarketRow[]; archivedReceived: MarketRow[];
}
function parseGroups(value: unknown): OfferGroups {
  const data = record(value);
  return {
    sent: data.sent === undefined ? [] : marketRows(data.sent),
    received: data.received === undefined ? [] : marketRows(data.received),
    archivedSent: data.archivedSent === undefined ? [] : marketRows(data.archivedSent),
    archivedReceived: data.archivedReceived === undefined ? [] : marketRows(data.archivedReceived),
  };
}
function flatRider<T extends MarketRow>(row: T): T {
  return { ...row, rider: row.rider == null ? row.rider : flattenAbilities(record(row.rider)) };
}
function flatSwap<T extends MarketRow>(row: T): T {
  return { ...row, offered: row.offered == null ? row.offered : flattenAbilities(record(row.offered)), requested: row.requested == null ? row.requested : flattenAbilities(record(row.requested)) };
}
const EMPTY_ROWS: ListingRow[] = [];
const EMPTY_GROUPS: OfferGroups = { sent: [], received: [], archivedSent: [], archivedReceived: [] };
export type MarketPath = `/api/transfers${string}` | `/api/auctions/${string}` | "/api/achievements/check" | "/api/me/onboarding-progress" | "/api/market/auto-accept-config";

export function useMarketData() {
  const context = useDataScope();
  const { runtime, scope, team, ready } = context;
  const read = async <T,>(path: MarketPath, parse: (value: unknown) => T, signal: AbortSignal): Promise<T> => {
    const revision = await runtime.beforeRead(signal);
    const result = await apiFetch(path, { signal, headers: await scopedHeaders(runtime, scope, false) });
    runtime.assertReadCurrent(scope, revision);
    return parseApiResult(result, parse);
  };
  const listingsQuery = useQuery({ queryKey: privateKey(scope, "transfer-listings"), enabled: ready && !!team,
    queryFn: ({ signal }) => read("/api/transfers", listingRows, signal), select: data => data.map(flatRider) }, runtime.client);
  const offersQuery = useQuery({ queryKey: privateKey(scope, "transfer-offers"), enabled: ready && !!team,
    queryFn: async ({ signal }) => {
      const data = await read("/api/transfers/my-offers", parseGroups, signal);
      return { sent: data.sent.map(flatRider), received: data.received.map(flatRider), archivedSent: data.archivedSent.map(flatRider), archivedReceived: data.archivedReceived.map(flatRider) };
    } }, runtime.client);
  const swapsQuery = useQuery({ queryKey: privateKey(scope, "transfer-swaps"), enabled: ready && !!team,
    queryFn: async ({ signal }) => {
      const data = await read("/api/transfers/swaps", parseGroups, signal);
      return { sent: data.sent.map(flatSwap), received: data.received.map(flatSwap), archivedSent: data.archivedSent.map(flatSwap), archivedReceived: data.archivedReceived.map(flatSwap) };
    } }, runtime.client);
  const offers = ready ? offersQuery.data ?? EMPTY_GROUPS : EMPTY_GROUPS;
  const swaps = ready ? swapsQuery.data ?? EMPTY_GROUPS : EMPTY_GROUPS;
  const getHeaders = useCallback(() => scopedHeaders(runtime, scope), [runtime, scope]);
  const request = useCallback(async (path: MarketPath, options: RequestInit = {}): Promise<ServerReplyResult> => {
    runtime.assertCurrent(scope);
    const finish = options.method && options.method !== "GET" ? runtime.beginWrite(scope) : null;
    try {
      const result = await apiFetch(path, { ...options, headers: await scopedHeaders(runtime, scope, options.method !== undefined) });
      runtime.assertCurrent(scope);
      return { ...result, data: result.data == null ? null : serverReply(result.data) };
    } finally {
      finish?.();
      if (finish && runtime.scope().generation === scope.generation && runtime.scope().viewerId === scope.viewerId) void invalidateScope(runtime, scope);
    }
  }, [runtime, scope]);
  const loadAll = useCallback(() => invalidateScope(runtime, scope), [runtime, scope]);
  return {
    listings: ready ? listingsQuery.data ?? EMPTY_ROWS : EMPTY_ROWS,
    sentOffers: offers.sent, receivedOffers: offers.received,
    archivedSentOffers: offers.archivedSent, archivedReceivedOffers: offers.archivedReceived,
    sentSwaps: swaps.sent, receivedSwaps: swaps.received,
    archivedSentSwaps: swaps.archivedSent, archivedReceivedSwaps: swaps.archivedReceived,
    myTeamId: team?.id ?? null, myBalance: team?.balance ?? 0,
    loading: context.bootstrapLoading || (ready && !!team && [listingsQuery, offersQuery, swapsQuery].some(query => query.isPending)),
    hasData: ready && [listingsQuery, offersQuery, swapsQuery].every(query => query.data !== undefined),
    error: context.error ?? listingsQuery.error ?? offersQuery.error ?? swapsQuery.error,
    loadAll,
    request,
    refreshListings: async () => { const result = await listingsQuery.refetch(); return result.data ?? null; },
    getHeaders,
  };
}
