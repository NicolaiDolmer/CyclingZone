// Aggregerer "Skal handles"-items: pending decisions hvor managerens team er
// den part der mangler at træffe valg eller bekræfte. Bruges af /api/inbox/pending
// og af NotificationsPage's "Skal handles"-tab.
//
// "Pending decision" i denne sammenhæng:
//   - transfer_offers: pending modtaget, modbud modtaget, eller awaiting_confirmation
//     hvor min side endnu ikke har bekræftet
//   - swap_offers: samme principper
//
// Auctions er IKKE inkluderet — de udløser ikke "pending decisions" i FM-forstand
// (current_bidder kan vælge at bidde højere men er ikke under tidskrav).

function emptyResult() {
  return {
    transfer_offers: [],
    swap_offers: [],
    counts: {
      transfer_offers: 0,
      swap_offers: 0,
      total: 0,
    },
  };
}

function classifyTransferOfferRole(offer, teamId) {
  const isSeller = offer.seller_team_id === teamId;
  const isBuyer = offer.buyer_team_id === teamId;

  if (offer.status === "pending" && isSeller) {
    return "seller_decide"; // sælger skal acceptere/afvise/modbyde
  }
  if (offer.status === "countered" && isBuyer) {
    return "buyer_decide"; // køber har modtaget modbud
  }
  if (offer.status === "awaiting_confirmation") {
    if (isSeller && !offer.seller_confirmed) return "seller_confirm";
    if (isBuyer && !offer.buyer_confirmed) return "buyer_confirm";
  }
  return null;
}

function classifySwapOfferRole(swap, teamId) {
  const isProposing = swap.proposing_team_id === teamId;
  const isReceiving = swap.receiving_team_id === teamId;

  if (swap.status === "pending" && isReceiving) {
    return "receiving_decide";
  }
  if (swap.status === "countered" && isProposing) {
    return "proposing_decide";
  }
  if (swap.status === "awaiting_confirmation") {
    if (isReceiving && !swap.receiving_confirmed) return "receiving_confirm";
    if (isProposing && !swap.proposing_confirmed) return "proposing_confirm";
  }
  return null;
}

async function fetchPendingTransferOffers(supabase, teamId) {
  const { data, error } = await supabase
    .from("transfer_offers")
    .select(`
      id, status, offer_amount, counter_amount,
      buyer_team_id, seller_team_id, rider_id,
      buyer_confirmed, seller_confirmed,
      created_at, updated_at,
      rider:rider_id(id, firstname, lastname),
      buyer_team:buyer_team_id(id, name),
      seller_team:seller_team_id(id, name)
    `)
    .or(`buyer_team_id.eq.${teamId},seller_team_id.eq.${teamId}`)
    .in("status", ["pending", "countered", "awaiting_confirmation"])
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data || [])
    .map((offer) => {
      const role = classifyTransferOfferRole(offer, teamId);
      if (!role) return null;
      const price = offer.counter_amount ?? offer.offer_amount;
      const riderName = offer.rider
        ? `${offer.rider.firstname} ${offer.rider.lastname}`
        : "Ukendt rytter";
      return {
        id: offer.id,
        kind: "transfer_offer",
        role,
        rider_id: offer.rider_id,
        rider_name: riderName,
        counterparty_team_name:
          role.startsWith("seller") ? offer.buyer_team?.name : offer.seller_team?.name,
        price,
        updated_at: offer.updated_at || offer.created_at,
        link: "/transfers",
      };
    })
    .filter(Boolean);
}

async function fetchPendingSwapOffers(supabase, teamId) {
  const { data, error } = await supabase
    .from("swap_offers")
    .select(`
      id, status,
      proposing_team_id, receiving_team_id,
      offered_rider_id, requested_rider_id,
      cash_adjustment, counter_cash,
      proposing_confirmed, receiving_confirmed,
      created_at, updated_at,
      offered_rider:offered_rider_id(id, firstname, lastname),
      requested_rider:requested_rider_id(id, firstname, lastname),
      proposing_team:proposing_team_id(id, name),
      receiving_team:receiving_team_id(id, name)
    `)
    .or(`proposing_team_id.eq.${teamId},receiving_team_id.eq.${teamId}`)
    .in("status", ["pending", "countered", "awaiting_confirmation"])
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data || [])
    .map((swap) => {
      const role = classifySwapOfferRole(swap, teamId);
      if (!role) return null;
      const offered = swap.offered_rider
        ? `${swap.offered_rider.firstname} ${swap.offered_rider.lastname}`
        : "Ukendt";
      const requested = swap.requested_rider
        ? `${swap.requested_rider.firstname} ${swap.requested_rider.lastname}`
        : "Ukendt";
      const cash = swap.counter_cash ?? swap.cash_adjustment ?? 0;
      return {
        id: swap.id,
        kind: "swap_offer",
        role,
        offered_rider_name: offered,
        requested_rider_name: requested,
        counterparty_team_name:
          role.startsWith("receiving")
            ? swap.proposing_team?.name
            : swap.receiving_team?.name,
        cash_adjustment: cash,
        updated_at: swap.updated_at || swap.created_at,
        link: "/transfers",
      };
    })
    .filter(Boolean);
}

export async function getPendingInboxItems({ supabase, teamId }) {
  if (!teamId) return emptyResult();

  const [transferOffers, swapOffers] = await Promise.all([
    fetchPendingTransferOffers(supabase, teamId),
    fetchPendingSwapOffers(supabase, teamId),
  ]);

  const total = transferOffers.length + swapOffers.length;

  return {
    transfer_offers: transferOffers,
    swap_offers: swapOffers,
    counts: {
      transfer_offers: transferOffers.length,
      swap_offers: swapOffers.length,
      total,
    },
  };
}

export const __testing = {
  classifyTransferOfferRole,
  classifySwapOfferRole,
  emptyResult,
};
