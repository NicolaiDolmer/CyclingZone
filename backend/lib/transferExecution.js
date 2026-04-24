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

function describeSwapIssue(issue, { swap, offered, requested }) {
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
      notificationMessage: `Handlen på ${swap.offered.firstname} ${swap.offered.lastname} ↔ ${swap.requested.firstname} ${swap.requested.lastname} kunne ikke gennemføres, fordi det foreslående hold mangler midler.`,
    };
  }

  return {
    error: "Det modtagende hold har ikke længere råd — byttehandlen er annulleret",
    notificationTitle: "Byttehandel annulleret",
    notificationMessage: `Handlen på ${swap.offered.firstname} ${swap.offered.lastname} ↔ ${swap.requested.firstname} ${swap.requested.lastname} kunne ikke gennemføres, fordi det modtagende hold mangler midler.`,
  };
}

export async function confirmTransferOffer({
  supabase,
  offerId,
  confirmingTeamId,
  notifyTeamOwner,
  logActivity = NOOP,
  notifyDiscordHistory = NOOP,
}) {
  const windowOpen = await getTransferWindowOpen(supabase);
  if (!windowOpen) {
    return failure(
      403,
      "Transfervinduet er lukket. Handlen kan ikke accepteres eller bekræftes i denne periode.",
      "window_closed"
    );
  }

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

  const price = getTransferPrice(confirmedOffer);
  const rider = await expectSingle(
    supabase
      .from("riders")
      .select("id, firstname, lastname, team_id, salary")
      .eq("id", confirmedOffer.rider_id)
  );
  const [buyerState, sellerState] = await Promise.all([
    getTeamMarketState(supabase, confirmedOffer.buyer_team_id),
    getTeamMarketState(supabase, confirmedOffer.seller_team_id),
  ]);

  const issue = getTransferExecutionIssue({
    rider,
    sellerState,
    buyerState,
    price,
  });

  if (issue) {
    const message = describeTransferIssue(issue, { rider, buyerState, sellerState });
    await withdrawTransferOffer(supabase, offer.id);
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_rejected",
      message.notificationTitle,
      message.notificationMessage,
      offer.id
    );
    return failure(400, message.error, issue.code);
  }

  const movedRider = await expectMaybeSingle(
    supabase
      .from("riders")
      .update({
        team_id: confirmedOffer.buyer_team_id,
        salary: calculateMarketSalary(price),
      })
      .eq("id", rider.id)
      .eq("team_id", confirmedOffer.seller_team_id)
      .select("id")
  );

  if (!movedRider) {
    await withdrawTransferOffer(supabase, offer.id);
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_rejected",
      "Transfer annulleret",
      `${rider.firstname} ${rider.lastname} kunne ikke gennemføres, fordi rytteren skiftede status under bekræftelsen.`,
      offer.id
    );
    return failure(
      409,
      "Rytteren skiftede status under bekræftelsen — handlen er annulleret",
      "stale_rider_state"
    );
  }

  await expectMutation(
    supabase
      .from("teams")
      .update({ balance: buyerState.balance - price })
      .eq("id", confirmedOffer.buyer_team_id)
  );
  await expectMutation(
    supabase
      .from("teams")
      .update({ balance: sellerState.balance + price })
      .eq("id", confirmedOffer.seller_team_id)
  );
  await expectMutation(
    supabase.from("finance_transactions").insert([
      {
        team_id: confirmedOffer.buyer_team_id,
        type: "transfer_out",
        amount: -price,
        description: `Købt ${rider.firstname} ${rider.lastname} via transfer`,
      },
      {
        team_id: confirmedOffer.seller_team_id,
        type: "transfer_in",
        amount: price,
        description: `Solgt ${rider.firstname} ${rider.lastname} via transfer`,
      },
    ])
  );

  await closeTransferListingsForRiders(supabase, [rider.id], "sold");
  await withdrawTransferOffersForRiders(supabase, [rider.id], confirmedOffer.id);
  await withdrawSwapOffersForRiders(supabase, [rider.id]);
  await expectMutation(
    supabase.from("transfer_offers").update({ status: "accepted" }).eq("id", confirmedOffer.id)
  );

  await logActivity("transfer_accepted", {
    team_id: confirmedOffer.seller_team_id,
    team_name: sellerState.name,
    rider_id: rider.id,
    rider_name: `${rider.firstname} ${rider.lastname}`,
    amount: price,
  });

  await notifyTeamOwner(
    otherTeamId,
    "transfer_offer_accepted",
    "Transfer gennemført!",
    `${rider.firstname} ${rider.lastname} skifter hold for ${price.toLocaleString()} CZ$`,
    confirmedOffer.id
  );

  await notifyDiscordHistory({
    riderName: `${rider.firstname} ${rider.lastname}`,
    sellerName: sellerState.name,
    buyerName: buyerState.name,
    price,
  });

  return success({ action: "accepted", price });
}

