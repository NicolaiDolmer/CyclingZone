# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Teknisk hardening efter #325/#326-close-out.** Koordinering via `docs/AGENT_DISPATCH.md`. [#329](https://github.com/NicolaiDolmer/CyclingZone/issues/329) Playwright smoke er implementeret på branch `codex/issue-329-playwright-smoke` og klar til PR/review. [#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 dashboard-setup er parkeret til Nicolai har tid (manuel, ikke blokerende).

## Senest leveret
- 2026-05-13: **#329 Playwright smoke + light visual regression klar til review som v3.27** — mocket Supabase/backend-fixture uden live secrets, desktop+mobile screenshots for 8 kerneflader, ny Windows PR-check `.github/workflows/playwright-smoke.yml`. Lokal verifikation: `npm run test:e2e`, `npm test -- --test-reporter=spec`, `npm run lint`, `npm run build`.
- 2026-05-13: **#328 Backend rate limiting LIVE som v3.26** — 5 navngivne limiters, per-user buckets efter auth, `trust proxy=1`, break-glass `RATE_LIMIT_DISABLED=1`.
- 2026-05-12: **Agent Dispatch + AI-Autopilot Fase 2 LIVE** — dispatch-playbook, GitHub issue task-lag, spec-reportere og Manus Loop D/F-regler.

## Næste session (prioriteret)
1. **Review/merge #329 PR** — bekræft GitHub Playwright Smoke + eksisterende CI, derefter luk issue #329.
2. **[#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 manuel** — Nicolai opretter dashboard + indtaster secrets når der er tid; ikke blokerende.
3. **#325 follow-ups (lav prioritet):** #335, #336, #337.
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
