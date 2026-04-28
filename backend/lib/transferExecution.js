import {
  calculateMarketSalary,
  expectMaybeSingle,
  expectMutation,
  expectSingle,
  getIncomingSquadViolation,
  getOutgoingSquadViolation,
  getTeamMarketState,
  getTransferWindowOpen,
} from "./marketUtils.js";

const NOOP = async () => {};
const ACTIVE_MARKET_STATUSES = ["pending", "countered", "awaiting_confirmation"];

function success(payload) {
  return { ok: true, ...payload };
}

function failure(status, error, code, extra = {}) {
  return { ok: false, status, error, code, ...extra };
}

function getTransferPrice(offer) {
  return offer.counter_amount || offer.offer_amount;
}

function getSwapCash(swap) {
  return swap.counter_cash ?? swap.cash_adjustment;
}

export function getTransferExecutionIssue({ rider, sellerState, buyerState, price }) {
  if (!rider || rider.team_id !== sellerState.id) {
    return { code: "seller_no_longer_owns_rider" };
  }

  const sellerViolation = getOutgoingSquadViolation(sellerState);
  if (sellerViolation) {
    return { code: "seller_squad_too_small", ...sellerViolation };
  }

  const buyerViolation = getIncomingSquadViolation(buyerState);
  if (buyerViolation) {
    return { code: "buyer_squad_full", ...buyerViolation };
  }

  if ((buyerState.balance || 0) < price) {
    return { code: "buyer_insufficient_balance" };
  }

  return null;
}

export function getSwapExecutionIssue({
  swap,
  offered,
  requested,
  proposingState,
  receivingState,
  cash,
}) {
  if (!offered || offered.team_id !== swap.proposing_team_id) {
    return { code: "offered_rider_moved" };
  }

  if (!requested || requested.team_id !== swap.receiving_team_id) {
    return { code: "requested_rider_moved" };
  }

  if (cash > 0 && (proposingState.balance || 0) < cash) {
    return { code: "proposing_insufficient_balance" };
  }

  if (cash < 0 && (receivingState.balance || 0) < Math.abs(cash)) {
    return { code: "receiving_insufficient_balance" };
  }

  return null;
}

export function getTransferCancelIssue(offer) {
  if (offer?.status === "window_pending" || (offer?.buyer_confirmed && offer?.seller_confirmed)) {
    return { code: "deal_already_accepted" };
  }

  return null;
}

export function getSwapCancelIssue(swap) {
  if (swap?.status === "window_pending" || (swap?.proposing_confirmed && swap?.receiving_confirmed)) {
    return { code: "deal_already_accepted" };
  }

  return null;
}

async function withdrawTransferOffer(supabase, offerId) {
  await expectMutation(
    supabase.from("transfer_offers").update({ status: "withdrawn" }).eq("id", offerId)
  );
}

async function withdrawSwapOffer(supabase, swapId) {
  await expectMutation(
    supabase.from("swap_offers").update({ status: "withdrawn" }).eq("id", swapId)
  );
}

async function closeTransferListingsForRiders(supabase, riderIds, status) {
  await expectMutation(
    supabase
      .from("transfer_listings")
      .update({ status })
      .in("rider_id", riderIds)
      .in("status", ["open", "negotiating"])
  );
}

async function withdrawTransferOffersForRiders(supabase, riderIds, excludeOfferId = null) {
  let query = supabase
    .from("transfer_offers")
    .update({ status: "withdrawn" })
    .in("rider_id", riderIds)
    .in("status", ACTIVE_MARKET_STATUSES);

  if (excludeOfferId) {
    query = query.neq("id", excludeOfferId);
  }

  await expectMutation(query);
}

async function withdrawSwapOffersForRiders(supabase, riderIds, excludeSwapId = null) {
  const riderList = riderIds.join(",");
  let query = supabase
    .from("swap_offers")
    .update({ status: "withdrawn" })
    .in("status", ACTIVE_MARKET_STATUSES)
    .or(
      `offered_rider_id.in.(${riderList}),requested_rider_id.in.(${riderList})`
    );

  if (excludeSwapId) {
    query = query.neq("id", excludeSwapId);
  }

  await expectMutation(query);
}

