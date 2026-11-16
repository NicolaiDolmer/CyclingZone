// #8081 / #8060: henter rådata til det rettede akademi-regnskab direkte fra
// Supabase (læsning under holdets egen RLS), kun når en designudgave er tændt.
// Beregningen bor i academyLedger.ts. Den valgte udgave flytter hentningen til
// backend (GET /api/academy/pnl) når den bygges.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { getAuthedUser } from "../../lib/getAuthedUser.js";
import { buildAcademyRiderPool, buildLedgerSales, buildSeasonLedger } from "./academyLedger.ts";
import type { LedgerSale, PoolMember, Row, SeasonLedger } from "./academyLedger.ts";

export type LedgerState = {
  loading: boolean;
  error: string | null;
  ledger: SeasonLedger | null;
  sales: LedgerSale[];
  pool: Map<string, PoolMember>;
  squadById: Map<string, string | null>;
};

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as Row[] | null) ?? [];
}

export function useAcademyLedger8081(enabled: boolean, rosterIds: readonly string[] = []): LedgerState & { reload: () => Promise<void> } {
  const [state, setState] = useState<LedgerState>({
    loading: Boolean(enabled), error: null, ledger: null, sales: [], pool: new Map(), squadById: new Map(),
  });
  const rosterKey = rosterIds.join(",");

  const load = useCallback(async () => {
    if (!enabled) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const user = await getAuthedUser();
      if (!user?.id) throw new Error("auth");
      const { data: team, error: teamErr } = await supabase
        .from("teams").select("id").eq("user_id", user.id).maybeSingle();
      if (teamErr || !team?.id) throw new Error(teamErr?.message ?? "no_team");
      const teamId: string = team.id;

      const [seasons, financeRows, signedIntake, youthAuctionWins] = await Promise.all([
        rows(supabase.from("seasons").select("id, number, status, start_date, end_date")),
        // pagination-safe: ét hold, kun de to akademi-typer, langt under 1000 rækker
        rows(supabase.from("finance_transactions").select("type, amount, season_id, created_at, metadata, related_entity_type").eq("team_id", teamId).in("type", ["academy_drift", "academy_signing"])),
        rows(supabase
          .from("academy_intake")
          .select("rider_id, riders(firstname, lastname)")
          .eq("team_id", teamId)
          .eq("status", "signed")),
        rows(supabase
          .from("auctions")
          .select("rider_id, current_bidder_id, is_guaranteed_sale, current_price, actual_end, is_youth, riders(firstname, lastname)")
          .eq("is_youth", true)
          .eq("status", "completed")
          .eq("current_bidder_id", teamId)),
      ]);

      // Forsvar i dybden: de to auktions-hentninger skilles også på is_youth her,
      // så en ungdomsauktion aldrig kan tælle som salg (og omvendt).
      const pool = buildAcademyRiderPool({ signedIntake, youthAuctionWins: youthAuctionWins.filter((a) => a.is_youth === true) });
      const poolIds = [...pool.keys()];
      let auctionRows: Row[] = [];
      let transferRows: Row[] = [];
      if (poolIds.length > 0) {
        [auctionRows, transferRows] = await Promise.all([
          rows(supabase
            .from("auctions")
            .select("rider_id, current_bidder_id, is_guaranteed_sale, current_price, actual_end, is_youth")
            .eq("seller_team_id", teamId)
            .eq("is_youth", false)
            .eq("status", "completed")
            .in("rider_id", poolIds)),
          rows(supabase
            .from("transfer_offers")
            .select("rider_id, offer_amount, counter_amount, updated_at")
            .eq("seller_team_id", teamId)
            .eq("status", "accepted")
            .in("rider_id", poolIds)),
        ]);
      }

      const ids = rosterKey ? rosterKey.split(",") : [];
      const squadRows = ids.length > 0
        ? await rows(supabase.from("riders").select("id, squad").in("id", ids)) // pagination-safe: kun holdets ungdomsryttere (trupgrænserne)
        : [];

      const currentSeasonId: string | null = seasons.find((s) => s.status === "active")?.id ?? null;
      const sales = buildLedgerSales({ auctionRows: auctionRows.filter((a) => a.is_youth === false), transferRows, pool, seasons });
      const ledger = buildSeasonLedger({ financeRows, sales, seasons, currentSeasonId });
      setState({
        loading: false,
        error: null,
        ledger,
        sales,
        pool,
        squadById: new Map(squadRows.map((r) => [String(r.id), r.squad ?? null])),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed";
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, [enabled, rosterKey]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}
