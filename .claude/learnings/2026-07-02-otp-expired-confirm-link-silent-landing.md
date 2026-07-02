# Udløbet confirm-link landede tavst på landing page (#2078)

**Dato:** 2026-07-02
**Type:** bugfix (auth/onboarding)
**PR:** #2110 (v6.48)

## Symptom
Discord-rapport 1/7 (fellaini): klik på email-bekræftelseslink → tom landing page, ingen besked. Login blev ved med at sige "ikke bekræftet". PR #2069 (resend + auto-hold) fixede ikke dette.

## Rod-årsag
`signUp()` sætter ingen `emailRedirectTo`, så confirm-links går til Supabase Site URL (`/`). Ved udløbet/ugyldigt token etablerer Supabase **ingen session** — den redirecter i stedet med fejlen i URL-**hash'et**:
`/#error=access_denied&error_code=otp_expired&error_description=...`
Intet i frontenden læste `error_code` (grep: 0 hits), så brugeren landede på landing page uden forklaring. Bonus-bug: `supabase.ts` brugte `detectSessionFromUrl` (ukendt option — korrekt navn er `detectSessionInUrl`); virkede kun fordi supabase-js' default allerede er `true`.

## Fix
- `parseAuthErrorHash`-util (ren, unit-testet): parser fejl-hash, ignorerer success-hash (`#access_token=…` ejes af supabase-js' `detectSessionInUrl`).
- `App` fanger fejl-hash ved mount → rydder hash → redirect til `/login` med fejlkoden i router-state.
- `LoginPage` viser engangs-flash-besked (EN+DA, `auth:linkError`); router-state ryddes så reload ikke gen-viser den.
- Rettede `detectSessionInUrl`-typo.

## Læringer
1. **Supabase-auth-fejl bor i URL-hash'et, ikke i query eller session.** Et fejl-flow uden session er let at overse, fordi der ingen `SIGNED_IN`-event kommer og intet redirect-target håndterer det. Enhver auth-redirect-landing bør parse hash for `error`/`error_code`.
2. **`emailRedirectTo` er en dashboard-koblet beslutning.** En custom redirect-URL kræver at den står i Supabases "Redirect URLs"-allowlist, ellers afvises den. Kan ikke sættes kode-only uden at røre dashboard — noteret til ejer i stedet for at gætte.
3. **react-router `location.state` overlever reload** (gemt i `window.history.state`). Til engangs-flash-beskeder: fang i `useState`-initializer ved mount + ryd router-state via `navigate(..., { replace:true, state:null })`, ellers hænger beskeden ved hvert reload i samme session.
4. **Forkert-stavet client-option fejler tavst** når default matcher den ønskede værdi — grep efter option-navne mod libens faktiske API ved mistanke.

## Forward-guard
`authErrorHash.test.js` dækker otp_expired, access_denied, success-hash-ignorering, tom/malformed input. Fremtidige auth-redirect-flows kan genbruge `parseAuthErrorHash`.
