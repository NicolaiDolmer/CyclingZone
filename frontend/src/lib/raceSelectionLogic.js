// #1307: ren udtagelses-state-logik (testbar uden React). Spejler backendens
// valideringskoder så fejl kan vises FØR kaldet.

export function toggleRider(state, riderId, max) {
  const has = state.riderIds.includes(riderId);
  if (!has && state.riderIds.length >= max) return state;
  const riderIds = has ? state.riderIds.filter((id) => id !== riderId) : [...state.riderIds, riderId];
  return {
    riderIds,
    captainId: has && state.captainId === riderId ? null : state.captainId,
    sprintCaptainId: has && state.sprintCaptainId === riderId ? null : state.sprintCaptainId,
    hunterId: has && state.hunterId === riderId ? null : state.hunterId,
  };
}

// #2028: vælg en fallback-kaptajn EFTER FORTJENESTE når manageren ikke selv har sat en.
// Tidligere valgte board'et `ids[0]` (første rytter i arrayet) → en vilkårlig, ofte
// svagere rytter blev gemt som kaptajn uden intention (fx GC-lederen blev forbigået).
// Nu: højest løb-suitability blandt de udtagne, ekskl. sprint/jæger så roller forbliver
// distinkte; kun hvis ALLE kandidater allerede har en anden rolle falder vi tilbage til
// hele feltet. Tiebreak: rider_id asc (deterministisk). Tom trup → null.
// `suitabilityOf(id)` → 0-100 (eller null/undefined når ukendt → behandles som lavest).
// Spejler race-enginens egen GC-fallback (raceAutopick.resolveCaptain: stærkeste rytter).
export function pickFallbackCaptain({ riderIds = [], sprintId = null, hunterId = null, suitabilityOf }) {
  if (!riderIds.length) return null;
  const eligible = riderIds.filter((id) => id !== sprintId && id !== hunterId);
  const pool = eligible.length ? eligible : riderIds;
  let best = null;
  let bestScore = -Infinity;
  for (const id of pool) {
    const raw = suitabilityOf ? Number(suitabilityOf(id)) : NaN;
    const score = Number.isFinite(raw) ? raw : -1;
    if (score > bestScore || (score === bestScore && best != null && String(id) < String(best))) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

// Spejler backend raceSelection.validateSelection (#1906 for `requireFull=true`).
// `required` = løbets pladsantal (size.max). To distinkte fejl så UI kan guide:
//   selection_insufficient_riders → holdet har for få raske ryttere (afmeld / hent fri-agenter)
//   selection_wrong_size          → holdet KAN fylde, men har valgt for få/mange
//
// `requireFull` (default true, #1906 "hård fuld opstilling"): en FØRSTEGANGS-udtagelse
// via dette panel skal nå size.max før Gem aktiveres — det guider nye managere til en
// komplet trup i stedet for at lade dem gemme 1-2 ryttere ved et uheld. #2637: backendens
// egen validateSelection tillader en DELVIS trup for ethvert efterfølgende gem (ejer
// 28/6, afløser #1906) — kun over feltstørrelsen afvises. Panelet SKAL derfor tillade en
// delvis trup igen når der allerede FINDES en gemt/auto-udtaget udtagelse (fx en skadet
// rytter der fjernes fra en allerede committet etapeløbs-trup); kalderen sætter
// `requireFull: !data.selection`.
// #4175 (spiller-rapport 24/8, tre managere uafhængigt): den gamle udgave gjorde
// `selection_insufficient_riders` til en BLOKERENDE fejl — kunne holdet ikke stille
// size.max ryttere, kunne udtagelsen slet ikke gemmes. Det ramte præcis de dage hvor
// kalenderen kræver flere ryttere end truppen har (#4174), altså der hvor manageren ER
// nødt til at møde op med et halvt hold. Resultatet var at han i stedet mødte op med
// NUL. knud_r_flink: "Er der en der kan teste om de kan gemme et ikke fuldt hold til et
// løb? Jeg kan umiddelbart ikke." · egomadsen: "skal lave en sniger for overhovedet at
// gemme den slags".
//
// Backendens egen validateSelection har tilladt delvis trup siden 28/6 (ejer-beslutning,
// afløser #1906) og afviser KUN over feltstørrelsen. Klienten var altså strengere end
// serveren uden grund.
//
// Nudgen fra #1906 bevares: kan holdet fylde, men har valgt for få, er det stadig en
// fejl — det er dét `selection_wrong_size` betyder ("holdet KAN fylde", se ovenfor).
// Kan holdet IKKE fylde, er en delvis trup den eneste lovlige handling, og så blokeres
// den ikke længere.
export function validateSelectionClient({ riderIds, captainId, sprintCaptainId, hunterId, size, availableCount, requireFull = true }) {
  const errors = [];
  const required = size.max;
  const kanFyldeTruppen = !Number.isFinite(availableCount) || availableCount >= required;
  if (riderIds.length > required) {
    errors.push("selection_wrong_size");
  } else if (requireFull && kanFyldeTruppen && riderIds.length !== required) {
    errors.push("selection_wrong_size");
  }
  if (!captainId) errors.push("selection_captain_required");
  const roles = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roles).size !== roles.length) errors.push("selection_role_overlap");
  return errors;
}
