// #47: delt token-set navnesøgning for ryttere (frontend-call-sites:
// useRiderFilters/buildSupabaseQuery, RiderComparePage, AdminUsersTab).
//
// Tidligere matchede søgningen kun `firstname.ilike.%q% OR lastname.ilike.%q%`,
// så en query der spændte hen over mellemrummet (fornavn + start af efternavn,
// fx "Tadej Pog") matchede hverken fornavn eller efternavn alene → 0 hits.
//
// Token-set-match: split på whitespace og kræv at HVERT token matcher fornavn
// ELLER efternavn. De kædede .or()-kald AND'es af PostgREST, så "Tadej Pog"
// kræver at både "Tadej" og "Pog" findes (i fornavn eller efternavn).
//
// Security (samme klasse som or-filter-injektion #1338): q interpoleres råt ind
// i .or()-strengen. Hvert token saniteres ved at fjerne PostgREST-or-streng-
// strukturtegn ( , ( ) ) og LIKE/ILIKE-wildcards ( % _ \ * ). Rigtige navne
// indeholder ikke disse tegn, så stripping fjerner enhver injektions- og
// bred-wildcard-risiko uden at tabe søge-funktionalitet.

const UNSAFE_TOKEN_CHARS = /[%_,()\\*]/g;

export function sanitizeNameToken(token) {
  return String(token ?? "").replace(UNSAFE_TOKEN_CHARS, "");
}

export function nameSearchTokens(q) {
  return String(q ?? "")
    .split(/\s+/)
    .map(sanitizeNameToken)
    .filter(Boolean);
}

// Anvender token-set navnesøgning på en supabase-query. Tom / kun-whitespace /
// kun-metakarakter-q tilføjer intet filter (falder tilbage til ingen navne-
// begrænsning).
export function applyNameSearch(query, q) {
  for (const token of nameSearchTokens(q)) {
    query = query.or(`firstname.ilike.%${token}%,lastname.ilike.%${token}%`);
  }
  return query;
}
