# NOW-historik — 2026-05-11

Arkiveret fra `docs/NOW.md` 2026-05-12 for at holde aktiv NOW.md under 30 linjer.

## Leveringer 2026-05-10

- 2026-05-10: **#287 Backwards-audit 'deployed kode + 0 data' LIVE som v3.10** — `audit-feature-liveness.js`, PR #291 merged, deploy SHA `4d24c4d`.
- 2026-05-10: **#286 Brugerverifikation-gate i PR-template LIVE** — PR-template + workflow `pr-verification-check.yml`, PR #290 merged.
- 2026-05-10: **GitHub Projects/cleanup + transfer/auction fixes v3.01-v3.09 LIVE** — detaljer i [`NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md`](NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md).
- 2026-05-10: **Token-audit session** — fandt at `NOW.md`, `SESSION_CONTEXT.md`, Claude memory/transcripts og unbounded issue-prefetch var største context-drivere; bounded prefetch indført.

## Leveringer 2026-05-11

- **#84 Slice 07f variabel sponsor implementeret som v3.12** — `sponsorEngine` deles af season-start payout, admin transition-preview og finance forecast. Sæson 1 fast 240K; sæson 2+ 200K base + 0-150K resultatvariabel før board/pullout-modifier. Backend 577/577 grøn, frontend build grøn.
- **#295 multer security-fix LIVE som v3.13** — `multer@2.1.1`, testbart `adminImportUpload`-modul og multipart regressionstest for Excel-upload. Commit `a65ba51`. #295 lukket, PR #114 lukket som superseded.
- **#295 upload edge-hardening som v3.14** — upload-limit giver kontrolleret JSON-fejl (`upload_file_too_large`); multipart regressionstest dækker nu også >10 MB fil.
- **Signup-økonomi fix klar som v3.15** — live-probe fandt 2 manager-placeholder-hold (Chris Machines + Equipo Kern Pharma, 0 finance rows). `teamProfileEngine` reparerer placeholder-path, migration retter DB-default/signup-trigger + berørte rows.
- **Pensionerede ryttere klar som v3.16** — `riders.is_retired`, admin-toggle på `/admin`, skjult fra rytter-/handelssøgninger, og backend-block på nye auktioner/transfers/swaps/lejeaftaler.
- **#83 Slice 07e soak-gate BESTÅET** — post_phase_b_null=0, post_phase_b_populated=61. Issue lukket.
- **#296 Supabase service_role rotation LIVE som v3.19** — migreret fra legacy JWT-keys til Supabase's nye `sb_secret_/sb_publishable_`-system; backend (Railway), GitHub Actions secret og frontend (Vercel) opdateret. Legacy JWT-based API keys disabled i Supabase Dashboard 18:18 UTC. Postmortem: [`2026-05-11-supabase-key-rotation.md`](../../.claude/learnings/2026-05-11-supabase-key-rotation.md).
- **#301 gitleaks forward-guard LIVE** — `.github/workflows/secret-scan.yml` scanner alle PRs, push til main, og weekly. `.gitleaksignore` allowlister rotated historiske leaks. Merged `e261017` ([PR #302](https://github.com/NicolaiDolmer/CyclingZone/pull/302)).
- **#297 Consent framework LIVE som v3.18** — cookie-banner m. 4 kategorier, `/privatlivspolitik`, Clarity gating. Squash `9aea6de`.
- **#35 Password-reset + auth-bølge FIX som v3.21** — `LoginPage.jsx` pinner reset-redirect til `https://cycling-zone.vercel.app` (env-var override mulig via `VITE_PUBLIC_APP_URL`) så reset-link aldrig lander på et SSO-beskyttet preview/team-alias. Vercel Authentication disabled på projektet.
- **#137 Event-logging baseline klar som v3.20** — `player_events` tabel + RLS, `logEvent.js` helper (analytics-consent-gated), 10 events instrumenteret (5 game + 5 feature-impressions). Detector E (zero-impression-features) tilføjet til feature-liveness-audit.
