// Bygger den offentlige handelshistorik for én rytter — hentet via
// GET /api/riders/:id/history. Samler events fra auctions, transfer_offers,
// swap_offers og loan_agreements og sorterer kronologisk (nyeste først).
//
// Privacy-kontrakt: kun "afgjorte" eller endeligt-låste tilbud ekskluderes IKKE.
// Pending/afviste/annullerede forhandlinger er privat information mellem de
// involverede parter og vises hverken her eller andre public-facing endpoints.
//
// Whitelist per type:
//   auctions:        status = "completed"
//   transfer_offers: status in ("accepted", "window_pending")
//   swap_offers:     status in ("accepted", "window_pending")
//   loan_agreements: status in ("active", "completed", "buyout")
//     - "active":    leje løber lige nu, offentlig handel
//     - "completed": leje afsluttet ved sæsonslut (forward-compat — endnu
//                    uden producent-kode, men inkluderet for fremtidig brug)
//     - "buyout":    borrower udnyttede købsoption, permanent ejerskifte

export const PUBLIC_LOAN_STATUSES = ["active", "completed", "buyout"];
export const PUBLIC_OFFER_STATUSES = ["accepted", "window_pending"];

export async function buildRiderHistory(supabase, riderId) {
  const [auctionsRes, offersRes, swapsRes, loansRes] = await Promise.all([
    supabase.from("auctions")
      .select("id, current_price, actual_end, created_at, is_guaranteed_sale, seller:seller_team_id(id, name, is_ai), winner:current_bidder_id(id, name)")
      .eq("rider_id", riderId)
      .eq("status", "completed")
      .order("actual_end", { ascending: false }),

    supabase.from("transfer_offers")
      .select("id, offer_amount, counter_amount, status, updated_at, buyer:buyer_team_id(id, name), seller:seller_team_id(id, name)")
      .eq("rider_id", riderId)
      .in("status", PUBLIC_OFFER_STATUSES)
      .order("updated_at", { ascending: false }),

    supabase.from("swap_offers")
      .select("id, cash_adjustment, counter_cash, status, updated_at, offered_rider_id, requested_rider_id, proposing:proposing_team_id(id, name), receiving:receiving_team_id(id, name)")
      .or(`offered_rider_id.eq.${riderId},requested_rider_id.eq.${riderId}`)
      .in("status", PUBLIC_OFFER_STATUSES)
      .order("updated_at", { ascending: false }),

    supabase.from("loan_agreements")
      .select("id, loan_fee, start_season, end_season, status, created_at, updated_at, from_team:from_team_id(id, name), to_team:to_team_id(id, name)")
      .eq("rider_id", riderId)
      .in("status", PUBLIC_LOAN_STATUSES)
      .order("created_at", { ascending: false }),
  ]);

  const events = [];

  for (const a of auctionsRes.data || []) {
    events.push({
      type: "auction",
      date: a.actual_end || a.created_at,
      price: a.current_price,
      seller: a.seller,
      buyer: a.winner,
      is_ai_sale: a.seller?.is_ai ?? false,
      is_guaranteed_sale: a.is_guaranteed_sale,
    });
  }

  for (const o of offersRes.data || []) {
    events.push({
      type: "transfer",
      date: o.updated_at,
      price: o.counter_amount ?? o.offer_amount,
      seller: o.seller,
      buyer: o.buyer,
    });
  }

  for (const s of swapsRes.data || []) {
    const cashAdj = s.counter_cash ?? s.cash_adjustment;
    events.push({
      type: "swap",
      date: s.updated_at,
      cash_adjustment: cashAdj,
      proposing_team: s.proposing,
      receiving_team: s.receiving,
      rider_role: s.offered_rider_id === riderId ? "offered" : "requested",
    });
  }

  for (const l of loansRes.data || []) {
    events.push({
      type: "loan",
      date: l.created_at,
      loan_fee: l.loan_fee,
      start_season: l.start_season,
      end_season: l.end_season,
      status: l.status,
      from_team: l.from_team,
      to_team: l.to_team,
    });
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}