export async function confirmSwapOffer({
  supabase,
  swapId,
  confirmingTeamId,
  notifyTeamOwner,
  notifyDiscordHistory = NOOP,
}) {
  const windowOpen = await getTransferWindowOpen(supabase);
  if (!windowOpen) {
    return failure(
      403,
      "Transfervinduet er lukket. Byttehandlen kan ikke accepteres eller bekræftes i denne periode.",
      "window_closed"
    );
  }

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

  const cash = getSwapCash(confirmedSwap);
  const [offered, requested] = await Promise.all([
    expectSingle(
      supabase
        .from("riders")
        .select("id, firstname, lastname, team_id")
        .eq("id", confirmedSwap.offered_rider_id)
    ),
    expectSingle(
      supabase
        .from("riders")
        .select("id, firstname, lastname, team_id")
        .eq("id", confirmedSwap.requested_rider_id)
    ),
  ]);
  const [proposingState, receivingState] = await Promise.all([
    getTeamMarketState(supabase, confirmedSwap.proposing_team_id),
    getTeamMarketState(supabase, confirmedSwap.receiving_team_id),
  ]);

  const issue = getSwapExecutionIssue({
    swap: confirmedSwap,
    offered,
    requested,
    proposingState,
    receivingState,
    cash,
  });

  if (issue) {
    const message = describeSwapIssue(issue, {
      swap: confirmedSwap,
      offered,
      requested,
    });
    await withdrawSwapOffer(supabase, swap.id);
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_rejected",
      message.notificationTitle,
      message.notificationMessage,
      swap.id
    );
    return failure(400, message.error, issue.code);
  }

  const movedOffered = await expectMaybeSingle(
    supabase
      .from("riders")
      .update({ team_id: confirmedSwap.receiving_team_id })
      .eq("id", offered.id)
      .eq("team_id", confirmedSwap.proposing_team_id)
      .select("id")
  );

  if (!movedOffered) {
    await withdrawSwapOffer(supabase, swap.id);
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_rejected",
      "Byttehandel annulleret",
      `${offered.firstname} ${offered.lastname} ændrede status under bekræftelsen.`,
      swap.id
    );
    return failure(
      409,
      "Den tilbudte rytter ændrede status under bekræftelsen — byttehandlen er annulleret",
      "stale_offered_rider_state"
    );
  }

  const movedRequested = await expectMaybeSingle(
    supabase
      .from("riders")
      .update({ team_id: confirmedSwap.proposing_team_id })
      .eq("id", requested.id)
      .eq("team_id", confirmedSwap.receiving_team_id)
      .select("id")
  );

  if (!movedRequested) {
    await expectMutation(
      supabase
        .from("riders")
        .update({ team_id: confirmedSwap.proposing_team_id })
        .eq("id", offered.id)
    );
    await withdrawSwapOffer(supabase, swap.id);
    await notifyTeamOwner(
      otherTeamId,
      "transfer_offer_rejected",
      "Byttehandel annulleret",
      `${requested.firstname} ${requested.lastname} ændrede status under bekræftelsen.`,
      swap.id
    );
    return failure(
      409,
      "Den ønskede rytter ændrede status under bekræftelsen — byttehandlen er annulleret",
      "stale_requested_rider_state"
    );
  }

  if (cash > 0) {
    await expectMutation(
      supabase
        .from("teams")
        .update({ balance: proposingState.balance - cash })
        .eq("id", confirmedSwap.proposing_team_id)
    );
    await expectMutation(
      supabase
        .from("teams")
        .update({ balance: receivingState.balance + cash })
        .eq("id", confirmedSwap.receiving_team_id)
    );
    await expectMutation(
      supabase.from("finance_transactions").insert([
        {
          team_id: confirmedSwap.proposing_team_id,
          type: "transfer_out",
          amount: -cash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
        {
          team_id: confirmedSwap.receiving_team_id,
          type: "transfer_in",
          amount: cash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
      ])
    );
  } else if (cash < 0) {
    const absCash = Math.abs(cash);
    await expectMutation(
      supabase
        .from("teams")
        .update({ balance: receivingState.balance - absCash })
        .eq("id", confirmedSwap.receiving_team_id)
    );
    await expectMutation(
      supabase
        .from("teams")
        .update({ balance: proposingState.balance + absCash })
        .eq("id", confirmedSwap.proposing_team_id)
    );
    await expectMutation(
      supabase.from("finance_transactions").insert([
        {
          team_id: confirmedSwap.receiving_team_id,
          type: "transfer_out",
          amount: -absCash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
        {
          team_id: confirmedSwap.proposing_team_id,
          type: "transfer_in",
          amount: absCash,
          description: `Byttehandel kontantbetaling: ${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname}`,
        },
      ])
    );
  }

  await closeTransferListingsForRiders(
    supabase,
    [confirmedSwap.offered_rider_id, confirmedSwap.requested_rider_id],
    "withdrawn"
  );
  await withdrawTransferOffersForRiders(supabase, [
    confirmedSwap.offered_rider_id,
    confirmedSwap.requested_rider_id,
  ]);
  await withdrawSwapOffersForRiders(
    supabase,
    [confirmedSwap.offered_rider_id, confirmedSwap.requested_rider_id],
    confirmedSwap.id
  );
  await expectMutation(
    supabase.from("swap_offers").update({ status: "accepted" }).eq("id", confirmedSwap.id)
  );

  await notifyTeamOwner(
    otherTeamId,
    "transfer_offer_accepted",
    "Byttehandel gennemført!",
    `${offered.firstname} ${offered.lastname} ↔ ${requested.firstname} ${requested.lastname} er nu skiftet`,
    confirmedSwap.id
  );

  await notifyDiscordHistory({
    offeredName: `${offered.firstname} ${offered.lastname}`,
    requestedName: `${requested.firstname} ${requested.lastname}`,
    proposingName: proposingState.name,
    receivingName: receivingState.name,
    cash: cash !== 0 ? cash : null,
  });

  return success({ action: "accepted" });
}