function describeTransferIssue(issue, { rider, buyerState, sellerState }) {
  if (issue.code === "seller_no_longer_owns_rider") {
    return {
      error: "Sælger ejer ikke længere rytteren — handlen er annulleret",
      notificationTitle: "Transfer annulleret",
      notificationMessage: `${rider.firstname} ${rider.lastname} kunne ikke gennemføres, fordi rytteren ikke længere står på sælgers hold.`,
    };
  }

  if (issue.code === "seller_squad_too_small") {
    return {
      error: `Sælger må ikke komme under ${issue.minRiders} ryttere i Division ${sellerState.division} — handlen er annulleret`,
      notificationTitle: "Transfer annulleret",
      notificationMessage: `${rider.firstname} ${rider.lastname} kunne ikke sælges, fordi sælgeren ellers ville komme under ${issue.minRiders} ryttere i Division ${sellerState.division}.`,
    };
  }

  if (issue.code === "buyer_squad_full") {
    return {
      error: `Købers hold kan max have ${issue.maxRiders} ryttere i Division ${buyerState.division} — handlen er annulleret`,
      notificationTitle: "Transfer annulleret",
      notificationMessage: `${rider.firstname} ${rider.lastname} kunne ikke overdrages, fordi købers hold allerede er fuldt.`,
    };
  }

  return {
    error: "Køber har ikke længere råd — handlen er annulleret",
    notificationTitle: "Transfer annulleret",
    notificationMessage: `Handlen på ${rider.firstname} ${rider.lastname} kunne ikke gennemføres, fordi køber mangler midler.`,
  };
}

function describeSwapIssue(issue, { offered, requested }) {
  if (issue.code === "offered_rider_moved") {
    return {
      error: "Din tilbudte rytter tilhører ikke længere dit hold — byttehandlen er annulleret",
      notificationTitle: "Byttehandel annulleret",
      notificationMessage: `${offered.firstname} ${offered.lastname} er ikke længere tilgængelig til byttehandlen.`,
    };
  }

  if (issue.code === "requested_rider_moved") {
    return {
      error: "Den ønskede rytter tilhører ikke længere modparten — byttehandlen er annulleret",
      notificationTitle: "Byttehandel annulleret",
      notificationMessage: `${requested.firstname} ${requested.lastname} er ikke længere tilgængelig til byttehandlen.`,
    };
  }

  if (issue.code === "proposing_insufficient_balance") {
    return {
      error: "Det foreslående hold har ikke længere råd — byttehandlen er annulleret",
      notificationTitle: "Byttehandel annulleret",
      notificationMessage: `Handlen på ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname} kunne ikke gennemføres, fordi det foreslående hold mangler midler.`,
    };
  }

  return {
    error: "Det modtagende hold har ikke længere råd — byttehandlen er annulleret",
    notificationTitle: "Byttehandel annulleret",
    notificationMessage: `Handlen på ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname} kunne ikke gennemføres, fordi det modtagende hold mangler midler.`,
  };
}

