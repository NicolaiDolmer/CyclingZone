# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Zero-known-error AI/Ops hardening er live.** Næste aktive ops-slice er manuel secret/Sentry-færdiggørelse (#337/#339).

## Senest leveret
- 2026-05-13: **Zero-known-error hardening LIVE** — PR #345 merged; Drift Monitor, Quality Inbox, CI, CodeQL, Secret Scan og Deploy verify er grønne på main efter hotfix commits `03cd64f`, `3456c79`, `2b43a07`. `agent-doctor.ps1 -Json` viser `0 fail`, #336 og #344 er lukket, og prod smoke er grøn (`/health` 200, `/api/auctions` uden token 401, frontend 200).
- 2026-05-13: **UCI approved overrides LIVE** — commit `35f1492` tilføjede sikre overrides for Benjamí Prades, Bjoern Koerdt, Joe Blackmore og Natnael Tesfazion samt force-minimum for Shu Chen og Frederik Wandahl. Manuel workflow-run [#25788991678](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25788991678) grøn: `matched=2513`, `updates=6`, `minimum_downgrades=2/869`, `high_value_protected=1` (kun Andrey André), 8699 historikrækker og 8699 rider values recalculated.
- 2026-05-13: **UCI full-DB sync LIVE** — commit `27d0d22` paginerer `riders` via Supabase Range headers. Manuel workflow-run [#25786818406](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25786818406) grøn: `Matcher 2999 UCI-ryttere mod 8699 DB-ryttere`, `matched=2509`, `updates=688`, `minimum_downgrades=40/869`, `high_value_protected=7`, 8699 historikrækker og 8699 rider values recalculated.
- 2026-05-13: **UCI Rankings Sync fix LIVE** — commit `6feab1f` flyttede schedule til onsdag 06:17 UTC og tilføjede `ws` transport til salary-recalc. Manuel workflow-run [#25785025763](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25785025763) grøn: 3000 Google Sheets-rækker, Supabase safety report OK, 1000 historikrækker, 8699 rider values recalculated.
- 2026-05-13: **#127 dotenv 17.4.2 merged efter quiet-loader gate** — PR #343 landede først med `quiet:true` på explicit dotenv loaders; #127 blev derefter opdateret mod main og merged med grøn CI.
- 2026-05-13: **#329 Playwright smoke + light visual regression lukket som v3.27** — PR #341 merged, CI grøn, product-verifikation gennemført: centrale sider loader som forventet.
- 2026-05-13: **#328 Backend rate limiting LIVE som v3.26** — 5 navngivne limiters, per-user buckets efter auth, `trust proxy=1`, break-glass `RATE_LIMIT_DISABLED=1`.

## Næste session (prioriteret)
1. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)) og aktivér Sentry secrets/test-events ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).
2. **[#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 manuel** — Nicolai opretter dashboard + indtaster secrets når der er tid.
3. Ryd quality-net follow-ups: Deploy verify runner/provider-status ([#347](https://github.com/NicolaiDolmer/CyclingZone/issues/347)) + Quality Inbox warning calibration ([#346](https://github.com/NicolaiDolmer/CyclingZone/issues/346)).
4. **[#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242) parkeret til ca. 2026-05-14/15** — admin vælger sæson 1-kalender via `Race-katalog` før `Sæson-cyklus`.

## Skalerings-Roadmap (Mod 100+ brugere)
- [x] **Fase 1: Bulletproof Baseline** — Loop A (Drift-monitor) aktiv. Ingen trial-risici (Vercel/Supabase monitorering).
- [x] **Fase 2: AI-Autopilot** — Automatiserede tests ved hvert push. Manus-orkestreret workflow.
- [x] **Fase 2 hardening follow-ups** — #327 Phase 6, #328 rate limiting og #329 Playwright smoke er implementeret/klar til merge; lavere #325-follow-ups kan tages senere.
- [ ] **Fase 3: Professional Secret Management** — Phase 6 (bootstrap) LIVE; Phase 1 (#339) + Phase 3-5,7 udestående.
- [ ] **Fase 4: UX-Insight** — Loop I (Clarity) aktiv for at fange 100-bruger feedback.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
