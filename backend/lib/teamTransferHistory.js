// Bygger offentlig handelshistorik for ét hold — hentet via
// GET /api/teams/:id/transfer-history. Samler events fra auctions, transfer_offers,
// swap_offers og loan_agreements og sorterer kronologisk (nyeste først).
//
// Privacy-kontrakt: genbruger samme whitelist som riderHistory.js (#105).
// Pending/afviste/annullerede forhandlinger må aldrig eksponeres.

import { PUBLIC_LOAN_STATUSES, PUBLIC_OFFER_STATUSES } from "./riderHistory.js";

export { PUBLIC_LOAN_STATUSES, PUBLIC_OFFER_STATUSES };

function buildSeasonResolver(seasons) {
  const sorted = [...(seasons || [])]
    .filter((s) => s.start_date)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
  return function resolveSeason(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    for (const s of sorted) {
      const start = new Date(s.start_date);
      // end_date er en DATE-kolonne (midnat UTC). Sæsonens sidste dag er
      // INKLUSIV: ved sæsonskifte deler gammel sæsons end_date og ny sæsons
      // start_date kalenderdag, og grænsedagens events (vindues-lukning +
      // salg før transitionen) hører til den gamle sæson (#984). Ascending
      // start_date-sortering gør at den gamle sæson vinder på grænsedagen.
      let end = null;
      if (s.end_date) {
        end = new Date(s.end_date);
        end.setUTCHours(23, 59, 59, 999);
      }
      if (d >= start && (!end || d <= end)) return s.number;
    }
    // Fallback: senest startede sæson før datoen (for events efter sæson-slut uden end_date)
    let last = null;
    for (const s of sorted) {
      if (new Date(s.start_date) <= d) last = s; else break;
    }
    return last ? last.number : null;
  };
}

