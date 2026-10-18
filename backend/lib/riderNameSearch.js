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

// #5941: samme kontrakt som frontend/src/lib/riderNameSearch.js. Hvert token skal
// vaere PRAEFIKS af et ord i fornavn eller efternavn (accent- og case-ufoelsomt),
// aldrig spredte bogstaver eller midt-i-ord ("ong" finder ikke "De Jong").
// unaccent er ikke installeret i prod, saa accenter udvides til tegnklasser og
// matches med PostgREST imatch (~*); \m = Postgres-ARE "ord-start".
// 'aa'/'oe'-tegnene staar som \uXXXX (diakritik-data, ikke UI-tekst).
const ACCENT_CLASSES = {
  a: "a\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u0101\u0103\u0105",
  c: "c\u00e7\u0107\u0109\u010b\u010d",
  d: "d\u010f\u0111",
  e: "e\u00e8\u00e9\u00ea\u00eb\u0113\u0115\u0117\u0119\u011b",
  g: "g\u011d\u011f\u0121\u0123",
  i: "i\u00ec\u00ed\u00ee\u00ef\u0129\u012b\u012d\u012f\u0131",
  l: "l\u013a\u013c\u013e\u0140\u0142",
  n: "n\u00f1\u0144\u0146\u0148\u0149",
  o: "o\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u014d\u014f\u0151",
  r: "r\u0155\u0157\u0159",
  s: "s\u015b\u015d\u015f\u0161",
  t: "t\u0163\u0165\u0167",
  u: "u\u00f9\u00fa\u00fb\u00fc\u0169\u016b\u016d\u016f\u0171\u0173",
  y: "y\u00fd\u00ff\u0177",
  z: "z\u017a\u017c\u017e",
};

const REGEX_META_CHARS = /[.^$*+?()[\]{}|\\]/;

function escapeRegexChar(ch) {
  return REGEX_META_CHARS.test(ch) ? `\\${ch}` : ch;
}

export function buildAccentInsensitivePattern(token, { wordStart = false } = {}) {
  const body = Array.from(String(token ?? "").toLowerCase())
    .map((ch) => (ACCENT_CLASSES[ch] ? `[${ACCENT_CLASSES[ch]}]` : escapeRegexChar(ch)))
    .join("");
  return wordStart ? `\\m${body}` : body;
}

export function applyNameSearch(query, q) {
  for (const token of nameSearchTokens(q)) {
    const pattern = buildAccentInsensitivePattern(token, { wordStart: true });
    query = query.or(`firstname.imatch.${pattern},lastname.imatch.${pattern}`);
  }
  return query;
}
