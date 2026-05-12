# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 09 — Race-pool katalog LIVE som v2.99 ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242))**. 97 løb er seedet i prod. Admin skal stadig vælge sæson 1-kalenderen via `Race-katalog` på `/admin`; klik ikke `Sæson-cyklus` før sæsonstart omkring 2026-05-15.

## Senest leveret
Historik før 2026-05-10 ligger i [`NOW_HISTORIK_2026-05-09-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-09-PRECOMPACT.md) og [`NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md). Leveringer fra 2026-05-10 v3.01-v3.10 er kompakteret i [`NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md`](archive/NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md).

- 2026-05-10: **#287 Backwards-audit 'deployed kode + 0 data' LIVE som v3.10** — `audit-feature-liveness.js`, PR #291 merged, deploy SHA `4d24c4d`.
- 2026-05-10: **#286 Brugerverifikation-gate i PR-template LIVE** — PR-template + workflow `pr-verification-check.yml`, PR #290 merged.
- 2026-05-10: **GitHub Projects/cleanup + transfer/auction fixes v3.01-v3.09 LIVE** — detaljer i arkivet nævnt ovenfor.
- 2026-05-10: **Token-audit session** — fandt at `NOW.md`, `SESSION_CONTEXT.md`, Claude memory/transcripts og unbounded issue-prefetch var største context-drivere; bounded prefetch indført.
- 2026-05-11: **#84 Slice 07f variabel sponsor implementeret som v3.12** — `sponsorEngine` deles af season-start payout, admin transition-preview og finance forecast. Sæson 1 fast 240K; sæson 2+ 200K base + 0-150K resultatvariabel før board/pullout-modifier. Backend 577/577 grøn, frontend build grøn.
- 2026-05-11: **#295 multer security-fix LIVE som v3.13** — `multer@2.1.1`, testbart `adminImportUpload`-modul og multipart regressionstest for Excel-upload. Commit `a65ba51`; GitHub CI, Deploy verify, CodeQL og Dependabot Updates grønne. #295 lukket, PR #114 lukket som superseded.
- 2026-05-11: **#295 upload edge-hardening som v3.14** — upload-limit giver kontrolleret JSON-fejl (`upload_file_too_large`); multipart regressionstest dækker nu også >10 MB fil. Backend 581/581 grøn, frontend build grøn.
- 2026-05-11: **Signup-økonomi fix klar som v3.15** — live-probe fandt 2 manager-placeholder-hold (Chris Machines + Equipo Kern Pharma, 0 finance rows). `teamProfileEngine` reparerer placeholder-path, migration retter DB-default/signup-trigger + berørte rows. Backend 583/583 grøn, frontend build grøn.
- 2026-05-11: **Pensionerede ryttere klar som v3.16** — `riders.is_retired`, admin-toggle på `/admin`, skjult fra rytter-/handelssøgninger, og backend-block på nye auktioner/transfers/swaps/lejeaftaler. Backend 584/584 grøn, frontend build grøn.
- 2026-05-11: **#83 Slice 07e soak-gate BESTÅET** — post_phase_b_null=0, post_phase_b_populated=61. Issue lukket.
- 2026-05-11: **#296 Supabase service_role rotation LIVE som v3.19** — migreret fra legacy JWT-keys til Supabase's nye `sb_secret_/sb_publishable_`-system; backend (Railway), GitHub Actions secret og frontend (Vercel) opdateret. Legacy JWT-based API keys disabled i Supabase Dashboard 18:18 UTC. Verificeret: lækket nøgle returnerer nu `401 "Legacy API keys are disabled"`. GitHub secret-scanning alert #1 lukket som revoked. Postmortem: [`2026-05-11-supabase-key-rotation.md`](../.claude/learnings/2026-05-11-supabase-key-rotation.md). Vercel CLI installeret + projekt linket.
- 2026-05-11: **#301 gitleaks forward-guard LIVE** — `.github/workflows/secret-scan.yml` scanner alle PRs, push til main, og weekly. `.gitleaksignore` allowlister rotated historiske leaks. Merged `e261017` ([PR #302](https://github.com/NicolaiDolmer/CyclingZone/pull/302)). Endnu ikke required check — se [#303](https://github.com/NicolaiDolmer/CyclingZone/issues/303) for promotion efter 5 grønne PRs.
- 2026-05-11: **#297 Consent framework LIVE som v3.18** — cookie-banner m. 4 kategorier, `/privatlivspolitik`, Clarity gating. Squash `9aea6de`.
- 2026-05-12: **#303 Gitleaks promoted til required check LIVE som v3.22** — `gh api PATCH` på `branches/main/protection/required_status_checks` efter 6 grønne PR-runs af `secret-scan.yml`. Required checks nu: `backend-tests` + `frontend-build` + `dependency-review` + `gitleaks`. Memory `reference_main_branch_protection.md` opdateret. Commit `bf23de5`.
- 2026-05-12: **#35 lukket** — affected bruger bekræftede reset-flow virker (mail → form → login). Postmortem bevaret i [`2026-05-11-password-reset-vercel-sso.md`](../.claude/learnings/2026-05-11-password-reset-vercel-sso.md).
- 2026-05-11: **#35 Password-reset + auth-bølge FIX som v3.21** — `LoginPage.jsx` pinner reset-redirect til `https://cycling-zone.vercel.app` (env-var override mulig via `VITE_PUBLIC_APP_URL`) så reset-link aldrig lander på et SSO-beskyttet preview/team-alias. Vercel Authentication disabled på projektet (alle `*.vercel.app`-domæner returnerer nu 200 i stedet for 401). Resterende: Supabase Site URL + redirect-allowlist konfigureres efter at supabase.com gives browser-extension-permission.
- 2026-05-11: **#137 Event-logging baseline klar som v3.20** — `player_events` tabel + RLS, `logEvent.js` helper (analytics-consent-gated), 10 events instrumenteret (5 game + 5 feature-impressions). Detector E (zero-impression-features) tilføjet til feature-liveness-audit; skipper PR-runs, kører ugentligt mandage 04:00 UTC. Beslutning: egen Supabase-tabel frem for PostHog så Detector E er én SQL-query og data kan joines med teams/seasons.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242)) — vælg sæson 1, race-dage 60, generér forslag, gem. **Deadline ~2026-05-15.**
2. **Sæson 1 LIVE-handling ca. 2026-05-15** — efter race-kalender er gemt: `/admin` → `Sæson-cyklus` → `Udfør sæsonskifte`.
3. **Aabne PRs kan kraeve gitleaks re-run** — #292, #277, #215, #213, #212, #211, #127 oprettet før gitleaks blev required. `gh pr checks` viser om job mangler; re-trigger via empty commit eller `gh workflow run secret-scan.yml --ref <branch>`.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
