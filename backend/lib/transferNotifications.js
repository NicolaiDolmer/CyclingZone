// #2174 · Transfer/auction/swap/loan notification-copy builders.
//
// Baggrund: notifikationer for auktion, transfer, byttehandel og leje blev
// tidligere sendt med rå danske title/message-strenge direkte fra api.js +
// transferExecution.js. De landede ordret i notifications-tabellen og lækkede
// dansk til EN-spillere i indbakken (hele "øverste besked"-klyngen).
//
// Løsning (samme kontrakt som #666 buildContractExpiringNotification): hver
// builder returnerer { title, message, metadata } hvor:
//   • title/message = EN-first fallback (vises hvis en klient ikke kan resolve
//     koden — #1068: aldrig rå dansk i backend).
//   • metadata.{titleCode, titleParams, messageCode, messageParams} = i18n-koder
//     i backendMessages-namespacet. Frontend renderer via renderBackendMessage()
//     → notif.transfer.* i public/locales/{en,da}/backendMessages.json, så
//     sproget følger brugerens valg konsekvent.
//
// Numeriske params (amount/price/fee/counterAmount/cash) formateres locale-aware
// i frontend (formatBackendParams i lib/backendMessage.js) — send derfor RENE
// tal, ikke .toLocaleString()-strenge.

// Slå riderId sammen med i18n-koderne så eksisterende klik-navigation (metadata
// .riderId) bevares.
function withRider(metadata, riderId) {
  return riderId != null ? { riderId, ...metadata } : metadata;
}

// ─── Auktion ──────────────────────────────────────────────────────────────────

export function buildBidReceivedNotification({ bidderName, amount, riderName, riderId }) {
  return {
    type: "bid_received",
    title: "New bid received",
    message: `${bidderName} bid ${amount.toLocaleString("en-US")} CZ$ on ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.bidReceived.title",
      titleParams: {},
      messageCode: "notif.transfer.bidReceived.message",
      messageParams: { bidderName, amount, riderName },
    }, riderId),
  };
}

export function buildAuctionOutbidNotification({ bidderName, amount, riderName, riderId }) {
  return {
    type: "auction_outbid",
    title: "You've been outbid!",
    message: `${bidderName} bid ${amount.toLocaleString("en-US")} CZ$ on ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.auctionOutbid.title",
      titleParams: {},
      messageCode: "notif.transfer.bidReceived.message",
      messageParams: { bidderName, amount, riderName },
    }, riderId),
  };
}

export function buildWatchlistAuctionNotification({ riderName, startPrice, riderId }) {
  return {
    type: "watchlist_rider_auction",
    title: "Watchlisted rider up for auction",
    message: `${riderName} is up for auction (starting price ${startPrice.toLocaleString("en-US")} CZ$)`,
    metadata: withRider({
      titleCode: "notif.transfer.watchlistAuction.title",
      titleParams: {},
      messageCode: "notif.transfer.watchlistAuction.message",
      messageParams: { riderName, startPrice },
    }, riderId),
  };
}

export function buildWatchlistListedNotification({ riderName, askingPrice, riderId }) {
  return {
    type: "watchlist_rider_listed",
    title: "Watchlisted rider up for sale",
    message: `${riderName} is up for sale (${askingPrice.toLocaleString("en-US")} CZ$)`,
    metadata: withRider({
      titleCode: "notif.transfer.watchlistListed.title",
      titleParams: {},
      messageCode: "notif.transfer.watchlistListed.message",
      messageParams: { riderName, askingPrice },
    }, riderId),
  };
}

export function buildTransferInterestNotification({ riderName, riderId }) {
  return {
    type: "transfer_interest",
    title: "Transfer rumour",
    message: `A manager is eyeing ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.transferInterest.title",
      titleParams: {},
      messageCode: "notif.transfer.transferInterest.message",
      messageParams: { riderName },
    }, riderId),
  };
}

// ─── Transfer-tilbud ────────────────────────────────────────────────────────

export function buildTransferOfferReceivedNotification({ buyerName, amount, riderName, riderId }) {
  return {
    type: "transfer_offer_received",
    title: "New transfer offer received",
    message: `${buyerName} offers ${amount.toLocaleString("en-US")} CZ$ for ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.offerReceived.title",
      titleParams: {},
      messageCode: "notif.transfer.offerReceived.message",
      messageParams: { buyerName, amount, riderName },
    }, riderId),
  };
}

