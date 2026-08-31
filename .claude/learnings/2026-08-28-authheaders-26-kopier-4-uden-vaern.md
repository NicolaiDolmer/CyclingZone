# 28/8: authHeaders() skrevet forfra 26 gange - 4 kopier uden vaern (#4347/#4348)

## Symptom

Doed session -> hjerteslaget i Layout.jsx sendte "Bearer undefined" hvert 60. sek (401-stoej i Railway), online-taelleren viste 0, og spilleren saa en tilsyneladende indlogget fane.

## Rod-aarsag

Hjaelpefunktionen der pakker tokenet i en header var aldrig centraliseret: 26 haandskrevne kopier i 4 varianter. 22 havde vaernet (intet token -> null), 4 havde ikke - `session?.access_token` interpolerede `undefined` direkte ind i Bearer-strengen, som serverens `if (!token)`-vaern ikke fanger (strengen "undefined" er truthy).

## Fix (PR #4368)

Een kanonisk `authHeaders()` i `frontend/src/lib/supabase.ts` (tidlig-retur-vaern + `json:false`-variant for GET uden CORS-preflight). Alle 26 kopier erstattet.

## Forward-guard

`frontend/src/lib/authHeadersCanonical.4348.test.js` scanner hele frontend/src og fejler paa enhver fremtidig lokal `authHeaders()`-definition - verificeret at den fanger en simuleret kopi nr. 27.

## Laering

Naar samme 5-linjers hjaelper findes i N kopier, er fejlklassen ikke "en kopi er forkert" men "der er ingen kanon". Fix = centralisér + guard-test der goer kopi N+1 til en CI-fejl, ikke punktvis reparation (det var PR #4349's tilgang - superseded).

## Rest

- #4350 (doed session ser indlogget ud) + #4352 (tavse API-fejl): kraever UX-beslutning, dokumenteret i PR #4368-body.
- RiderStatsPage.jsx: 9 inline auth-moenstre af ANDEN klasse (TypeError ved doed session) - flaget i PR-body, ikke roert.
