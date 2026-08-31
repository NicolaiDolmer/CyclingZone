// Det beløb et transfertilbud FAKTISK afregnes til (#4156).
//
// SSOT er backend: `getTransferPrice` i backend/lib/transferExecution.js gør
// præcis `offer.counter_amount || offer.offer_amount` — det er den værdi der
// trækkes på købers konto ved confirm. Enhver flade der viser "prisen" skal
// bruge SAMME regel, ellers står der ét tal på skærmen og et andet på kontoen.
//
// BUGGEN denne fil lukker: TransfersPage betingede på `status === "countered"`.
// Når et modbud ACCEPTERES skifter status til awaiting_confirmation/accepted —
// stadig med counter_amount sat — og visningen faldt tilbage til det
// oprindelige (lavere) bud. Spilleren troede han havde købt til sit eget bud.
//
// Hvorfor `||` og ikke `!= null`: 0 er ikke et gyldigt modbud (PATCH-grenen
// `action === "counter" && counter_amount` afviser falsy beløb), og `||` er
// nøjagtig hvad backend gør. En `!= null`-variant ville kunne divergere fra
// afregningen ved counter_amount = 0 — netop den klasse fejl vi retter her.
export function getEffectiveOfferAmount(offer) {
  if (!offer) return null;
  return offer.counter_amount || offer.offer_amount;
}

// Sandt når det beløb getEffectiveOfferAmount viser stammer fra et modbud.
// Bruges til at vælge etiket, så tal og etiket aldrig kan komme i utakt.
export function isCounterAmount(offer) {
  if (!offer) return false;
  return Boolean(offer.counter_amount);
}
