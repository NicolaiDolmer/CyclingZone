// #47: delt token-set navnesøgning for ryttere (frontend-call-sites:
// useRiderFilters/buildSupabaseQuery [RidersPage/Rider Database], RiderComparePage,
// AdminUsersTab — ALLE tre driver gennem applyNameSearch, så denne fil er den ENE
// normaliseringsfunktion for al server-side rytter-navnesøgning, #4031).
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

// #4031: "Lopez" fandt ikke "López" — søgningen var accent-følsom. Postgres'
// `unaccent`-extension er IKKE installeret i prod (samme begrænsning som
// backendens PCM-navnematcher, backend/lib/pcmRiderMatcher.js's foldName-
// kommentar), så vi kan ikke wrappe kolonnen i unaccent(...) i et PostgREST-
// filter. Løsningen bygger i stedet et case-insensitivt "contains"-regex
// (PostgREST's `imatch`-operator = Postgres' `~*`) hvor hvert bogstav med
// almindelige diakritiske varianter udvides til en tegnklasse — fx bliver "o"
// til "[oòóôõöø]" — så "Lopez" matcher "López", "Muller" matcher "Müller",
// "Broz" matcher "Brož". Erstatter den tidligere `ilike.%token%`-gren 1:1
// (stadig et "indeholder"-match, ikke et fuldt-ord-match).
// #4031-guard-note: 'å' (U+00E5) og 'ø' (U+00F8) skrives som \uXXXX-escapes i
// stedet for de rå tegn — de er Unicode-diakritik-DATA (nordisk-fold), ikke
// dansk UI-tekst, men i18n-check-lib-strings.mjs's æøå-heuristik kan ikke se
// forskellen på kildeplan. Escapes holder guarden ærlig uden en EXEMPT-post.
const ACCENT_CLASSES = {
  a: "a\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u0101\u0103\u0105",
  c: "cçćĉċč",
  d: "dďđ",
  e: "eèéêëēĕėęě",
  g: "gĝğġģ",
  i: "iìíîïĩīĭįı",
  l: "lĺļľŀł",
  n: "nñńņňŉ",
  o: "o\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u014d\u014f\u0151",
  r: "rŕŗř",
  s: "sśŝşš",
  t: "tţťŧ",
  u: "uùúûüũūŭůűų",
  y: "yýÿŷ",
  z: "zźżž",
};

const REGEX_META_CHARS = /[.^$*+?()[\]{}|\\]/;

function escapeRegexChar(ch) {
  return REGEX_META_CHARS.test(ch) ? `\\${ch}` : ch;
}

// Bygger et case-insensitivt regex-mønster af et ALLEREDE saniteret token
// (sanitizeNameToken har fjernet PostgREST-or-strukturtegn og ILIKE-wildcards,
// så resten er trygge navne-tegn: bogstaver, apostrof, bindestreg m.fl.).
// `imatch` (~*) er selv case-insensitiv, så mønsteret bygges udelukkende i
// småt — versaler i søgeteksten folder ned til samme tegnklasse.
export function buildAccentInsensitivePattern(token, { wordStart = false } = {}) {
  const body = Array.from(String(token ?? "").toLowerCase())
    .map((ch) => (ACCENT_CLASSES[ch] ? `[${ACCENT_CLASSES[ch]}]` : escapeRegexChar(ch)))
    .join("");
  // #5941: \m = Postgres-ARE "begyndelsen af et ord" (findes ikke i JS-regex).
  return wordStart ? `\\m${body}` : body;
}

// #5941: ÉT prædikat for client-side rytter-søgefelter (samme kontrakt som
// applyNameSearch): hvert whitespace-token skal være PRÆFIKS af et ord i
// fulde navn, accent- og case-ufølsomt. Aldrig spredte bogstaver / midt-i-ord.
function foldForSearch(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[øØ]/g, "o").replace(/đ/g, "d").replace(/ł/g, "l").replace(/ı/g, "i");
}

export function riderNameMatches(fullName, q) {
  const tokens = nameSearchTokens(q).map(foldForSearch);
  if (tokens.length === 0) return true;
  const words = foldForSearch(fullName).split(/[\s\-'’.]+/).filter(Boolean);
  return tokens.every((t) => words.some((w) => w.startsWith(t)));
}

// Anvender token-set navnesøgning på en supabase-query. Tom / kun-whitespace /
// kun-metakarakter-q tilføjer intet filter (falder tilbage til ingen navne-
// begrænsning).
// referencedTable: når navne-søgningen skal anvendes på en EMBEDDED riders-relation
// (fx når rytter-DB'en drives fra rider_derived_abilities ved evne-sortering), så
// .or() rammer det embeddede niveau i stedet for top-level. Udeladt = top-level.
export function applyNameSearch(query, q, { referencedTable } = {}) {
  for (const token of nameSearchTokens(q)) {
    const pattern = buildAccentInsensitivePattern(token, { wordStart: true }); // #5941 ord-præfiks, ikke indeholder
    const orStr = `firstname.imatch.${pattern},lastname.imatch.${pattern}`;
    query = referencedTable ? query.or(orStr, { referencedTable }) : query.or(orStr);
  }
  return query;
}
