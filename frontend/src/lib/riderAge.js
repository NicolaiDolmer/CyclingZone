// Fælles alders-helpers for ryttere. U23/U25-badge-tieren afledes RENT fra
// `birthdate` (single source of truth), så den lagrede `is_u25`-flag og den
// beregnede alder ikke kan divergere. Den lagrede flag bevares stadig til
// filtre/queries (se useRiderFilters), men aldrig som badge-kilde.
//
// Badge-beslutning (#837, ejer 31. maj): vis kun den yngste gældende —
//   alder < 23 → "u23"
//   alder 23–24 → "u25"
//   alder ≥ 25 → ingen alders-badge (aldrig begge på samme rytter).

// Alder i hele år baseret på fødselsår (samme formel som rytter-filtrene).
export function getRiderAge(birthdate, now = new Date()) {
  if (!birthdate) return null;
  return now.getFullYear() - new Date(birthdate).getFullYear();
}

// U23-grænse som ÉN kilde til sandhed (#42): en rytter er U23 ved alder < 23
// (dvs. ≤22 år) — præcis samme grænse som u23-badge nedenfor. Bruges af
// rytter-filtrene (useRiderFilters) så filter + badge aldrig divergerer; en
// 23-årig bærer u25-badge og må derfor ikke matche U23. Returnerer false ved
// manglende fødselsdato (kan ikke bekræftes som U23).
export function isU23(birthdate, now = new Date()) {
  const age = getRiderAge(birthdate, now);
  return age != null && age < 23;
}

// Returnér badge-nøglen for rytterens alders-tier, eller null. Nøglen er en
// gyldig RiderBadges-key ("u23"/"u25"), så kaldersiden kan sætte den direkte
// ind i badges-arrayet: badges={[ageBadgeKey(rider), ...]}.
export function ageBadgeKey(rider, now = new Date()) {
  const age = getRiderAge(rider?.birthdate, now);
  if (age == null) return null;
  if (age < 23) return "u23";
  if (age < 25) return "u25";
  return null;
}
