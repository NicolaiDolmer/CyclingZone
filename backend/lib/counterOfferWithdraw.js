// #6463 · Sælgeren trækker sit afgivne modbud tilbage på et transfertilbud.
//
// Baggrund: et modbud (status "countered") havde intet udløb og ingen
// annullér-vej for sælgeren. Køberen kunne vente en sæson eller to og så
// acceptere modbuddet til en pris, der ikke længere passede til rytterens
// værdi. Sælgeren så ingen knap på sit eget modbud.
//
// Løsning: sælgeren kan trække modbuddet tilbage, så længe det stadig står
// åbent. Tilbuddet lukkes med den eksisterende status "withdrawn" (samme
// afsluttede tilstand som når køberen trækker sit bud, kan arkiveres) — ingen
// migration. Køberen får en indbakke-besked. Ingen penge flyttes: et modbud
// har aldrig reserveret eller trukket beløb.
//
// Race-sikkerhed: overgangen er en betinget UPDATE (kun hvis rækken STADIG er
// "countered" og sælgeren stadig er sælger). Har køberen nået at acceptere i
// mellemtiden, rammer opdateringen 0 rækker, og tilbagetrækningen afvises. Den
// modsatte retning (accept efter tilbagetrækning) dækkes af
// claimCounterForAccept, som accept_counter-grenen i api.js bruger.

export const COUNTER_OPEN_STATUS = "countered";
export const COUNTER_WITHDRAWN_STATUS = "withdrawn";

const NOT_OPEN = Object.freeze({
  status: 409,
  error: "The counter offer is no longer open",
  errorCode: "counter_offer_not_open",
});

// Ren validering — ingen I/O. Returnerer null hvis sælgeren må trække
// modbuddet tilbage, ellers { status, error, errorCode }.
export function getCounterWithdrawIssue(offer, teamId) {
  if (!offer) {
    return { status: 404, error: "Offer not found", errorCode: "offer_not_found" };
  }
  if (!teamId || offer.seller_team_id !== teamId) {
    return {
      status: 403,
      error: "Only the seller can withdraw their counter offer",
      errorCode: "counter_withdraw_not_seller",
    };
  }
  if (offer.status !== COUNTER_OPEN_STATUS) return { ...NOT_OPEN };
  return null;
}

// Indbakke-besked til køberen. Samme kontrakt som builderne i
// transferNotifications.js: EN-fallback i title/message, i18n-koder i
// metadata (notif.transfer.counterWithdrawn.* i backendMessages.json).
// Genbruger notifikations-typen "transfer_offer_withdrawn", så eksisterende
// type-filtre og ikoner virker uændret.
export function buildCounterOfferWithdrawnNotification({ sellerName, riderName, riderId }) {
  const metadata = {
    titleCode: "notif.transfer.counterWithdrawn.title",
    titleParams: {},
    messageCode: "notif.transfer.counterWithdrawn.message",
    messageParams: { sellerName, riderName },
  };
  return {
    type: "transfer_offer_withdrawn",
    title: "Counter offer withdrawn",
    message: `${sellerName} withdrew their counter offer on ${riderName}. You can make a new offer.`,
    metadata: riderId != null ? { riderId, ...metadata } : metadata,
  };
}

// Udfører tilbagetrækningen. Returnerer { ok: true } eller
// { ok: false, status, error, errorCode }. Rører kun transfer_offers-rækken.
export async function withdrawCounterOffer({ supabase, offer, teamId, now = new Date() }) {
  const issue = getCounterWithdrawIssue(offer, teamId);
  if (issue) return { ok: false, ...issue };

  const { data, error } = await supabase
    .from("transfer_offers")
    .update({ status: COUNTER_WITHDRAWN_STATUS, updated_at: now.toISOString() })
    .eq("id", offer.id)
    .eq("seller_team_id", teamId)
    .eq("status", COUNTER_OPEN_STATUS)
    .select("id");

  if (error) {
    console.error("[counterOfferWithdraw] update failed", { offerId: offer.id, error: error.message });
    return {
      ok: false,
      status: 500,
      error: "Could not withdraw the counter offer",
      errorCode: "counter_withdraw_failed",
    };
  }
  if (!Array.isArray(data) || data.length === 0) return { ok: false, ...NOT_OPEN };
  return { ok: true };
}

// Race-vagt for køberens accept af et modbud: flytter kun rækken videre hvis
// den STADIG er "countered". Har sælgeren trukket modbuddet tilbage efter at
// køberens side læste tilbuddet, rammer opdateringen 0 rækker og accepten
// afvises med counter_offer_not_open i stedet for at genoplive en gammel pris.
export async function claimCounterForAccept({ supabase, offerId, patch }) {
  const { data, error } = await supabase
    .from("transfer_offers")
    .update(patch)
    .eq("id", offerId)
    .eq("status", COUNTER_OPEN_STATUS)
    .select("id");

  if (error) {
    console.error("[counterOfferWithdraw] accept claim failed", { offerId, error: error.message });
    return {
      ok: false,
      status: 500,
      error: "Could not accept the counter offer",
      errorCode: "counter_accept_failed",
    };
  }
  if (!Array.isArray(data) || data.length === 0) return { ok: false, ...NOT_OPEN };
  return { ok: true };
}
