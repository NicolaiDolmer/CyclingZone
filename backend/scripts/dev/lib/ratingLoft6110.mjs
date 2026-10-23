// #6110 byggetrin 1b: grundtalent (1-99) -> blødt loft i den naturlige rolle, i ratingskala.
//
// S1 (ejer 23/10): potentiale-tallet = den højeste rating rytteren kan nå i sin
// naturlige rolle. Remappen (lib/remap3564.mjs) giver et talent-tal, ikke en
// rating, så dette modul oversætter. Monoton og glat: højere talent giver
// aldrig lavere loft. Formens parametre (lo, hi, gamma) er PRIVATE (hard rule 17)
// og fittes af potentialEstimateHarness6110.mjs (FIT_LOFT=1).

export function ratingLoft(talent99, { lo, hi, gamma }) {
  const t = Math.max(0, Math.min(1, (Number(talent99) - 1) / 98));
  return lo + (hi - lo) * Math.pow(t, gamma);
}

// Andel af ryttere, hvis nuværende rating allerede ligger over deres loft.
export function shareOverLoft(rows, loftParams) {
  if (!rows.length) return 0;
  let over = 0;
  for (const r of rows) if (r.rating > ratingLoft(r.talent, loftParams)) over++;
  return over / rows.length;
}

// Grid-søgning: find (lo, gamma) for et fast hi, så andelen over loftet rammer
// targetShare, og andelen med loft >= highBar ligger tættest på targetHighShare.
export function fitLoft(rows, { hi, targetShare, highBar, targetHighShare, loGrid, gammaGrid }) {
  let best = null;
  for (const lo of loGrid) {
    for (const gamma of gammaGrid) {
      const p = { lo, hi, gamma };
      const over = shareOverLoft(rows, p);
      const high = rows.filter((r) => ratingLoft(r.talent, p) >= highBar).length / rows.length;
      const cost = Math.abs(over - targetShare) * 4 + Math.abs(high - targetHighShare);
      if (!best || cost < best.cost) best = { params: p, over, high, cost };
    }
  }
  return best;
}