export function buildTransferNewBidNotification({ buyerName, amount, riderName, riderId }) {
  return {
    type: "transfer_offer_received",
    title: "New bid received",
    message: `${buyerName} now bids ${amount.toLocaleString("en-US")} CZ$ for ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.newBid.title",
      titleParams: {},
      messageCode: "notif.transfer.newBid.message",
      messageParams: { buyerName, amount, riderName },
    }, riderId),
  };
}

export function buildTransferOfferAcceptedNotification({ sellerName, riderName, price, riderId }) {
  return {
    type: "transfer_offer_accepted",
    title: "Offer accepted: confirm the deal",
    message: `${sellerName} accepted your offer on ${riderName} for ${price.toLocaleString("en-US")} CZ$. Confirm to complete the deal.`,
    metadata: withRider({
      titleCode: "notif.transfer.offerAccepted.title",
      titleParams: {},
      messageCode: "notif.transfer.offerAccepted.message",
      messageParams: { sellerName, riderName, price },
    }, riderId),
  };
}

export function buildTransferCounterAcceptedNotification({ buyerName, riderName, price, riderId }) {
  return {
    type: "transfer_offer_accepted",
    title: "Counter-offer accepted: confirm the deal",
    message: `${buyerName} accepted your counter-offer on ${riderName} for ${price.toLocaleString("en-US")} CZ$. Confirm to complete the deal.`,
    metadata: withRider({
      titleCode: "notif.transfer.counterAccepted.title",
      titleParams: {},
      messageCode: "notif.transfer.counterAccepted.message",
      messageParams: { buyerName, riderName, price },
    }, riderId),
  };
}

export function buildTransferOfferRejectedNotification({ riderName, riderId }) {
  return {
    type: "transfer_offer_rejected",
    title: "Transfer offer rejected",
    message: `Your offer on ${riderName} was rejected`,
    metadata: withRider({
      titleCode: "notif.transfer.offerRejected.title",
      titleParams: {},
      messageCode: "notif.transfer.offerRejected.message",
      messageParams: { riderName },
    }, riderId),
  };
}

export function buildTransferCounterNotification({ counterName, riderName, counterAmount, riderId }) {
  return {
    type: "transfer_counter",
    title: "Counter-offer received",
    message: `${counterName} sends a counter-offer on ${riderName}: ${counterAmount.toLocaleString("en-US")} CZ$`,
    metadata: withRider({
      titleCode: "notif.transfer.counter.title",
      titleParams: {},
      messageCode: "notif.transfer.counter.message",
      messageParams: { counterName, riderName, counterAmount },
    }, riderId),
  };
}

export function buildTransferCancelledNotification({ actorName, riderName, riderId }) {
  return {
    type: "transfer_offer_rejected",
    title: "Transfer cancelled",
    message: `${actorName} pulled out of the deal on ${riderName}.`,
    metadata: withRider({
      titleCode: "notif.transfer.cancelled.title",
      titleParams: {},
      messageCode: "notif.transfer.cancelled.message",
      messageParams: { actorName, riderName },
    }, riderId),
  };
}

export function buildTransferWithdrawnNotification({ buyerName, riderName, riderId }) {
  return {
    type: "transfer_offer_withdrawn",
    title: "Offer withdrawn",
    message: `${buyerName} withdrew their offer on ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.withdrawn.title",
      titleParams: {},
      messageCode: "notif.transfer.withdrawn.message",
      messageParams: { buyerName, riderName },
    }, riderId),
  };
}

export function buildTransferOnAuctionCancelledNotification({ riderName, riderId }) {
  return {
    type: "transfer_offer_rejected",
    title: "Transfer cancelled",
    message: `${riderName} went to an active auction. The deal was cancelled. Bid on the auction instead.`,
    metadata: withRider({
      titleCode: "notif.transfer.onAuctionCancelled.title",
      titleParams: {},
      messageCode: "notif.transfer.onAuctionCancelled.message",
      messageParams: { riderName },
    }, riderId),
  };
}

