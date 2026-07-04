# 2026-07-04 — #2172: den rapporterede bug var i vid udstrækning allerede fixet

## Symptom (rapporteret)
Discord 1/7: ny bruger tilmelder sig → klikker bekræftelseslink → lander på landing page (ikke logget ind) → login siger "ikke bekræftet". Plus: gentaget holdnavn → ingen mail, og dobbelt-prompt af manager/holdnavn efter bekræftelse. Issue-label: `priority:high`, "blokerer signups".

## Root cause (faktisk)
To lag:
1. **De literale symptomer var allerede adresseret** af #2068/#2069/#2078/#2144, som shippede **2/7-3/7 — EFTER** rapporten (1/7). Gyldig confirm-session redirecter allerede `/`→`/dashboard`; døde links fanges af `parseAuthErrorHash`→/login; hold auto-oprettes fra auth-metadata; login viser resend-knap.
2. **Den ægte tilbageværende rod-årsag** bag de ~20 % ubekræftede: bekræftelseslinket ankommer **dødt** for et mindretal — `email_confirmed_at = NULL` beviser at Supabases verify-endpoint aldrig blev ramt. Årsag = deliverability/config (email-scannere der opbruger engangslinket, for kort udløb, mail-rate-limit) = **Supabase-dashboard**, ikke frontend-kode. Sporet i #2085.

## Bevis der afgjorde det
- `auth.users`: de rapporterende brugere havde `email_confirmed_at = NULL` men `confirmation_sent_at` sat → verify aldrig ramt (ikke en session/redirect-fejl).
- Daglig unconfirmed-rate: ~20 % 30/6-2/7, **0 % 3/7 og 4/7** (efter fixes).
- `git log` + commit-datoer viste at 3 relevante fixes lå mellem rapporten og nu.
- `teams`-tabellen: "Fellaini Racing Team" oprettet 14:09 af den bekræftede konto — altså EFTER de fejlede forsøg, så frontend-pre-checket kunne ikke have blokeret de tidlige mails ("collision → no mail" var en rød sild; reelt rate-limit).

## Fejl jeg (næsten) lavede
- En Explore-subagent påstod "Bug #1: ingen auto-redirect efter confirm" og foreslog at tilføje en redirect-effekt. **Forkert** — `App.jsx:214` redirecter allerede `session ? <Navigate to="/dashboard"/>`. Havde jeg bygget på agentens konklusion uden at læse linje 214, havde jeg tilføjet død kode + symptom-patchet.
- `#2078`-commit'en kaldte en `detectSessionFromUrl`→`detectSessionInUrl`-typo for et fix, men default ER `true`, så typo'en var harmløs — ikke årsagen. Ikke lad en commit-besked definere rod-årsagen.

## Læring (forward-guard)
- **Verificér mod NUVÆRENDE kode + live prod-tilstand FØR du fikser en rapport der er et par dage gammel** — i et repo der shipper flere gange dagligt kan "the bug" være lukket af mellemliggende commits. Tjek commit-datoer vs. rapport-dato.
- **`email_confirmed_at = NULL` = verify aldrig ramt**: skeln mellem "session/redirect-fejl i frontend" og "linket var dødt" — de har helt forskellige fixes (kode vs. Supabase-config).
- **Stol ikke blindt på en subagents bug-konklusion** — verificér den ene autoritative linje selv (her: routing i App.jsx).
- Døde confirm-links i prod = mistænk **email-scannere + link-udløb + rate-limit** (dashboard), ikke kun app-kode.

## Fix
PR #2185: robust `isEmailNotConfirmedError` (code ELLER message) + handlingsanvisende udløbet-link-banner ("Send a fresh link"). Rod-årsag-config = #2085 (ejer).
