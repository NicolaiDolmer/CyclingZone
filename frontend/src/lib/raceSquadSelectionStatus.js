// #3042 — Dashboard-nudgen "Squad selection missing" skal bruge SAMME kontrakt som
// selve løbssiden (RaceSelectionPanel), ikke sin egen tælling.
//
// Før #3042 lavede Dashboard en rå supabase-tælling af race_entries filtreret på
// is_auto_filled=false ("har manageren MANUELT valgt mindst én rytter?"). Det
// matchede ikke løbssidens "fuld trup"-kontrakt (sel.riderIds.length >= size.max,
// hvor riderIds kommer fra ALLE entries — manuelle OG auto-fyldte). Så snart
// raceEntryGenerator top-fyldte en trup fuldt automatisk (0 manuelle entries, men
// size.max auto-fyldte), viste Dashboard "udtagelse mangler" på et løb hvor
// løbssiden viste en fuld trup (Discord-bug 25/7, cybersimon).
//
// Denne funktion er ren og tager PRÆCIS samme payload som GET /api/races/:id/selection
// returnerer (samme endpoint RaceSelectionPanel henter fra) — ingen dublikeret
// tælle-logik, ingen egen size-tabel at holde i sync.
export function isSquadSelectionMissing(selectionResponse) {
  if (!selectionResponse || selectionResponse.enabled === false) return false;
  const selected = selectionResponse.selection?.rider_ids?.length ?? 0;
  const target = selectionResponse.size?.max;
  if (!Number.isFinite(target)) return false; // ukendt kontrakt → ingen falsk nudge
  return selected < target;
}
