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
- 2026-05-11: **#297 Consent management framework LIVE som v3.18** — cookie-banner med 4 kategorier (Nødvendig/Analyse/Marketing/E-mail), `useConsent()` hook, `/privatlivspolitik` side, ProfilePage > Privatliv-sektion. Microsoft Clarity gates på Analyse-consent; custom tags `manager_id`/`division`/`season_number`; `data-clarity-mask` på email + Discord-ID. DB-migration `users.consent_preferences JSONB` applied. #52-restscope (Clarity AC) leveret som del af samme PR. `docs/clarity/README.md` weekly review template klar. Squash `9aea6de`.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242)) — vælg sæson 1, race-dage 60, behold WT-eksklusion, generér forslag, gem. Bruger klikker selv sæson-cyklus senere. **Deadline ~2026-05-15.**
2. **Manuel prod-verifikation af Slice 09** — `/races?tab=world` viser 97 løb m. klassefilter; preview returnerer 30-60 ProSeries-løb til sæson 1.
3. **Sæson 1 LIVE-handling ca. 2026-05-15** — efter race-kalender er gemt og datoen rammer: `/admin` -> `Sæson-cyklus` -> `Udfør sæsonskifte`.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
