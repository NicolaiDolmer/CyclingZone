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

// #4004/#3582 gik i produktion 2026-08-18 (database/2026-08-18-3582-rider-
// ownership-audit.sql) — enhver REEL ejerskabsændring efter denne dato bør
// have en matchende rider_ownership_events-række. Kun brugt til at afgrænse
// #4297-dedupen nedenfor til data hvor fravær af en række er en pålidelig
// fejl-indikator; ældre auktioner har legitimt ingen række, fordi loggen
// ikke fandtes endnu.
const OWNERSHIP_AUDIT_LIVE_FROM = Date.parse("2026-08-18T00:00:00Z");

export async function buildRiderHistory(supabase, riderId) {
  const [auctionsRes, offersRes, swapsRes, ownershipRes] = await Promise.all([
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

    // #4297: en free-agent-auktion (ingen ejer bag sælgeren) kan nå status
    // "completed" med en vinder registreret uden at ejerskabet nogensinde
    // reelt blev overdraget (rodårsagen i selve overdragelsen er IKKE fundet
    // her — se PR #4297). Symptomet er en ny free-agent-auktion på samme
    // rytter kort efter, som DEN gang lykkes — historikken viste begge som
    // rigtige salg. rider_ownership_events er facit for hvad der reelt skete.
    supabase.from("rider_ownership_events")
      .select("related_entity_type, related_entity_id")
      .eq("rider_id", riderId)
      .eq("related_entity_type", "auction"),
  ]);

  // Security-audit 2026-06-12 (P3, #1338): Supabase-fejl må ikke sluges stille.
  // Tidligere brugte hver løkke `res.data || []`, så en query-fejl (RLS, timeout,
  // mistet forbindelse) returnerede en tom historik der lignede "ingen handler".
  // Kast i stedet — rutens eksisterende try/catch overflader det som 500.
  assertNoSupabaseError({
    auctions: auctionsRes,
    transfer_offers: offersRes,
    swap_offers: swapsRes,
    rider_ownership_events: ownershipRes,
  }, "buildRiderHistory");

  const confirmedAuctionIds = new Set(
    (ownershipRes.data || []).map((e) => e.related_entity_id).filter(Boolean)
  );

  // Kandidater til #4297-dedupen: gennemførte free-agent-auktioner (intet
  // ejer-hold bag sælgeren) med en registreret vinder. Kun disse kan overhovedet
  // være en phantom-fuldførelse — en ejers egen salgs-auktion har altid en
  // sælger, og en auktion uden vinder er allerede no_sale af #785 alene.
  const freeAgentWins = (auctionsRes.data || []).filter((a) => !a.seller && a.winner);

  const events = [];

  for (const a of auctionsRes.data || []) {
    // #785: en gennemført auktion uden bud er ikke en handel — bare støj i
    // rytterens offentlige historik (samme princip som TeamTransferHistoryTab
    // /#2400, blot uden toggle her: denne fane er ikke ejerens egen, og der er
    // ingen grund til at kunne slå "ingen bud"-rækker til igen).
    const noSale = !a.winner && !a.is_guaranteed_sale;

    // #4297: denne auktion er en phantom-fuldførelse hvis den (a) er en
    // free-agent-vinder der IKKE er bekræftet af rider_ownership_events, (b)
    // ligger efter audit-loggens lancering (ellers er manglende bekræftelse
    // forventet, ikke en fejl), og (c) en SENERE free-agent-auktion på samme
    // rytter ER bekræftet — dvs. rytteren blev reelt overdraget først dengang.
    const auctionEndMs = Date.parse(a.actual_end || a.created_at || "");
    const isPhantomFreeAgentWin =
      !noSale &&
      !a.seller &&
      Number.isFinite(auctionEndMs) &&
      auctionEndMs >= OWNERSHIP_AUDIT_LIVE_FROM &&
      !confirmedAuctionIds.has(a.id) &&
      freeAgentWins.some((other) => {
        if (other.id === a.id || !confirmedAuctionIds.has(other.id)) return false;
        const otherEndMs = Date.parse(other.actual_end || other.created_at || "");
        return Number.isFinite(otherEndMs) && otherEndMs > auctionEndMs;
      });

    events.push({
      type: "auction",
      date: a.actual_end || a.created_at,
      price: (noSale || isPhantomFreeAgentWin) ? null : a.current_price,
      seller: a.seller,
      buyer: a.winner,
      no_sale: noSale || isPhantomFreeAgentWin,
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