// Private: execute a fully-agreed transfer offer. Window must be open at call site.
async function executeTransferOffer(supabase, offer, { logActivity = NOOP, notifyTeamOwner = NOOP, notifyDiscordHistory = NOOP }) {
  const price = getTransferPrice(offer);
  const rider = await expectSingle(
    supabase
      .from("riders")
      .select("id, firstname, lastname, team_id, salary, prize_earnings_bonus")
      .eq("id", offer.rider_id)
  );
  const [buyerState, sellerState] = await Promise.all([
    getTeamMarketState(supabase, offer.buyer_team_id),
    getTeamMarketState(supabase, offer.seller_team_id),
  ]);

  const issue = getTransferExecutionIssue({ rider, sellerState, buyerState, price });

  if (issue) {
    const message = describeTransferIssue(issue, { rider, buyerState, sellerState });
    await withdrawTransferOffer(supabase, offer.id);
    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, offer.id);
    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, offer.id);
    return failure(400, message.error, issue.code);
  }

  const movedRider = await expectMaybeSingle(
    supabase
      .from("riders")
      .update({
        team_id: offer.buyer_team_id,
        salary: calculateMarketSalary(price, rider.prize_earnings_bonus || 0),
      })
      .eq("id", rider.id)
      .eq("team_id", offer.seller_team_id)
      .select("id")
  );

  if (!movedRider) {
    await withdrawTransferOffer(supabase, offer.id);
    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_rejected", "Transfer annulleret",
      `${rider.firstname} ${rider.lastname} kunne ikke gennemføres, fordi rytteren skiftede status under bekræftelsen.`, offer.id);
    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_rejected", "Transfer annulleret",
      `${rider.firstname} ${rider.lastname} kunne ikke gennemføres, fordi rytteren skiftede status under bekræftelsen.`, offer.id);
    return failure(409, "Rytteren skiftede status under bekræftelsen — handlen er annulleret", "stale_rider_state");
  }

  await expectMutation(
    supabase.from("teams").update({ balance: buyerState.balance - price }).eq("id", offer.buyer_team_id)
  );
  await expectMutation(
    supabase.from("teams").update({ balance: sellerState.balance + price }).eq("id", offer.seller_team_id)
  );
  await expectMutation(
    supabase.from("finance_transactions").insert([
      {
        team_id: offer.buyer_team_id,
        type: "transfer_out",
        amount: -price,
        description: `Købt ${rider.firstname} ${rider.lastname} via transfer`,
      },
      {
        team_id: offer.seller_team_id,
        type: "transfer_in",
        amount: price,
        description: `Solgt ${rider.firstname} ${rider.lastname} via transfer`,
      },
    ])
  );

  await closeTransferListingsForRiders(supabase, [rider.id], "sold");
  await withdrawTransferOffersForRiders(supabase, [rider.id], offer.id);
  await withdrawSwapOffersForRiders(supabase, [rider.id]);
  await expectMutation(
    supabase.from("transfer_offers").update({ status: "accepted" }).eq("id", offer.id)
  );

  await logActivity("transfer_accepted", {
    team_id: offer.seller_team_id,
    team_name: sellerState.name,
    rider_id: rider.id,
    rider_name: `${rider.firstname} ${rider.lastname}`,
    amount: price,
  });

  await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_accepted", "Transfer gennemført!",
    `${rider.firstname} ${rider.lastname} skifter hold for ${price.toLocaleString()} CZ$`, offer.id);
  await notifyTeamOwner(offer.seller_team_id, "transfer_offer_accepted", "Transfer gennemført!",
    `${rider.firstname} ${rider.lastname} skifter hold for ${price.toLocaleString()} CZ$`, offer.id);

  await notifyDiscordHistory({
    riderName: `${rider.firstname} ${rider.lastname}`,
    sellerName: sellerState.name,
    buyerName: buyerState.name,
    price,
  });

  return success({ action: "accepted", price });
}