export function buildTransferStaleCancelledNotification({ riderName, riderId }) {
  return {
    type: "transfer_offer_rejected",
    title: "Transfer cancelled",
    message: `${riderName} could not be completed because the rider changed status during confirmation.`,
    metadata: withRider({
      titleCode: "notif.transfer.staleCancelled.title",
      titleParams: {},
      messageCode: "notif.transfer.staleCancelled.message",
      messageParams: { riderName },
    }, riderId),
  };
}

export function buildTransferCompletedNotification({ riderName, price, deferred, riderId }) {
  return {
    type: "transfer_offer_accepted",
    title: "Transfer completed!",
    message: deferred
      ? `${riderName} was traded for ${price.toLocaleString("en-US")} CZ$ — they change teams once their ongoing stage race finishes.`
      : `${riderName} switches teams for ${price.toLocaleString("en-US")} CZ$`,
    metadata: withRider({
      titleCode: "notif.transfer.completed.title",
      titleParams: {},
      messageCode: deferred ? "notif.transfer.completed.messageDeferred" : "notif.transfer.completed.message",
      messageParams: { riderName, price },
    }, riderId),
  };
}

// ─── Byttehandel ────────────────────────────────────────────────────────────
//
// cashSuffix er præ-formateret retningskopi ("+X CZ$ from us" / "· +X CZ$").
// Byttehandel-cash er svær at param'ificere rent pga. fortegn+retning, så vi
// sender en lokaliseret cashKey + cashAmount og lader frontend komponere. For
// enkelhed (og fordi cash-delta er sjælden) sender vi en færdig EN-cash-suffix
// som param og en dansk pendant i locale-filen via cashCode.

export function buildSwapProposedNotification({ proposerName, offeredName, requestedName, cash, riderId }) {
  const cashSuffix = cash ? ` (${cash > 0 ? "+" : ""}${cash.toLocaleString("en-US")} CZ$ from us)` : "";
  return {
    type: "transfer_offer_received",
    title: "Swap proposed",
    message: `${proposerName} offers ${offeredName} for ${requestedName}${cashSuffix}`,
    metadata: withRider({
      titleCode: "notif.transfer.swapProposed.title",
      titleParams: {},
      messageCode: cash ? "notif.transfer.swapProposed.messageCash" : "notif.transfer.swapProposed.message",
      messageParams: { proposerName, offeredName, requestedName, cash: cash || 0, cashSign: cash > 0 ? "+" : "" },
    }, riderId),
  };
}

export function buildSwapAcceptedNotification({ accepterName, offeredName, requestedName, cash }) {
  const cashSuffix = cash ? ` · ${cash > 0 ? "+" : ""}${cash.toLocaleString("en-US")} CZ$` : "";
  return {
    type: "transfer_offer_accepted",
    title: "Swap accepted: confirm the deal",
    message: `${accepterName} accepted the swap: ${offeredName} ⇄ ${requestedName}${cashSuffix}. Confirm to complete.`,
    metadata: {
      titleCode: "notif.transfer.swapAccepted.title",
      titleParams: {},
      messageCode: cash ? "notif.transfer.swapAccepted.messageCash" : "notif.transfer.swapAccepted.message",
      messageParams: { accepterName, offeredName, requestedName, cash: cash || 0, cashSign: cash > 0 ? "+" : "" },
    },
  };
}

export function buildSwapRejectedNotification({ rejecterName }) {
  return {
    type: "transfer_offer_rejected",
    title: "Swap rejected",
    message: `${rejecterName} declined your swap offer`,
    metadata: {
      titleCode: "notif.transfer.swapRejected.title",
      titleParams: {},
      messageCode: "notif.transfer.swapRejected.message",
      messageParams: { rejecterName },
    },
  };
}

