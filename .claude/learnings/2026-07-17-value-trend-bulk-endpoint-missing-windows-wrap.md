# Postmortem · 2026-07-17 · Value-trend-pile på holdlisten renderede aldrig i prod

## Hvad skete der?
#2499 (værdi-bevægelse skal kunne SES) shippede en badge på holdlisten der viser
en pil + delta for hver rytters værdi-bevægelse. Badgen fandtes i koden, i18n
var på plads, men den renderede ALDRIG i prod — ingen fejl, ingen konsol-varsel,
bare fravær.

## Root cause
To endpoints deler samme beregningskerne (`computeRiderValueTrend`), men fik
forskellig response-envelope:
- `GET /api/riders/:id/value-trend` → `res.json({ windows })` (korrekt, wrapped).
- `POST /api/riders/value-trend` (bulk til holdlisten) → `result[r.id] = computeRiderValueTrend(...)`
  — IKKE wrapped i `{ windows }`.

Frontend (`TeamPage.jsx`) læser `valueTrends[r.id]?.windows`, som derfor altid
var `undefined` for bulk-svaret → `pickBestValueTrendWindow(undefined)` → ingen
badge. Fejlen var helt tavs: intet kastede, ingen 500, ingen frontend-console-warning
— den forkerte shape blev bare aldrig konsumeret.

## Fix
`backend/routes/api.js` (POST `/riders/value-trend`, ~linje 1039-1049): wrap hvert
resultat i `{ windows: computeRiderValueTrend(...) }` så det matcher GET-shapen 1:1.
Frontend (`TeamPage.jsx:527`, `RiderValueTrendBadge.jsx`) krævede ingen ændring —
koden var allerede korrekt skrevet til at forvente `{ windows }`, den fik den
bare aldrig fra bulk-endpointet.

## Forhindret-fremover
Ny regressionstest `backend/routes/riderValueTrendShape.routes.test.js`:
1. Behavioral test: `computeRiderValueTrend` + `groupSnapshotsByRider` (samme
   rene funktioner begge routes bruger) giver IDENTISK `windows`-indhold for
   single- og batch-stien på samme rytter/data.
2. Kildetekst-scan (samme mønster som `scoutAssignments.routes.test.js`, da
   `api.js` kræver en live Supabase-client og ikke er direkte unit-testbar):
   låser at POST-routen skriver `result[r.id] = { windows: computeRiderValueTrend(...) }`
   og eksplicit IKKE den gamle, brækkede form `result[r.id] = computeRiderValueTrend(...)`.
   Testen blev verificeret til at FEJLE mod den gamle kode før fixet blev
   genindsat (ægte red→green, ikke bare et nyt assert der tilfældigvis passer).

## Læring
To endpoints der wrapper samme underliggende beregning i forskellige json-shapes
er en klasse af bug der er 100% usynlig i normal drift (ingen fejl, ingen crash)
og kun opdages ved enten manuel UI-gennemgang eller en eksplicit
kontrakt-parity-test. Når et nyt endpoint tilføjes som "batch-variant" af et
eksisterende endpoint, lås response-envelope-shapen med en test SAMTIDIG med
implementeringen — vent ikke til et separat opfølgende issue opdager det i
prod uger senere (#2499 → #2597).
