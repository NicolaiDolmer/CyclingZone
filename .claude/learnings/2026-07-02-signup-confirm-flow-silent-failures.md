# Postmortem · 2026-07-02 · Signup/confirm-flow: to stille fejl, fundet via Discord + live prod-test

## Hvad skete der?
Discord-bug-rapport (jdfellaini@gmail.com m.fl., 1/7): klik på bekræftelseslink → sendt tilbage uden bekræftelse, ingen fejlbesked. To andre spillere: (a) et resend-forsøg sendte aldrig en mail, (b) efter vellykket bekræftelse blev de bedt om at genindtaste hold-/managernavn.

## Root cause
1. `signUp()` gemte kun `team_name` i auth-metadata, aldrig `manager_name` — og INGEN kode kaldte `PUT /api/teams/my` efter deferred email-bekræftelse. Holdet blev kun bootstrappet i immediate-session-grenen (confirm-off). `SetupWizardModal` fangede det stiltiende ved næste login, men bad brugeren skrive alt forfra.
2. Ingen "send igen"-vej fandtes overhovedet — kun gæt-på-ny-email.
3. (Fundet ved LIVE test mod prod under verifikation, ikke i mock): Supabases standard-mailer rammer rate-limits hurtigt uden custom SMTP → `signUp()`/`resend()` kan "lykkes" API-mæssigt uden at mailen rent faktisk sendes, og fejlen blev ikke vist alle steder (success-skærmen manglede et fejl-display helt) fordi `authErrors.js`'s regex kun matchede Supabases gamle "...this once"-ordlyd, ikke den nuværende dynamiske "...this after N seconds".

## Fix
- [LoginPage.jsx](../../frontend/src/pages/LoginPage.jsx): `manager_name` i signup-metadata + "send igen"-knap (to steder: confirm-succes-skærm + login-fejlen "email not confirmed") + dedikeret `resendError`-state så fejlen faktisk vises på begge skærme.
- [Layout.jsx](../../frontend/src/components/Layout.jsx): auto-bootstrapper holdet stille fra metadata første gang en confirm-on-bruger logger ind; `SetupWizardModal` er nu kun en forudfyldt fallback.
- [authErrors.js](../../frontend/src/lib/authErrors.js): rate-limit-regex udvidet til også at matche "...this after N seconds".
- PR #2069 (kode) + #2097 (patch note v6.43, glemt ved selve merge).

## Forhindret-fremover
- Regression-test i `authErrors.test.js` for begge rate-limit-varianter (#2068).
- Live-test-mod-prod (midlertidig konto, slettet efter) afslørede fejlen der IKKE ville være fanget af en mocket Playwright-test — se [[feedback_test_real_endpoint_not_just_mocked]].

## Læring
En "success"-response fra Supabase (`signUp()`/`resend()` returnerer `{error: null}`) betyder IKKE at mailen faktisk blev leveret — mailserver-rate-limits rammer server-side, usynligt for klienten. Enhver "send email igen"-affordance skal derfor selv have sit eget synlige fejl-display, ikke antage at den delte formular-fejlblok dækker begge visnings-kontekster (success-skærm vs. formular-fejl). Desuden: closing af et parent-issue ved PR-merge kan skjule at KUN dele af scopet blev lavet (#2068 lukkede automatisk selvom SMTP-punktet stod tilbage) — tjek issue-scope mod faktisk PR-diff før du stoler på "closed" som "done".
