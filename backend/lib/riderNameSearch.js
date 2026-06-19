// #47: token-set navnesøgning for ryttere (server-side, GET /api/riders m.fl.).
// Spejler frontend/src/lib/riderNameSearch.js — to runtimes, samme kontrakt.
//
// Tidligere matchede søgningen kun `firstname.ilike.%q% OR lastname.ilike.%q%`,
// så "Tadej Pog" (fornavn + start af efternavn) gav 0 hits. Token-set kræver at
// HVERT whitespace-token matcher fornavn ELLER efternavn; kædede .or() AND'es af
// PostgREST.
//
// Security (or-filter-injektion #1338): q interpoleres råt ind i .or()-strengen,
// så hvert token strippes for PostgREST-or-streng-strukturtegn ( , ( ) ) og
// LIKE/ILIKE-wildcards ( % _ \ * ). Navne indeholder dem ikke.

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

export function applyNameSearch(query, q) {
  for (const token of nameSearchTokens(q)) {
    query = query.or(`firstname.ilike.%${token}%,lastname.ilike.%${token}%`);
  }
  return query;
}
