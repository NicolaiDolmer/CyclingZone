// #6853 / #5764 (løsning B, ejer-go 24/10): potentialet som ÉT tal overalt.
//
// Problemet: Mit hold, akademiet, rytterprofilen og Scouting-fanen viste ikke
// samme potentiale for samme rytter. Tabellerne og heroen viste prognosen for
// rytterens NATURLIGE rolle, mens Scouting-fanen viste alle otte roller, og
// spillerne så en anden rolle med et højere tal. Løsning B: vis altid den rolle
// med det højeste potentiale, med en lille typeboks ved siden af, så spilleren
// kan se hvilken rolle tallet gælder.
//
// Denne fil er den ENE regel for hvilken rolle der vises. Alle fire flader
// (POST /scouting/estimates, akademiets prognose, GET /riders/:id/scouting-report)
// vælger gennem `displayPotentialBand`, så de ikke kan blive uenige igen.
//
// Reglen: højeste midtpunkt af prognose-båndet (progLo + progHi). Det er samme
// mål som rapportens verdict allerede bruger (bestProg i routes/api.js). Ved
// lighed vinder den naturlige rolle, ellers katalogets rækkefølge.
//
// Ingen ny tal-logik: båndene regnes uændret af buildTypePrognosisBands. Her
// vælges kun HVILKET af de allerede beregnede bånd der vises.
//
// Gaten `potential_single_number` er fjernet (#6853): regelen gælder altid.

function hasBand(band) {
  return band != null && Number.isFinite(band.progLo) && Number.isFinite(band.progHi);
}

/**
 * Båndet med det højeste potentiale (midtpunkt). Ved lighed: den naturlige
 * rolle, ellers første i listen. null hvis intet bånd kan beregnes.
 * @param {{key:string, progLo:number|null, progHi:number|null}[]} bands
 * @param {string|null|undefined} primaryType
 */
export function bestPotentialBand(bands, primaryType) {
  let best = null;
  for (const band of bands ?? []) {
    if (!hasBand(band)) continue;
    if (best == null) { best = band; continue; }
    const sum = band.progLo + band.progHi;
    const bestSum = best.progLo + best.progHi;
    if (sum > bestSum || (sum === bestSum && band.key === primaryType && best.key !== primaryType)) best = band;
  }
  return best;
}

/** Det bånd fladerne viser: den rolle med det højeste potentiale. */
export function displayPotentialBand(bands, primaryType) {
  return bestPotentialBand(bands, primaryType);
}
