// #5631: ungdomsstillingen til Standings-fanen (trup-siden) og Youth races.
//
// Én hentning pr. (trup, pulje). Et svar fra en ældre hentning, eller efter
// unmount, kasseres, samme greb som useYouthSquad.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getYouthStandings } from "./youthStandingsApi.ts";
import type { YouthStandingsPool, YouthStandingsSquad } from "../../lib/youthRankingsClient.ts";

export type YouthStandingsStatus = "loading" | "ready" | "disabled" | "unavailable" | "error";

export function useYouthStandings(squad: YouthStandingsSquad, pool: number | null = null) {
  const [status, setStatus] = useState<YouthStandingsStatus>("loading");
  const [pools, setPools] = useState<YouthStandingsPool[]>([]);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setStatus("loading");
    const result = await getYouthStandings({ squad, pool });
    if (requestRef.current !== request) return;
    if (result.status === "ok") {
      setPools(result.pools);
      setStatus("ready");
      return;
    }
    setPools([]);
    setStatus(result.status);
  }, [squad, pool]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  return { status, pools, reload: load };
}

/** Viewerens hold-id (til "dig"-rækken og egen gruppe). null indtil kendt. */
export function useOwnTeamId(): string | null {
  const [teamId, setTeamId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle();
        const row = data as { id?: string } | null;
        if (!cancelled && row?.id) setTeamId(row.id);
      } catch {
        // Uden hold-id vises stillingen stadig, bare uden "dig"-markering.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return teamId;
}
