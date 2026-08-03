# 2026-08-03 — HTML-fejlside-genkendelsen var forankret i beskedens start

## Hvad skete der?

`CYCLINGZONE-3X` hed bogstaveligt `Error: stall-watchdog seasons: <!DOCTYPE html>`
og bar hele Cloudflares 522-fejlside (~5 KB HTML) som Sentry-issue-titel. Fordi
siden indeholder unikke elementer (Ray ID, tidsstempel), grupperede to udfald af
samme outage ikke sammen — præcis den fejlklasse `lib/supabaseErrorNormalize.js`
blev skrevet for at lukke (filens hoved-kommentar: "Én outage blev til 7 separate
issues").

## Root cause

To lag svigtede samtidig, og det andet var det ikke-oplagte:

1. **Dækning:** `normalizeSupabaseErrorMessage()` blev kun kaldt fra
   `withSupabaseRetry`/`toSupabaseError` (8 filer) og fra `toSentryError()` — men
   dér kun for værdier der IKKE allerede var `Error`-instanser
   (`if (error instanceof Error) return error;`). Det dominerende mønster i
   backenden er `throw new Error(\`min-kontekst: ${err.message}\`)`, som findes i
   **112 filer**. Alle 112 gik uden om normaliseringen.

2. **Genkendelsen selv:** `looksLikeHtmlErrorPage()` testede
   `message.trimStart().slice(0, 200).startsWith("<!doctype html")`. Den antog at
   HTML'en **udgjorde hele beskeden**. Med et call-site-præfiks foran
   (`updateStandings: <!DOCTYPE html>…`) returnerede den `false`, og beskeden slap
   uændret igennem. Cloudflare-sider blev reddet af fallback-markørerne
   (`cf-error-details` / `Cloudflare Ray ID`), så fejlen var usynlig for dem — men
   en nginx-/origin-fejlside uden de markører slap helt igennem.

Punkt 2 er den egentlige læring: den første WIP-version af fixet tilføjede
præfiks-bevarelse i `normalizeSupabaseErrorMessage()`, men rørte ikke `gate`-funktionen
foran den. Testen for det parsebare Cloudflare-tilfælde blev grøn (fallback-markøren
bar den), mens tilfældet uden parsebar kode forblev rødt. **En gate der er forankret
i strengens start kan ikke genkende noget der er blevet et delstrenge-problem.**

## Fix (PR: fix/3052-sentry-html-message-normalize)

1. `looksLikeHtmlErrorPage()` bruger nu `HTML_DOC_START_RE`
   (`/<!doctype html|<html[\s>]/i`) **uforankret** i stedet for `startsWith` på de
   første 200 tegn. Dokument-start-tags er utvetydige — en ægte PostgREST-besked
   indeholder dem ikke, så det udvider ikke falsk-positiv-fladen.
2. `normalizeSupabaseErrorMessage()` er præfiks-bevarende: kun HTML-delen erstattes,
   så call-site-konteksten overlever
   (`stall-watchdog seasons: Supabase unavailable (522 Connection timed out)`).
3. `normalizeEventMessages()` kaldes i Sentrys `beforeSend` **før** gruppering og
   volumen-guard. Det dækker alle 112 raw-throw-call-sites ét sted uden en
   112-filers refaktor, og muterer kun Sentry-eventet — aldrig applikationens egne
   fejl-objekter.

Sidegevinst: `isTransientSupabaseError()` bruger samme gate, så en præfikset
gateway-fejlside nu også klassificeres transient og bliver retry'et. Det er samme
retning som #3180/CYCLINGZONE-47 (2/8), hvor Supabase-gateway-5xx blev gjort
transient.

## Forward-guard

`backend/lib/supabaseErrorNormalize.test.js` dækker nu begge akser eksplicit:
præfiks + parsebar kode, og præfiks + **u**parsebar kode (nginx-siden). Den sidste
var den røde test der afslørede at gaten manglede.

## Regel

Når en normaliserings-helper udvides fra "værdien ER X" til "værdien INDEHOLDER X",
så flyt **gaten** med. Detektion og transformation skal bruge samme kriterium — ellers
består det nye tilfælde kun for de input der tilfældigvis rammer en gammel fallback.
