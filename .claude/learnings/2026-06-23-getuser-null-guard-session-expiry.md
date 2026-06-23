# getUser()→null crashede ~15 sider ved udløbet session (CYCLINGZONE-16)

**Dato:** 2026-06-23 · **Issue:** [#1792](https://github.com/NicolaiDolmer/CyclingZone/issues/1792) · **Sentry:** CYCLINGZONE-16 (+ CYCLINGZONE-15 noise)

## Symptom

Sentry CYCLINGZONE-16: `TypeError: null is not an object (evaluating 'e.id')` i `TeamPage.jsx`, mekanisme `onunhandledrejection`. Ramt: iPhone / Mobile Safari, på `/team`. 1 bruger, men latent på ~15 sider.

## Root cause

`supabase.auth.getUser()` laver et **server-side** token-validerings-kald. Ved en udløbet/ugyldig session returnerer den `{ data: { user: null } }`, og kaldstedet derefererede `user.id` uden guard → unhandled rejection → hele siden faldt.

`ProtectedRoute` (`App.jsx`) beskytter **ikke** mod dette: den tjekker kun den **cachede** session lokalt (`getSession`), ikke om serveren stadig accepterer tokenet. Brugeren slipper ind via cache, men `getUser()` afvises server-side. Typisk trigger: mobil Safari der har smidt storage, eller en gammel fane der genåbnes efter inaktivitet.

## Hvorfor en hel klasse

Guard-praksis var **inkonsistent**: nogle `getUser()`-kaldsteder havde `if (!user) return;` (TrainingPage, useAcademy, logEvent, RidersPage, AuctionsPage …), men ~15 andre derefererede `user.id`/`authUser.id` direkte. Samme bug ventede overalt.

## Fix

- `if (!user) { …; return; }`-guard på alle 16 uguardede kaldsteder; rydder loading-state (`setLoading(false)` / `setNotifLoading(false)` / `setRefreshing(false)`) hvor der ellers ville hænge en spinner. Auth-flowet (`onAuthStateChange` → `SIGNED_OUT` → `ProtectedRoute`) håndterer selve redirect til `/login`.
- `sentry.jsx`: `denyUrls` dropper `chrome-/moz-/safari-extension://`-injiceret støj (CYCLINGZONE-15 = TronLink-wallet, ikke vores kode).

## Læring / forward-guard

1. **Ved `getUser()` i en auth-gated load: guard `user` FØR enhver deref.** `getUser()` kan returnere null selv bag `ProtectedRoute`, fordi route-guarden læser cached session, ikke server-validering. Overvej en delt `getAuthedUser()`-helper eller lint-regel hvis klassen dukker op igen.
2. **Browser-extension-fejl er ikke vores bugs.** Stacktrace med kun `*-extension://`-frames → filtrér i Sentry (`denyUrls`), ikke fix i kode.
3. **Cross-session-kollision (worktree):** #1794 (loader-højde/PageLoader) rørte de **samme ~15 filer** parallelt og merged til main midt i arbejdet. Ændringerne var ortogonale (render/import vs. load-funktion) → rebase auto-merged rent, men patch-note-versionen kolliderede (begge 6.02). Lærdom: efter rebase **altid re-verificér build+tests+lint mod den merged kode** og bump patch-version til > main's top.