export function buildSwapCounterNotification({ counterName, offeredName, requestedName, counterCash }) {
  return {
    type: "transfer_counter",
    title: "Counter-offer on swap",
    message: `${counterName} sends a counter-offer: ${offeredName} ⇄ ${requestedName} (${counterCash > 0 ? "+" : ""}${counterCash.toLocaleString("en-US")} CZ$)`,
    metadata: {
      titleCode: "notif.transfer.swapCounter.title",
      titleParams: {},
      messageCode: "notif.transfer.swapCounter.message",
      messageParams: { counterName, offeredName, requestedName, counterCash, cashSign: counterCash > 0 ? "+" : "" },
    },
  };
}

export function buildSwapCounterAcceptedNotification({ accepterName }) {
  return {
    type: "transfer_offer_accepted",
    title: "Counter-offer accepted: confirm the deal",
    message: `${accepterName} accepted your counter-offer. Confirm to complete the swap.`,
    metadata: {
      titleCode: "notif.transfer.swapCounterAccepted.title",
      titleParams: {},
      messageCode: "notif.transfer.swapCounterAccepted.message",
      messageParams: { accepterName },
    },
  };
}

export function buildSwapCompletedNotification({ offeredName, requestedName, deferred }) {
  return {
    type: "transfer_offer_accepted",
    title: "Swap completed!",
    message: deferred
      ? `${offeredName} ⇄ ${requestedName} swapped. The riders change teams once their ongoing stage race finishes.`
      : `${offeredName} ⇄ ${requestedName} have now switched`,
    metadata: {
      titleCode: "notif.transfer.swapCompleted.title",
      titleParams: {},
      messageCode: deferred ? "notif.transfer.swapCompleted.messageDeferred" : "notif.transfer.swapCompleted.message",
      messageParams: { offeredName, requestedName },
    },
  };
}

export function buildSwapPulledOutNotification({ actorName }) {
  return {
    type: "transfer_offer_rejected",
    title: "Swap cancelled",
    message: `${actorName} pulled out of the swap.`,
    metadata: {
      titleCode: "notif.transfer.swapPulledOut.title",
      titleParams: {},
      messageCode: "notif.transfer.swapPulledOut.message",
      messageParams: { actorName },
    },
  };
}

export function buildSwapCancelledStaleNotification({ riderName }) {
  return {
    type: "transfer_offer_rejected",
    title: "Swap cancelled",
    message: `${riderName} changed status during confirmation.`,
    metadata: {
      titleCode: "notif.transfer.swapCancelledStale.title",
      titleParams: {},
      messageCode: "notif.transfer.swapCancelledStale.message",
      messageParams: { riderName },
    },
  };
}

// ─── Leje (loan) ────────────────────────────────────────────────────────────

export function buildLoanProposalNotification({ proposerName, riderName, seasonFrom, seasonTo, fee, buyOption, riderId }) {
  const seasonsSame = seasonFrom === seasonTo;
  const buyStr = buyOption ? ` · buy option ${buyOption.toLocaleString("en-US")} CZ$` : "";
  const seasonStr = seasonsSame ? `season ${seasonFrom}` : `season ${seasonFrom}–${seasonTo}`;
  return {
    type: "transfer_offer_received",
    title: "Loan proposal received",
    message: `${proposerName} wants to loan ${riderName} (${seasonStr}, ${fee.toLocaleString("en-US")} CZ$/season${buyStr})`,
    metadata: withRider({
      titleCode: "notif.transfer.loanProposal.title",
      titleParams: {},
      messageCode: buyOption
        ? (seasonsSame ? "notif.transfer.loanProposal.messageBuySingle" : "notif.transfer.loanProposal.messageBuyRange")
        : (seasonsSame ? "notif.transfer.loanProposal.messageSingle" : "notif.transfer.loanProposal.messageRange"),
      messageParams: { proposerName, riderName, seasonFrom, seasonTo, fee, buyOption: buyOption || 0 },
    }, riderId),
  };
}

