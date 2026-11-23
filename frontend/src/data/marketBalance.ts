import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { fetchReservedBalance, resolveBalanceDisplay } from "../lib/availableBalance.js";
import { privateKey, viewerKey } from "./queryRuntime.ts";
import { appRuntime, useDataScope } from "./useDataScope.ts";

const RESERVATION = "market:reserved-balance";
// #8357: how long a surface may show a skeleton while the reservation loads. After this
// the raw balance is shown, so the number never stays hidden behind a slow read.
export const RESERVED_WAIT_MS = 4000;

export type MarketBalance = NonNullable<ReturnType<typeof resolveBalanceDisplay>>;

/**
 * #8357: the one balance every surface shows (sidebar, dashboard, auctions). The raw
 * balance always comes from the shared team query, so two surfaces can never show two
 * different numbers. `fallbackBalance` is only used before the shared team has loaded.
 */
export function useMarketBalance(fallbackBalance?: number | null): MarketBalance | null {
  const { runtime, scope, team, ready, error: teamError, teamRefreshing } = useDataScope();
  const teamId = team?.id;
  const reservationKey = privateKey(scope, RESERVATION);
  const reservation = useQuery({
    queryKey: reservationKey,
    enabled: ready && Boolean(teamId),
    async queryFn({ signal }) {
      if (!teamId) throw new Error("Market balance has no team");
      const revision = await runtime.beforeRead(signal);
      const result = await fetchReservedBalance(supabase, teamId, signal);
      runtime.assertReadCurrent(scope, revision);
      return result;
    },
  }, runtime.client);
  const failed = reservation.isError;
  const waiting = reservation.data === undefined && !failed;
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!waiting) { setTimedOut(false); return undefined; }
    const timer = setTimeout(() => setTimedOut(true), RESERVED_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  const balance = team?.balance ?? fallbackBalance ?? null;
  // Settlement can release a reservation before the team read confirms payment.
  // A bid or automatic-bid change invalidates the reservation; its cached amount is
  // old until the refetch lands, so it must not be shown as available meanwhile.
  const reservationUnconfirmed = reservation.isFetching
    && runtime.client.getQueryState(reservationKey)?.isInvalidated === true;
  const balanceUnconfirmed = !team || teamRefreshing || Boolean(teamError) || reservationUnconfirmed;
  return resolveBalanceDisplay(balance, reservation.data ?? null, { failed, timedOut, balanceUnconfirmed });
}

export function refreshMarketBalance(): void {
  const runtime = appRuntime();
  const scope = runtime.scope();
  if (!scope.ready || scope.viewerId == null) return;
  void runtime.client.invalidateQueries({ queryKey: viewerKey(scope, "team"), exact: true });
  void runtime.client.invalidateQueries({ queryKey: privateKey(scope, RESERVATION), exact: true });
}
