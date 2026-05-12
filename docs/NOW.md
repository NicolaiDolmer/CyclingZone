# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Teknisk hardening efter #325/#326-close-out.** Ny koordineringsmodel: brug korte kommandoer som `Prepare #327`, `Dispatch #327` og `Review agent queue`; Manus skriver handoff/labels i GitHub jf. `docs/AGENT_DISPATCH.md`. Aktiv prioritet er [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) secret management ADR → [#328](https://github.com/NicolaiDolmer/CyclingZone/issues/328) rate limiting → [#329](https://github.com/NicolaiDolmer/CyclingZone/issues/329) Playwright smoke/visual regression.

## Senest leveret
- 2026-05-12: **#327 Infisical migration implementeret** — `link-onedrive-context.ps1` håndterer kun memory+AI-context nu; `setup-new-pc.ps1` + `CROSS_PC_SETUP.md` + `HOOKS.md` opdateret med Infisical bootstrap-flow; `agent-doctor.ps1` tjekker Infisical CLI. Prod-secrets (.env, .mcp.json) er fjernet fra OneDrive-linking.
- 2026-05-12: **#327 secret-management ADR prepared** — `docs/decisions/secret-management-adr.md` vælger Infisical-first model; implementering afventer Nicolai approval i GitHub-issue.
- 2026-05-12: **Agent Dispatch Playbook LIVE** — `docs/AGENT_DISPATCH.md`, `docs/GITHUB_WORKFLOW.md` og GitHub-labels `agent:*`, `manual:user`, `needs-dispatch` indført, så brugeren ikke copy-paster prompts mellem agenter.
- 2026-05-12: **#325 runtime-audits verificeret + lukket** — RPCs deployed, RLS workflow grøn; follow-ups #335/#336/#337 filed. Lokal `agent-doctor`-warning skyldes legacy JWT, ikke missing RPCs.
- 2026-05-12: **Scaling Session 2: AI-Autopilot Fase 2 LIVE** — `ci.yml` opdateret med spec-reportere. `AGENTS.md` og `GUARDRAILS_CORE.md` opdateret med Manus-orkestrerings-regler (Loop D/F).
- 2026-05-12: **Scaling Session 1: Bulletproof Baseline LIVE** — Loop A (Drift-monitor) implementeret i `backend/scripts/driftMonitor.js`. Daglig cron 03:00 UTC.
- 2026-05-12: **#63 /compare opdagelig som v3.24** + **#316 TeamLink-rollout LIVE som v3.23**.

## Næste session (prioriteret)
1. **[#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) Professional Secret Management** — afventer Nicolai approval af ADR; dispatch først derefter.
2. **[#328](https://github.com/NicolaiDolmer/CyclingZone/issues/328) Backend rate limiting** — efter #327-approval eller hvis #327 parkeres.
3. **[#329](https://github.com/NicolaiDolmer/CyclingZone/issues/329) Playwright smoke + light visual regression** — Codex-egnet efter security-spor afklaret.
4. **#325 follow-ups (lav prioritet):** #335 whitelist, #336 diagnostik-refactor, #337 manuel env-rotation.
5. **[#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242) parkeret til ca. 2026-05-14/15** — admin vælger sæson 1-kalender via `Race-katalog` før `Sæson-cyklus`.

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
