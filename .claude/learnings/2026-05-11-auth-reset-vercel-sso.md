# Postmortem: Password-reset brudt af Vercel SSO på preview-aliaser (#35)

**Dato:** 2026-05-11
**Issue:** [#35](https://github.com/NicolaiDolmer/CyclingZone/issues/35)
**PR:** [#307](https://github.com/NicolaiDolmer/CyclingZone/pull/307) (commit `c5424f0`)
**Resultat:** ✅ Fixed end-to-end, prod verificeret

## Symptom

Flere brugere rapporterede på Discord i sidste time:
1. De var blevet logget ud i løbet af ~1 time
2. Password-reset-flow virkede ikke
3. En bruger fik en Vercel-genereret email: "No Vercel account for this email — a log in was requested from Nørresundby, Denmark"

## Root cause (to lag)

**Lag 1 — kode:**
`LoginPage.getPasswordResetRedirectUrl()` brugte `window.location.origin`:
```js
return new URL("/reset-password", window.location.origin).toString();
```
Det betød at reset-link altid pegede tilbage på den URL hvorfra brugeren havde bedt om reset. Ingen fail-safe hvis den URL var problematisk.

**Lag 2 — Vercel projekt-konfiguration:**
Vercel-projektet havde tre auto-genererede `*.vercel.app`-domæner:
- `cycling-zone.vercel.app` (vanity alias — 200 OK)
- `cycling-zone-nicolai-dolmers-projects.vercel.app` (team alias — 401 SSO)
- `cycling-zone-git-main-nicolai-dolmers-projects.vercel.app` (git-branch alias — 401 SSO)

Vercel Authentication (Deployment Protection) på Hobby plan dækkede alle aliaser undtagen vanity-domænet. Når en bruger tilgik spillet via team- eller git-aliaset (bookmark, delt link, eller fordi de var blevet flagged af Vercel's team-redirect), kaldte `resetPasswordForEmail()` med `redirectTo` peget tilbage til det SSO-beskyttede domæne.

**Kæden:**
1. Bruger klikker reset-link i email
2. Supabase verify-endpoint redirecter til `redirectTo` URL
3. Vercel SSO blokerer med 401 + "log in with Vercel"-side
4. Bruger taster sin email (tror det er spil-login)
5. Vercel sender "No Vercel account for this email"-mailen

Logout-bølgen var separat — efter [#296 Supabase key-rotation](2026-05-11-supabase-key-rotation.md) sidste aften 18:18 UTC blev legacy JWT-baserede API-keys disabled, så åbne sessions med cached refresh-tokens måtte re-authenticate. Ikke en bug, men det skubbede mange brugere ind i reset-flowet samtidig — og dermed afslørede det brudte reset.

## Hvorfor blev det ikke fanget før

- Issue #35 lå åbent siden 2026-04-22 (24 dage) uden triage
- Discord-rapporten havde et screenshot men ingen eksplicit URL — kunne ikke korreleres mod Vercel-domæner uden at gentage flowet
- Hverken Microsoft Clarity eller Sentry var sat op på reset-flowet
- E2E-tests (#288) er ikke implementeret endnu, så Playwright kunne ikke fange det

## Hvad blev gjort

1. **Frontend-fix** (commit `c5424f0`):
   ```js
   const PUBLIC_APP_URL =
     import.meta.env.VITE_PUBLIC_APP_URL || "https://cycling-zone.vercel.app";
   function getPasswordResetRedirectUrl() {
     return new URL("/reset-password", PUBLIC_APP_URL).toString();
   }
   ```
   Lokal dev kan override med `VITE_PUBLIC_APP_URL=http://localhost:5173`.

2. **Vercel Dashboard**: Settings > Deployment Protection > Vercel Authentication slået OFF. Confirmation-dialog kræver typed "disable vercel authentication". Alle tre `*.vercel.app`-aliaser returnerer nu 200 OK.

3. **Supabase Dashboard** (manuelt af bruger): Auth > URL Configuration > Site URL = `https://cycling-zone.vercel.app`, redirect-allowlist = kun den + `http://localhost:5173/**`. Forward-guard så `redirectTo` der ikke matcher falder tilbage på sikker Site URL.

4. **PatchNotes v3.21** med brugerrettet forklaring.

## Verifikation

Bundle-grep efter deploy:
```
LoginPage-BlnbbV-1.js indeholder: `https://cycling-zone.vercel.app`
LoginPage-BlnbbV-1.js indeholder ikke: window.location.origin (count: 0)
```

HTTP-codes:
- `cycling-zone.vercel.app` → 200 OK
- `cycling-zone-git-main-...vercel.app` → 200 OK (var 401)
- `cycling-zone-nicolai-dolmers-projects.vercel.app` → 200 OK (var 401)

## Forward-guards installeret

1. **Hardcoded redirect-base i kode** — frontend kan ikke længere blive forledt af `window.location.origin`
2. **Supabase redirect-allowlist** — selv hvis frontend bliver hacket/buggy, kan reset-link ikke pege på et nyt domæne uden konfig-ændring
3. **Vercel Authentication OFF** — alle nuværende og fremtidige `*.vercel.app`-aliaser er publikt tilgængelige (acceptabelt for offentlig multiplayer-game)

## Lessons learned

1. **`window.location.origin` er usikkert for auth-redirects** når et projekt har flere domæner med forskellige protection-niveauer. Pin altid til en kendt sikker URL via env-var.
2. **Tjek alle projekt-aliaser med curl HEAD** når man undersøger auth-issues — Vercel's auto-genererede domæner har ofte forskellige security-policies end vanity-aliaset.
3. **Vercel Hobby's "Standard Protection" betyder "alle undtagen custom domains"** — hvis projektet ingen custom domain har, betyder det "alle undtagen vanity-aliaset". Subtilt og let at overse.
4. **Korrelér Discord-rapporter mod backend-events**: Hvis #137 event-logging baseline (LIVE som v3.20) havde været tilgængelig 24 dage tidligere, kunne vi have set "0 successful resets after request" som signal.
