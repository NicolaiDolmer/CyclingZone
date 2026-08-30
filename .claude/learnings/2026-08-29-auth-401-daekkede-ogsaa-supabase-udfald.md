# Postmortem · 2026-08-29 · requireAuth's 401 dækkede også "kunne ikke nå Supabase"

## Hvad skete der?
Backendens `requireAuth` svarede 401 både på et ægte afvist token og på et
netværksudfald mod Supabase. Klienten kunne ikke skelne. Da frontenden i #4350
begyndte at HANDLE på en 401 (rydde sessionen og sende spilleren til login),
blev det farligt: et kortvarigt Supabase-udfald ville logge raske spillere ud.
Log-billedet var også uærligt - `[auth] 401 invalid_token` kom også når tokenet
var fint.

## Root cause
`backend/routes/api.js` slog to modsatte tilstande sammen i én betingelse:

```js
const { data: { user }, error } = await supabase.auth.getUser(token);
if (error || !user) return res.status(401).json({ error: "Invalid token" });
```

`error` er både `AuthApiError` (Supabase svarede "nej") og
`AuthRetryableFetchError` (Supabase svarede slet ikke). Informationen fandtes i
`error.name`/`error.status`, men blev kastet væk ét udtryk før den skulle bruges.

## Fix
`backend/lib/authTokenVerification.js` (ny): `classifyAuthFailure` +
`verifyBearerToken` oversætter et `getUser()`-svar til
`authenticated`/`rejected`/`unavailable`. 4xx og "svar uden bruger" = 401
uændret; `AuthRetryableFetchError`, 5xx, kastede fetch-fejl og alt ukendt = 503
`{error:"auth_unavailable"}`. `requireAuth` i `backend/routes/api.js` oversætter
kun afgørelsen til et svar og logger de to grene hver for sig.

## Forhindret-fremover
- `backend/lib/authTokenVerification.test.js` - 16 tests, begge grene plus
  tvivlsreglen.
- `backend/routes/authFailureSignal.4369.test.js` - kilde-guard: `if (error || !user)`
  må ikke komme tilbage, og udfalds-grenen skal ligge før afvisnings-grenen og
  aldrig kalde `next()`.
- `frontend/src/lib/sessionExpiry.test.js` - 503 er nu eksplicit i listen over
  statusser der ALDRIG må logge en spiller ud.

## Læring
Når to modsatte tilstande deler ét svar, flytter problemet sig bare til den der
skal aflæse det - og løsningen dernede bliver et gæt. #4350 måtte bygge et
ekstra Supabase-opslag pr. afvisning for at kompensere. Skeln ved KILDEN, hvor
informationen faktisk findes. Og når der stadig er tvivl: vælg den fejl der ikke
er destruktiv. At kalde et dødt token for et udfald koster et par fejlende kald;
at kalde et udfald for et dødt token smider raske spillere ud.
