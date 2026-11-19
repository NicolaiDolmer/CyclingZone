// #8060: henter rækkerne til akademi-regnskabet pr. sæson til GET /api/academy/pnl.
// Reglen (rytterkreds, opdeling, sæsoner) bor i academyPnl.ts, som er ren; denne
// fil laver kun læsningerne, så routen kun skal have én linje mere.
//
// Al historik vokser med sæsonerne, så hver hentning pagineres med stabil
// order("id"), og id-lister deles i bidder (#3030: lange .in()-lister vælter
// gatewayen). Ingen skrivning.
//
// Kontakten: feltet lægges kun på svaret, når academy_page_v2_8081 er tændt for
// vieweren (samme kontakt som akademisiden udgave A, PR #8271). Ikke seedet,
// fejl eller "off" = slukket, og så er svaret præcis som før.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { buildAcademyLedgerPayload } from "./academyPnl.ts";
import type {
  AcademyLedgerPayload,
  AuctionSaleInput,
  IntakeInput,
  LedgerFinanceRow,
  SeasonInput,
  TransferSaleInput,
  YouthWinInput,
} from "./academyPnl.ts";

// Supabase-klienten er utypet i kernen (samme som academyIntakeProfile.ts).
type Db = any;

export const ACADEMY_LEDGER_FLAG_KEY = "academy_page_v2_8081";

/** Er sæsonregnskabet tændt for denne viewer? Fejl og manglende række = slukket. */
export async function isAcademyLedgerEnabled(supabase: Db, { isBetaTester = false }: { isBetaTester?: boolean } = {}): Promise<boolean> {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY_LEDGER_FLAG_KEY), { isBetaTester });
}

/** Hent og beregn regnskabet pr. sæson for ét hold. Kaster ved læsefejl. */
export async function loadAcademySeasonLedger(supabase: Db, { teamId }: { teamId: string }): Promise<AcademyLedgerPayload> {
  const [seasons, financeRows, signedIntake, youthAuctionWins] = await Promise.all([
    fetchAllRows(() => supabase.from("seasons").select("id, number, status, start_date, end_date").order("id")) as Promise<SeasonInput[]>,
    fetchAllRows(() => supabase
      .from("finance_transactions")
      .select("id, type, amount, season_id, created_at, metadata, related_entity_type, idempotency_key")
      .eq("team_id", teamId)
      .in("type", ["academy_drift", "academy_signing"])
      .order("id")) as Promise<LedgerFinanceRow[]>,
    fetchAllRows(() => supabase
      .from("academy_intake")
      .select("id, rider_id, riders(firstname, lastname)")
      .eq("team_id", teamId)
      .eq("status", "signed")
      .order("id")) as Promise<IntakeInput[]>,
    fetchAllRows(() => supabase
      .from("auctions")
      .select("id, rider_id, current_bidder_id, is_guaranteed_sale, riders(firstname, lastname)")
      .eq("is_youth", true)
      .eq("status", "completed")
      .eq("current_bidder_id", teamId)
      .order("id")) as Promise<YouthWinInput[]>,
  ]);

  const poolIds = [...new Set(
    [...signedIntake, ...youthAuctionWins].map((r) => r.rider_id).filter((id): id is string => Boolean(id)),
  )];

  let auctionRows: Partial<AuctionSaleInput>[] = [];
  let transferRows: Partial<TransferSaleInput>[] = [];
  if (poolIds.length > 0) {
    [auctionRows, transferRows] = await Promise.all([
      fetchAllRowsChunkedIn(poolIds, (ids: string[]) => supabase
        .from("auctions")
        .select("id, rider_id, current_price, current_bidder_id, is_guaranteed_sale, actual_end")
        .eq("seller_team_id", teamId)
        .eq("is_youth", false)
        .eq("status", "completed")
        .in("rider_id", ids)
        .order("id")),
      fetchAllRowsChunkedIn(poolIds, (ids: string[]) => supabase
        .from("transfer_offers")
        .select("id, rider_id, offer_amount, counter_amount, updated_at")
        .eq("seller_team_id", teamId)
        .eq("status", "accepted")
        .in("rider_id", ids)
        .order("id")),
    ]);
  }

  return buildAcademyLedgerPayload({ seasons, financeRows, signedIntake, youthAuctionWins, auctionRows, transferRows });
}
