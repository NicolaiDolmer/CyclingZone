// Bygger den offentlige handelshistorik for én rytter — hentet via
// GET /api/riders/:id/history. Samler events fra auctions, transfer_offers og
// swap_offers og sorterer kronologisk (nyeste først).
//
// Privacy-kontrakt: kun "afgjorte" eller endeligt-låste tilbud ekskluderes IKKE.
// Pending/afviste/annullerede forhandlinger er privat information mellem de
// involverede parter og vises hverken her eller andre public-facing endpoints.
//
// Whitelist per type:
//   auctions:        status = "completed"
//   transfer_offers: status in ("accepted", "window_pending")
//   swap_offers:     status in ("accepted", "window_pending")

import { assertNoSupabaseError } from "./supabaseResultGuard.js";

export const PUBLIC_OFFER_STATUSES = ["accepted", "window_pending"];

export async function buildRiderHistory(supabase, riderId) {
  const [auctionsRes, offersRes, swapsRes] = await Promise.all([
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
  ]);

  // Security-audit 2026-06-12 (P3, #1338): Supabase-fejl må ikke sluges stille.
  // Tidligere brugte hver løkke `res.data || []`, så en query-fejl (RLS, timeout,
  // mistet forbindelse) returnerede en tom historik der lignede "ingen handler".
  // Kast i stedet — rutens eksisterende try/catch overflader det som 500.
  assertNoSupabaseError({
    auctions: auctionsRes,
    transfer_offers: offersRes,
    swap_offers: swapsRes,
  }, "buildRiderHistory");

  const events = [];

  for (const a of auctionsRes.data || []) {
    // #785: en gennemført auktion uden vinder (og uden garanteret AI-salg) er
    // IKKE et salg — rytteren blev på holdet. current_price er bare den umødte
    // startpris, så den udelades (price: null) for ikke at antyde en handel.
    const noSale = !a.winner && !a.is_guaranteed_sale;
    events.push({
      type: "auction",
      date: a.actual_end || a.created_at,
      price: noSale ? null : a.current_price,
      seller: a.seller,
      buyer: a.winner,
      no_sale: noSale,
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

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}