export async function buildTeamTransferHistory(supabase, teamId) {
  const [auctionsRes, offersRes, swapsRes, loansRes, seasonsRes] = await Promise.all([
    supabase.from("auctions")
      .select("id, current_price, actual_end, created_at, is_guaranteed_sale, seller_team_id, current_bidder_id, seller:seller_team_id(id, name, is_ai), winner:current_bidder_id(id, name, is_ai), rider:rider_id(id, firstname, lastname)")
      .eq("status", "completed")
      .or(`seller_team_id.eq.${teamId},current_bidder_id.eq.${teamId}`)
      .order("actual_end", { ascending: false }),

    supabase.from("transfer_offers")
      .select("id, offer_amount, counter_amount, status, updated_at, seller_team_id, buyer_team_id, buyer:buyer_team_id(id, name, is_ai), seller:seller_team_id(id, name, is_ai), rider:rider_id(id, firstname, lastname)")
      .in("status", PUBLIC_OFFER_STATUSES)
      .or(`seller_team_id.eq.${teamId},buyer_team_id.eq.${teamId}`)
      .order("updated_at", { ascending: false }),

    supabase.from("swap_offers")
      .select("id, cash_adjustment, counter_cash, status, updated_at, proposing_team_id, receiving_team_id, offered_rider:offered_rider_id(id, firstname, lastname), requested_rider:requested_rider_id(id, firstname, lastname), proposing:proposing_team_id(id, name, is_ai), receiving:receiving_team_id(id, name, is_ai)")
      .in("status", PUBLIC_OFFER_STATUSES)
      .or(`proposing_team_id.eq.${teamId},receiving_team_id.eq.${teamId}`)
      .order("updated_at", { ascending: false }),

    supabase.from("loan_agreements")
      .select("id, loan_fee, start_season, end_season, status, created_at, updated_at, from_team_id, to_team_id, from_team:from_team_id(id, name, is_ai), to_team:to_team_id(id, name, is_ai), rider:rider_id(id, firstname, lastname)")
      .in("status", PUBLIC_LOAN_STATUSES)
      .or(`from_team_id.eq.${teamId},to_team_id.eq.${teamId}`)
      .order("created_at", { ascending: false }),

    supabase.from("seasons")
      .select("id, number, start_date, end_date")
      .order("number", { ascending: true }),
  ]);

  const resolveSeason = buildSeasonResolver(seasonsRes.data || []);
  const events = [];

  for (const a of auctionsRes.data || []) {
    const isSeller = a.seller_team_id === teamId;
    const date = a.actual_end || a.created_at;
    // #785: gennemført auktion uden vinder (og uden garanteret AI-salg) = intet
    // salg — rytteren blev på holdet. current_price er den umødte startpris og
    // må hverken vises som beløb eller tælle som pengestrøm/profit-salg.
    const noSale = !a.current_bidder_id && !a.is_guaranteed_sale;
    events.push({
      id: `auction:${a.id}`,
      type: "auction",
      direction: isSeller ? "out" : "in",
      // direction er rytter-centrisk; cash_flow er kontobevægelsen (#984):
      // salg = penge ind, køb = penge ud.
      cash_flow: !noSale && a.current_price > 0 ? (isSeller ? "in" : "out") : null,
      date,
      rider: a.rider,
      counterparty: isSeller ? a.winner : a.seller,
      amount: noSale ? null : a.current_price,
      no_sale: noSale,
      is_guaranteed_sale: a.is_guaranteed_sale,
      season_number: resolveSeason(date),
    });
  }

  for (const o of offersRes.data || []) {
    const isSeller = o.seller_team_id === teamId;
    const offerAmount = o.counter_amount ?? o.offer_amount;
    events.push({
      id: `transfer:${o.id}`,
      type: "transfer",
      direction: isSeller ? "out" : "in",
      cash_flow: offerAmount > 0 ? (isSeller ? "in" : "out") : null,
      date: o.updated_at,
      rider: o.rider,
      counterparty: isSeller ? o.buyer : o.seller,
      amount: offerAmount,
      status: o.status,
      season_number: resolveSeason(o.updated_at),
    });
  }

  for (const s of swapsRes.data || []) {
    const isProposing = s.proposing_team_id === teamId;
    const cashAdj = s.counter_cash ?? s.cash_adjustment ?? 0;
    // Direction følger cash-flow: hvis hold betalte = "out", modtog = "in", ellers ren bytte = "swap"
    let direction;
    if (cashAdj === 0) direction = "swap";
    else if (isProposing) direction = cashAdj > 0 ? "out" : "in";
    else direction = cashAdj > 0 ? "in" : "out";

    const counterparty = isProposing ? s.receiving : s.proposing;
    const riderIn = isProposing ? s.requested_rider : s.offered_rider;
    const riderOut = isProposing ? s.offered_rider : s.requested_rider;
    events.push({
      id: `swap:${s.id}`,
      type: "swap",
      direction,
      // For swap følger direction allerede cash-flowet (se ovenfor)
      cash_flow: cashAdj === 0 ? null : direction,
      date: s.updated_at,
      rider: riderIn,
      rider_swapped: riderOut,
      counterparty,
      amount: Math.abs(cashAdj),
      status: s.status,
      season_number: resolveSeason(s.updated_at),
    });
  }

  for (const l of loansRes.data || []) {
    const isFrom = l.from_team_id === teamId;
    events.push({
      id: `loan:${l.id}`,
      type: "loan",
      direction: isFrom ? "out" : "in",
      // Udlejer (from_team) modtager loan_fee, lejer betaler (api.js loan-accept)
      cash_flow: l.loan_fee > 0 ? (isFrom ? "in" : "out") : null,
      date: l.created_at,
      rider: l.rider,
      counterparty: isFrom ? l.to_team : l.from_team,
      amount: l.loan_fee,
      start_season: l.start_season,
      end_season: l.end_season,
      loan_status: l.status,
      season_number: resolveSeason(l.created_at),
    });
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}
