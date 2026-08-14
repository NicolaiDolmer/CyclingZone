// #3597 · Ét sted der afgør om "Forlæng kontrakt" må klikkes.
//
// Baggrund (tre runder af Sentry CYCLINGZONE-45, `rider_extend_quote`):
// kontrakt-loftet (#3143, currentSeason + 3) blev håndhævet backend-side, mens
// frontend afledte sin disabled-state af ét eneste signal: "er vi BLEVET afvist?"
// (`extendCapped`, sat udelukkende når et GET mod extend-quote svarede 409).
//
//   #3164/#3169 flyttede afvisnings-tjekket tidligere (til mount).
//   #3186 lukkede race-vinduet mens tjekket var i flight.
//
// Begge runder beholdt det AFVISNINGS-afledte signal som eneste kilde — så
// enhver state-overgang der efterlader `extendCapped === false` mens der reelt
// ikke er kapacitet tilbage, åbner hullet igen. Det gjorde en helt almindelig
// succesfuld forlængelse: `confirmExtend()` smider den brugte quote væk
// (`setExtendQuote(null)`) uden at røre `extendCapped`, og mount-tjekket er
// nøglet på `[rider.id]` — som ikke ændrer sig. Var det den SIDSTE tilladte
// sæson der lige blev brugt, stod knappen igen guld og klikbar på en rytter
// hvis næste extend-quote er garanteret 409.
//
// Fix: gate på det POSITIVE kapacitets-tal backend allerede sender med i hver
// eneste gren af extend-quote OG extend-contract (`extensionCap`,
// contractExtensionCapInfo i backend/lib/contractSeed.js). `remainingExtensions
// === 0` betyder "ingen kapacitet" uanset om vi nogensinde er blevet afvist.
// Afvisnings-signalet beholdes som fallback for de svar der ikke bærer
// extensionCap med.
//
// Frontend gentager IKKE loft-formlen ("+3") — den lever kun backend-side.
// Herinde læses kun tal serveren har sendt.

/**
 * Afgør om forlæng-handlingen er spærret, og hvilken sæson forklaringen skal
 * nævne.
 *
 * @param {object} [input]
 * @param {boolean} [input.capped]     Har et svar BEKRÆFTET loftet (409
 *                                     `contract_extension_cap_reached`)?
 * @param {object|null} [input.capInfo] `extensionCap` fra seneste extend-quote-
 *                                     eller extend-contract-svar
 *                                     ({ maxSeason, maxExtensions,
 *                                     usedExtensions, remainingExtensions }).
 * @param {number|null} [input.capSeason] `errorParams.maxSeason` fra en 409.
 * @returns {{ atCap: boolean, season: number|null }}
 */
export function extendCapGate({ capped = false, capInfo = null, capSeason = null } = {}) {
  const remaining = capInfo?.remainingExtensions;
  // typeof-guarden gør et manglende/null/ugyldigt felt til "ved ikke" — ikke
  // til "0 tilbage". Uden den ville `Number(null) === 0` spærre knappen
  // permanent på ethvert svar der ikke bar extensionCap med (ældre backend,
  // 403/409-grene uden tælleren), altså bytte en afvisning ud med en død knap.
  const outOfCapacity = typeof remaining === "number" && Number.isFinite(remaining) && remaining <= 0;

  const season = Number(capSeason ?? capInfo?.maxSeason);

  return {
    atCap: Boolean(capped) || outOfCapacity,
    season: Number.isFinite(season) ? season : null,
  };
}
