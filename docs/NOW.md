# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Mellem-tilstand efter #325-close-out.** Næste technical slice er [#326](https://github.com/NicolaiDolmer/CyclingZone/issues/326) (docs-afstem) eller [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) (secret management ADR) — afventer brugerbeslutning. #325 lukket som `claude:done`: RPCs deployed (5/5), RLS audit grøn ([run 25754209635](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25754209635)), feature-liveness fejler kun på Detector E whitelist-gap ([run 25754211228](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25754211228)).

## Senest leveret
- 2026-05-12: **#325 runtime-audits verificeret + lukket** — 3 helper-SQL applied, 5 RPCs i `pg_proc`, RLS workflow grøn. 3 follow-ups filed: #335 (Detector E whitelist), #336 (audit-script diagnostik), #337 (lokal `backend/.env` rotation post-#296). Lokal `agent-doctor`-warning er konsekvens af legacy JWT i lokal env, ikke missing RPCs.
- 2026-05-12: **Scaling Session 2: AI-Autopilot Fase 2 LIVE** — `ci.yml` opdateret med spec-reportere. `AGENTS.md` og `GUARDRAILS_CORE.md` opdateret med Manus-orkestrerings-regler (Loop D/F).
- 2026-05-12: **Scaling Session 1: Bulletproof Baseline LIVE** — Loop A (Drift-monitor) implementeret i `backend/scripts/driftMonitor.js`. Daglig cron 03:00 UTC.
- 2026-05-12: **#63 /compare opdagelig som v3.24** + **#316 TeamLink-rollout LIVE som v3.23**.

## Næste session (prioriteret)
1. **Brugerbeslutning: [#326](https://github.com/NicolaiDolmer/CyclingZone/issues/326) (docs-afstem) eller [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) (secret management ADR)** — én af de to er aktiv næste slice.
2. **[#328](https://github.com/NicolaiDolmer/CyclingZone/issues/328) Backend rate limiting** — efter #327-beslutning.
3. **[#329](https://github.com/NicolaiDolmer/CyclingZone/issues/329) Playwright smoke + light visual regression** — Codex-egnet efter security-spor afklaret.
4. **#325 follow-ups (lav prioritet):** #335 (Codex-fix, 5-liners whitelist), #336 (diagnostik-refactor), #337 (manuel env-rotation, blokerer kun lokal agent-doctor).
5. **[#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242) parkeret til ca. 2026-05-14/15** — admin skal vælge sæson 1-kalender via `Race-katalog` på `/admin` før `Sæson-cyklus`.

## Skalerings-Roadmap (Mod 100+ brugere)
- [x] **Fase 1: Bulletproof Baseline** — Loop A (Drift-monitor) aktiv. Ingen trial-risici (Vercel/Supabase monitorering).
- [x] **Fase 2: AI-Autopilot** — Automatiserede tests ved hvert push. Manus-orkestreret workflow.
- [ ] **Fase 2 hardening follow-ups** — #327/#328/#329 er aktiv prioritet efter #325-runtime-afklaring.
- [ ] **Fase 3: Professional Secret Management** — udføres via #327 ADR og efterfølgende implementering.
- [ ] **Fase 4: UX-Insight** — Loop I (Clarity) aktiv for at fange 100-bruger feedback.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