export function buildLoanActivatedNotification({ lenderName, riderName, riderId }) {
  return {
    type: "transfer_offer_accepted",
    title: "Loan activated",
    message: `${lenderName} accepted your loan request for ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.loanActivated.title",
      titleParams: {},
      messageCode: "notif.transfer.loanActivated.message",
      messageParams: { lenderName, riderName },
    }, riderId),
  };
}

export function buildLoanRejectedNotification({ lenderName, riderName, riderId }) {
  return {
    type: "transfer_offer_rejected",
    title: "Loan request rejected",
    message: `${lenderName} declined your loan proposal for ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.loanRejected.title",
      titleParams: {},
      messageCode: "notif.transfer.loanRejected.message",
      messageParams: { lenderName, riderName },
    }, riderId),
  };
}

export function buildLoanCancelledNotification({ actorName, riderName, riderId }) {
  return {
    type: "transfer_offer_rejected",
    title: "Loan agreement cancelled",
    message: `${actorName} cancelled the loan agreement for ${riderName}`,
    metadata: withRider({
      titleCode: "notif.transfer.loanCancelled.title",
      titleParams: {},
      messageCode: "notif.transfer.loanCancelled.message",
      messageParams: { actorName, riderName },
    }, riderId),
  };
}

export function buildLoanBuyoutNotification({ buyerName, riderName, price }) {
  return {
    type: "transfer_offer_accepted",
    title: "Buy option exercised",
    message: `${buyerName} exercised the buy option on ${riderName} for ${price.toLocaleString("en-US")} CZ$`,
    metadata: {
      titleCode: "notif.transfer.loanBuyout.title",
      titleParams: {},
      messageCode: "notif.transfer.loanBuyout.message",
      messageParams: { buyerName, riderName, price },
    },
  };
}

// ─── Admin-annulleringer ────────────────────────────────────────────────────
//
// `reason` er valgfri admin-fritekst; den kan være dansk, men den er admin-
// genereret indhold (ikke en oversættelig streng), så vi injicerer den som
// param i en lokaliseret skabelon.

function reasonSuffix(reason) {
  return reason ? `: ${reason}` : ".";
}

export function buildAdminTransferCancelledNotification({ riderName, reason = "" }) {
  return {
    type: "transfer_offer_rejected",
    title: "Deal cancelled by admin",
    message: `The deal on ${riderName} was cancelled by an admin${reasonSuffix(reason)}`,
    metadata: {
      titleCode: "notif.transfer.adminTransferCancelled.title",
      titleParams: {},
      messageCode: reason ? "notif.transfer.adminTransferCancelled.messageReason" : "notif.transfer.adminTransferCancelled.message",
      messageParams: { riderName, reason },
    },
  };
}

export function buildAdminSwapCancelledNotification({ offeredName, requestedName, reason = "" }) {
  return {
    type: "transfer_offer_rejected",
    title: "Swap cancelled by admin",
    message: `The swap ${offeredName} ⇄ ${requestedName} was cancelled by an admin${reasonSuffix(reason)}`,
    metadata: {
      titleCode: "notif.transfer.adminSwapCancelled.title",
      titleParams: {},
      messageCode: reason ? "notif.transfer.adminSwapCancelled.messageReason" : "notif.transfer.adminSwapCancelled.message",
      messageParams: { offeredName, requestedName, reason },
    },
  };
}

export function buildAdminLoanCancelledNotification({ riderName, reason = "", refundedFee = 0 }) {
  const refundSuffix = refundedFee > 0
    ? ` The loan fee (${refundedFee.toLocaleString("en-US")} CZ$) has been refunded.`
    : "";
  const base = reason ? "messageReason" : "message";
  const messageCode = refundedFee > 0
    ? `notif.transfer.adminLoanCancelled.${base}Refund`
    : `notif.transfer.adminLoanCancelled.${base}`;
  return {
    type: "transfer_offer_rejected",
    title: "Loan agreement cancelled by admin",
    message: `The loan agreement on ${riderName} was cancelled by an admin${reasonSuffix(reason)}${refundSuffix}`,
    metadata: {
      titleCode: "notif.transfer.adminLoanCancelled.title",
      titleParams: {},
      messageCode,
      messageParams: { riderName, reason, refundedFee: refundedFee || 0 },
    },
  };
}
