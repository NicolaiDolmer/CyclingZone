# 2026-05-24 — Claimed fix without verifying observability pipeline

## Symptom

#614 ("Sentry per-team capture i 5 crons") blev marked `claude:done` efter commit bd0de79 — 5 crons fik injected `captureExceptionFn` der kalder `Sentry.captureException` ved per-team fails. 741/741 backend tests pass, 7 nye regressionstests verificerer fn-kald + tags + extra.

Men da brugeren spurgte "hvordan laver jeg denne?" og åbnede Sentry-UI'en for at se cron-events, viste UI'en `Get Started with Sentry Issues` + SDK install-guide. Projektet havde **aldrig modtaget events**. `captureExceptionFn`-kaldene var no-ops i prod hele tiden.

## Root cause

`backend/lib/sentry.js:19`:
```js
export function initSentry() {
  if (enabled || !process.env.SENTRY_DSN) return;
  // ... Sentry.init()
  enabled = true;
}
```

`captureException()` returnerer tidligt hvis `!enabled` (`backend/lib/sentry.js:43`). Hvis `SENTRY_DSN` ikke er sat → `initSentry` returnerer uden at sætte `enabled` → ALLE `captureException`-kald er no-ops uden warning.

`SENTRY_DSN` mangler i Vercel prod env (verificeret via `vercel env ls production`). #348 har sporet dette siden 2026-05-13 men er stadig `claude:todo` (kræver bruger-handling: skaffe DSN fra Sentry-UI + sætte env vars).

## Hvorfor missede vi det

1. **Test-fixturen mocker captureExceptionFn:** Alle 7 nye tests verificerer at fn KALDES, men ingen verificerer at fn ER aktiv i prod. Test-suiten validerer kode-shape, ikke runtime-effekt.
2. **AC #4 var skrevet som "post-deploy verifikation"** men close-protokollen (label `claude:done`) blev anvendt før AC #4 var udført. AC'en blev behandlet som "nice-to-have" snarere end "lukke-blocker".
3. **#348-dependency var nævnt i issue-body** ("SENTRY_DSN skal være konfigureret i prod (#348 cross-ref)") men ikke som hard blocker.
4. **`Sentry.captureException` fail-silently-design:** SDK kaster ikke når DSN mangler. Det er en sane default for produktion (don't crash on telemetry-config), men kombineret med fail-silent på enabled=false i wrapperen gav det "ingen warnings nogensinde". Et early-once log-statement ("Sentry disabled — DSN mangler") ville have ramt øjnene 100 gange under deploy.

## Patterns at undgå

**Pattern (anti):** "Tests pass + commit landed = done."

**Pattern (pro):** En fix der bruger en observability/feature-flag/CI/external-system path skal verificere at den path er **active in prod** før close. Test-fixturer kan ikke proxy'e for "secret-er-sat-på-runtime".

Konkret check-liste for "code calls X — er X actually live?":
- **Sentry:** Hit en test-route der `throw`s og kig i Issues — eller kør smoke-test script (`backend/scripts/sentry-smoke-test.mjs`).
- **Feature flags:** Verificér flag-state i prod control-plane.
- **Webhook delivery:** Tjek receiver-side logs for trigger-event.
- **CI gate:** Læs PR-status-checks output, ikke kun "tests passed locally".
- **Email/SMS:** Send en test, log delivery-receipt fra provider.

## Forward-guard

Tilføjet 2026-05-24:

1. **`scripts/setup-sentry-and-verify.ps1`** — én-shot driver der sætter Vercel env vars + kører smoke-test mod prod-DSN. (Bemærk: oprindeligt skrevet til at sætte SENTRY_DSN på Vercel, men backend lever på Railway — se "Architecture-confusion-addendum" nedenfor.)
2. **`backend/scripts/sentry-smoke-test.mjs`** — sender én test-exception med samme call-shape som #614's cron-capture: `captureException(err, { tags: { cron: "smoke-test" }, extra: { ... } })`. Validerer hele pipeline'en lokalt mod prod-Sentry.
3. **CRON_AUDIT_2026-05-24.md P2-A** opdateret med "Post-deploy verifikation"-note der peger på scriptet.

**Sentry init-warning at overveje (ikke-implementeret):** Tilføj `console.warn` i `initSentry` når `SENTRY_DSN` mangler i `NODE_ENV=production`. Spawn evt. separat issue hvis det vurderes værd at fixe — det ville have fanget #614's verification-gap inden release.

## Architecture-confusion-addendum (2026-05-25)

Under fix-verifikation antog jeg at backend kørte på Vercel og brugte 5 min på at sætte SENTRY_DSN i Vercel prod env. Det var spildt arbejde — **backend (med cron.js) lever på Railway**, ikke Vercel. Vercel hoster kun frontend SPA.

**Hvordan jeg burde have tjekket først:**
- `find . -maxdepth 3 -name "railway.toml" -o -name "vercel.json"` → afslører `frontend/vercel.json` (frontend only)
- `grep -r "railway.app\|vercel.app" --include="*.mjs" --include="*.json" --include="*.md" scripts/ docs/ | head` → `smoke-test-prod.mjs` har `BACKEND_URL = "https://cyclingzone-production.up.railway.app"`
- `curl -s https://cyclingzone-production.up.railway.app/health` returnerer JSON (backend), `https://cycling-zone.vercel.app/api/health` returnerer HTML (no backend route)

**Hvorfor jeg gættede forkert:** `vercel env ls production` viste mange backend-relevante vars (SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN, PORT). Det gav indtryk af backend-på-Vercel, men er sandsynligvis legacy/build-time-shared vars eller forberedelse til serverless-migration. Lekt: en env-var-listing er IKKE bevis for hvor koden faktisk kører.

**Fix-pattern for fremtiden:** Inden du sætter prod-secrets, identificér deploy-target via:
1. Read deploy config files (railway.toml, railway.json, vercel.json, fly.toml, dockerfile)
2. curl health-endpoints
3. Læs eksisterende deploy-scripts/verify-scripts for hardcoded URLs
4. Spørg brugeren hvis stadig usikker — 30 sek > genarbejde

`scripts/setup-sentry-and-verify.ps1` blev kun delvist nyttig fordi det var Vercel-only. For Railway-prod-DSN brugte vi `railway variables --service CyclingZone --set "SENTRY_DSN=..."`. Script kan udvides til at understøtte begge targets i en follow-up.

## Cross-refs

- [#614](https://github.com/NicolaiDolmer/CyclingZone/issues/614) — den oprindelige fix
- [#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348) — Sentry secrets aktivering (blocker for #614 AC #4)
- bd0de79 — fix commit (kode korrekt, men no-op uden DSN)
- b19d1c4 — verifikations-pipeline (scripts/setup-sentry-and-verify.ps1)
- `backend/lib/sentry.js:19` — fail-silent-init der maskerede problemet