// Private: execute a fully-agreed swap offer. Window must be open at call site.
async function executeSwapOffer(supabase, swap, { notifyTeamOwner = NOOP, notifyDiscordHistory = NOOP }) {
  const cash = getSwapCash(swap);
  const [offered, requested] = await Promise.all([
    expectSingle(
      supabase.from("riders").select("id, firstname, lastname, team_id").eq("id", swap.offered_rider_id)
    ),
    expectSingle(
      supabase.from("riders").select("id, firstname, lastname, team_id").eq("id", swap.requested_rider_id)
    ),
  ]);
  const [proposingState, receivingState] = await Promise.all([
    getTeamMarketState(supabase, swap.proposing_team_id),
    getTeamMarketState(supabase, swap.receiving_team_id),
  ]);

  const issue = getSwapExecutionIssue({ swap, offered, requested, proposingState, receivingState, cash });

  if (issue) {
    const message = describeSwapIssue(issue, { offered, requested });
    await withdrawSwapOffer(supabase, swap.id);
    await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, swap.id);
    await notifyTeamOwner(swap.receiving_team_id, "transfer_offer_rejected", message.notificationTitle, message.notificationMessage, swap.id);
    return failure(400, message.error, issue.code);
  }

  const movedOffered = await expectMaybeSingle(
    supabase
      .from("riders")
      .update({ team_id: swap.receiving_team_id })
      .eq("id", offered.id)
      .eq("team_id", swap.proposing_team_id)
      .select("id")
  );

  if (!movedOffered) {
    await withdrawSwapOffer(supabase, swap.id);
    await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_rejected", "Byttehandel annulleret",
      `${offered.firstname} ${offered.lastname} ændrede status under bekræftelsen.`, swap.id);
    await notifyTeamOwner(swap.receiving_team_id, "transfer_offer_rejected", "Byttehandel annulleret",
      `${offered.firstname} ${offered.lastname} ændrede status under bekræftelsen.`, swap.id);
    return failure(409, "Den tilbudte rytter ændrede status under bekræftelsen — byttehandlen er annulleret", "stale_offered_rider_state");
  }

  const movedRequested = await expectMaybeSingle(
    supabase
      .from("riders")
      .update({ team_id: swap.proposing_team_id })
      .eq("id", requested.id)
      .eq("team_id", swap.receiving_team_id)
      .select("id")
  );

  if (!movedRequested) {
    await expectMutation(
      supabase.from("riders").update({ team_id: swap.proposing_team_id }).eq("id", offered.id)
    );
    await withdrawSwapOffer(supabase, swap.id);
    await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_rejected", "Byttehandel annulleret",
      `${requested.firstname} ${requested.lastname} ændrede status under bekræftelsen.`, swap.id);
    await notifyTeamOwner(swap.receiving_team_id, "transfer_offer_rejected", "Byttehandel annulleret",
      `${requested.firstname} ${requested.lastname} ændrede status under bekræftelsen.`, swap.id);
    return failure(409, "Den ønskede rytter ændrede status under bekræftelsen — byttehandlen er annulleret", "stale_requested_rider_state");
  }

  if (cash > 0) {
    await expectMutation(
      supabase.from("teams").update({ balance: proposingState.balance - cash }).eq("id", swap.proposing_team_id)
    );
    await expectMutation(
      supabase.from("teams").update({ balance: receivingState.balance + cash }).eq("id", swap.receiving_team_id)
    );
    await expectMutation(
      supabase.from("finance_transactions").insert([
        {
          team_id: swap.proposing_team_id,
          type: "transfer_out",
          amount: -cash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
        {
          team_id: swap.receiving_team_id,
          type: "transfer_in",
          amount: cash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
      ])
    );
  } else if (cash < 0) {
    const absCash = Math.abs(cash);
    await expectMutation(
      supabase.from("teams").update({ balance: receivingState.balance - absCash }).eq("id", swap.receiving_team_id)
    );
    await expectMutation(
      supabase.from("teams").update({ balance: proposingState.balance + absCash }).eq("id", swap.proposing_team_id)
    );
    await expectMutation(
      supabase.from("finance_transactions").insert([
        {
          team_id: swap.receiving_team_id,
          type: "transfer_out",
          amount: -absCash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
        {
          team_id: swap.proposing_team_id,
          type: "transfer_in",
          amount: absCash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
      ])
    );
  }

  await closeTransferListingsForRiders(
    supabase,
    [swap.offered_rider_id, swap.requested_rider_id],
    "withdrawn"
  );
  await withdrawTransferOffersForRiders(supabase, [swap.offered_rider_id, swap.requested_rider_id]);
  await withdrawSwapOffersForRiders(supabase, [swap.offered_rider_id, swap.requested_rider_id], swap.id);
  await expectMutation(
    supabase.from("swap_offers").update({ status: "accepted" }).eq("id", swap.id)
  );

  await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_accepted", "Byttehandel gennemført!",
    `${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname} er nu skiftet`, swap.id);
  await notifyTeamOwner(swap.receiving_team_id, "transfer_offer_accepted", "Byttehandel gennemført!",
    `${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname} er nu skiftet`, swap.id);

  await notifyDiscordHistory({
    offeredName: `${offered.firstname} ${offered.lastname}`,
    requestedName: `${requested.firstname} ${requested.lastname}`,
    proposingName: proposingState.name,
    receivingName: receivingState.name,
    cash: cash !== 0 ? cash : null,
  });

  return success({ action: "accepted" });
}

export async function confirmTransferOffer({
  supabase,
  offerId,
  confirmingTeamId,
  notifyTeamOwner,
  logActivity = NOOP,
  notifyDiscordHistory = NOOP,
}) {
  const offer = await expectMaybeSingle(
    supabase
      .from("transfer_offers")
      .select(
        "id, rider_id, seller_team_id, buyer_team_id, offer_amount, counter_amount, status, buyer_confirmed, seller_confirmed, rider:rider_id(id, firstname, lastname, team_id)"
      )
      .eq("id", offerId)
  );

  if (!offer) {
    return failure(404, "Tilbud ikke fundet", "offer_missing");
  }

  const isSeller = offer.seller_team_id === confirmingTeamId;
  const isBuyer = offer.buyer_team_id === confirmingTeamId;

  if (!isSeller && !isBuyer) {
    return failure(403, "Ikke involveret i dette tilbud", "not_involved");
  }

  if (offer.status !== "awaiting_confirmation") {
    return failure(400, "Ugyldig handling", "not_awaiting_confirmation");
  }

  if ((isSeller && offer.seller_confirmed) || (isBuyer && offer.buyer_confirmed)) {
    return failure(400, "Du har allerede bekræftet", "already_confirmed");
  }

  const updatedFields = isSeller
    ? { seller_confirmed: true }
    : { buyer_confirmed: true };

  await expectMutation(
    supabase.from("transfer_offers").update(updatedFields).eq("id", offer.id)
  );

  const confirmedOffer = { ...offer, ...updatedFields };
  const nowSellerConfirmed = Boolean(confirmedOffer.seller_confirmed);
  const nowBuyerConfirmed = Boolean(confirmedOffer.buyer_confirmed);
  const otherTeamId = isSeller ? offer.buyer_team_id : offer.seller_team_id;

  if (!nowSellerConfirmed || !nowBuyerConfirmed) {
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_accepted",
      "Handlen afventer din bekræftelse",
      `${isSeller ? "Sælger" : "Køber"} har bekræftet handlen på ${offer.rider.firstname} ${offer.rider.lastname}. Bekræft for at gennemføre.`,
      offer.id
    );

    return success({ action: "confirmed_partial" });
  }

  const windowOpen = await getTransferWindowOpen(supabase);

  if (!windowOpen) {
    await expectMutation(
      supabase.from("transfer_offers").update({ status: "window_pending" }).eq("id", offer.id)
    );
    await closeTransferListingsForRiders(supabase, [offer.rider_id], "negotiating");
    await withdrawTransferOffersForRiders(supabase, [offer.rider_id], offer.id);
    await withdrawSwapOffersForRiders(supabase, [offer.rider_id]);
    const parkMsg = `Handlen på ${offer.rider.firstname} ${offer.rider.lastname} er aftalt og gennemføres automatisk, når transfervinduet åbner.`;
    await notifyTeamOwner(offer.buyer_team_id, "transfer_offer_accepted", "Handel parkeret", parkMsg, offer.id);
    await notifyTeamOwner(offer.seller_team_id, "transfer_offer_accepted", "Handel parkeret", parkMsg, offer.id);
    return success({ action: "window_pending" });
  }

  return executeTransferOffer(supabase, confirmedOffer, { logActivity, notifyTeamOwner, notifyDiscordHistory });
}

export async function confirmSwapOffer({
  supabase,
  swapId,
  confirmingTeamId,
  notifyTeamOwner,
  notifyDiscordHistory = NOOP,
}) {
  const swap = await expectMaybeSingle(
    supabase
      .from("swap_offers")
      .select(
        "id, offered_rider_id, requested_rider_id, proposing_team_id, receiving_team_id, cash_adjustment, counter_cash, status, proposing_confirmed, receiving_confirmed, offered:offered_rider_id(id, firstname, lastname, team_id), requested:requested_rider_id(id, firstname, lastname, team_id)"
      )
      .eq("id", swapId)
  );

  if (!swap) {
    return failure(404, "Byttehandel ikke fundet", "swap_missing");
  }

  const isProposing = swap.proposing_team_id === confirmingTeamId;
  const isReceiving = swap.receiving_team_id === confirmingTeamId;

  if (!isProposing && !isReceiving) {
    return failure(403, "Ikke involveret i denne byttehandel", "not_involved");
  }

  if (swap.status !== "awaiting_confirmation") {
    return failure(400, "Ugyldig handling", "not_awaiting_confirmation");
  }

  if ((isProposing && swap.proposing_confirmed) || (isReceiving && swap.receiving_confirmed)) {
    return failure(400, "Du har allerede bekræftet", "already_confirmed");
  }

  const updatedFields = isProposing
    ? { proposing_confirmed: true }
    : { receiving_confirmed: true };

  await expectMutation(
    supabase.from("swap_offers").update(updatedFields).eq("id", swap.id)
  );

  const confirmedSwap = { ...swap, ...updatedFields };
  const nowProposing = Boolean(confirmedSwap.proposing_confirmed);
  const nowReceiving = Boolean(confirmedSwap.receiving_confirmed);
  const otherTeamId = isProposing ? swap.receiving_team_id : swap.proposing_team_id;

  if (!nowProposing || !nowReceiving) {
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_accepted",
      "Byttehandel afventer din bekræftelse",
      `${isProposing ? "Det foreslående hold" : "Det modtagende hold"} har bekræftet byttehandlen. Bekræft for at gennemføre.`,
      swap.id
    );

    return success({ action: "confirmed_partial" });
  }

  const windowOpen = await getTransferWindowOpen(supabase);

  if (!windowOpen) {
    await expectMutation(
      supabase.from("swap_offers").update({ status: "window_pending" }).eq("id", swap.id)
    );
    await withdrawTransferOffersForRiders(supabase, [swap.offered_rider_id, swap.requested_rider_id]);
    await withdrawSwapOffersForRiders(supabase, [swap.offered_rider_id, swap.requested_rider_id], swap.id);
    const parkMsg = `Byttehandlen ${swap.offered.firstname} ${swap.offered.lastname} ↔ ${swap.requested.firstname} ${swap.requested.lastname} er aftalt og gennemføres automatisk, når transfervinduet åbner.`;
    await notifyTeamOwner(swap.proposing_team_id, "transfer_offer_accepted", "Byttehandel parkeret", parkMsg, swap.id);
    await notifyTeamOwner(swap.receiving_team_id, "transfer_offer_accepted", "Byttehandel parkeret", parkMsg, swap.id);
    return success({ action: "window_pending" });
  }

  return executeSwapOffer(supabase, confirmedSwap, { notifyTeamOwner, notifyDiscordHistory });
}

