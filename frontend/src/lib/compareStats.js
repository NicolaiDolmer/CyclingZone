// Delt tie-break-logik for sammenlignings-værktøjer (#5316). Bruges af
// RiderComparePage's stat-rækker (rating/evner/alder/værdi/løn) til at afgøre
// hvem der skal fremhæves som "bedst" for et givet felt.
//
// Ren .js uden JSX-imports, så `node --test` kan loade den direkte.
//
// Før #5316 brugte kaldersiden `Array.prototype.reduce` uden at håndtere
// lighed eksplicit: reduce starter med det FØRSTE element som akkumulator og
// erstatter det kun ved streng ulighed — så ved uafgjort (alle sammenlignede
// har samme værdi) forblev det første element "vinderen", selvom ingen reelt
// var bedre. Denne funktion behandler et flertydigt/uafgjort resultat som
// "ingen vinder" (returnerer null) i stedet.
export function getBestId(items, statKey, { higherIsBetter = true } = {}) {
  if (!items || items.length < 2) return null;

  const values = items.map((item) => item?.[statKey] || 0);
  const target = higherIsBetter ? Math.max(...values) : Math.min(...values);
  const leaders = values.filter((v) => v === target).length;
  if (leaders !== 1) return null; // uafgjort (eller ingen data) — ingen fremhævning

  const index = values.findIndex((v) => v === target);
  return items[index]?.id ?? null;
}
