# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Teknisk hardening efter #325/#326-close-out.** Koordinering via `docs/AGENT_DISPATCH.md`. #127 dotenv 17.4.2 er merged efter #343 `quiet:true`-hardening. [#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 dashboard-setup er parkeret til Nicolai har tid (manuel, ikke blokerende).

## Senest leveret
- 2026-05-13: **#127 dotenv 17.4.2 merged efter quiet-loader gate** — PR #343 landede først med `quiet:true` på explicit dotenv loaders; #127 blev derefter opdateret mod main og merged med grøn CI.
- 2026-05-13: **#329 Playwright smoke + light visual regression lukket som v3.27** — PR #341 merged, CI grøn, product-verifikation gennemført: centrale sider loader som forventet.
- 2026-05-13: **#328 Backend rate limiting LIVE som v3.26** — 5 navngivne limiters, per-user buckets efter auth, `trust proxy=1`, break-glass `RATE_LIMIT_DISABLED=1`.

## Næste session (prioriteret)
1. **#325 follow-ups:** #336 først (auth-fail vs RPC-missing), derefter #337 (roter lokal service-key til `sb_secret_*`).
2. **[#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 manuel** — Nicolai opretter dashboard + indtaster secrets når der er tid; ikke blokerende.
3. **[#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242) parkeret til ca. 2026-05-14/15** — admin vælger sæson 1-kalender via `Race-katalog` før `Sæson-cyklus`.

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