// Executes all window_pending offers and swaps — called when the transfer window opens.
export async function flushWindowPendingOffers(supabase, {
  logActivity = NOOP,
  notifyTeamOwner = NOOP,
  notifyTransferCompleted = NOOP,
  notifySwapCompleted = NOOP,
}) {
  const [pendingTransfers, pendingSwaps] = await Promise.all([
    supabase
      .from("transfer_offers")
      .select("id, rider_id, seller_team_id, buyer_team_id, offer_amount, counter_amount")
      .eq("status", "window_pending"),
    supabase
      .from("swap_offers")
      .select("id, offered_rider_id, requested_rider_id, proposing_team_id, receiving_team_id, cash_adjustment, counter_cash")
      .eq("status", "window_pending"),
  ]);

  let transfersProcessed = 0;
  for (const offer of (pendingTransfers.data || [])) {
    const result = await executeTransferOffer(supabase, offer, {
      logActivity,
      notifyTeamOwner,
      notifyDiscordHistory: notifyTransferCompleted,
    });
    if (result.ok) transfersProcessed++;
  }

  let swapsProcessed = 0;
  for (const swap of (pendingSwaps.data || [])) {
    const result = await executeSwapOffer(supabase, swap, {
      notifyTeamOwner,
      notifyDiscordHistory: notifySwapCompleted,
    });
    if (result.ok) swapsProcessed++;
  }

  return { transfersProcessed, swapsProcessed };
}
