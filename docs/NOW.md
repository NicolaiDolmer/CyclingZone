# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Teknisk hardening efter #325/#326-close-out.** Koordinering via `docs/AGENT_DISPATCH.md`. Aktiv prioritet er [#328](https://github.com/NicolaiDolmer/CyclingZone/issues/328) backend rate limiting → [#329](https://github.com/NicolaiDolmer/CyclingZone/issues/329) Playwright smoke. [#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 dashboard-setup er parkeret til Nicolai har tid (manuel, ikke blokerende).

## Senest leveret
- 2026-05-12: **#327 Phase 6 LIVE som [PR #338](https://github.com/NicolaiDolmer/CyclingZone/pull/338) merged** — Infisical-first bootstrap-stien dokumenteret i `link-onedrive-context.ps1`/`setup-new-pc.ps1`/`CROSS_PC_SETUP.md`/`HOOKS.md`/`agent-doctor.ps1`/`AGENTS.md`. ADR `docs/decisions/secret-management-adr.md` godkendt af Nicolai. Phase 1 (manuel dashboard-setup) parkeret som #339.
- 2026-05-12: **Agent Dispatch Playbook LIVE** — `docs/AGENT_DISPATCH.md`, `docs/GITHUB_WORKFLOW.md` og GitHub-labels `agent:*`, `manual:user`, `needs-dispatch` indført, så brugeren ikke copy-paster prompts mellem agenter.
- 2026-05-12: **#325 runtime-audits verificeret + lukket** — RPCs deployed, RLS workflow grøn; follow-ups #335/#336/#337 filed. Lokal `agent-doctor`-warning skyldes legacy JWT, ikke missing RPCs.
- 2026-05-12: **Scaling Session 2: AI-Autopilot Fase 2 LIVE** — `ci.yml` opdateret med spec-reportere. `AGENTS.md` og `GUARDRAILS_CORE.md` opdateret med Manus-orkestrerings-regler (Loop D/F).
- 2026-05-12: **Scaling Session 1: Bulletproof Baseline LIVE** — Loop A (Drift-monitor) implementeret i `backend/scripts/driftMonitor.js`. Daglig cron 03:00 UTC.
- 2026-05-12: **#63 /compare opdagelig som v3.24** + **#316 TeamLink-rollout LIVE som v3.23**.

## Næste session (prioriteret)
1. **[#328](https://github.com/NicolaiDolmer/CyclingZone/issues/328) Backend rate limiting** — næste sikkerhedsslice, dispatch via Manus.
2. **[#329](https://github.com/NicolaiDolmer/CyclingZone/issues/329) Playwright smoke + light visual regression** — Codex-egnet.
3. **[#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 manuel** — Nicolai opretter dashboard + indtaster secrets når der er tid; ikke blokerende.
4. **#325 follow-ups (lav prioritet):** #335, #336, #337.
5. **[#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242) parkeret til ca. 2026-05-14/15** — admin vælger sæson 1-kalender via `Race-katalog` før `Sæson-cyklus`.

## Skalerings-Roadmap (Mod 100+ brugere)
- [x] **Fase 1: Bulletproof Baseline** — Loop A (Drift-monitor) aktiv. Ingen trial-risici (Vercel/Supabase monitorering).
- [x] **Fase 2: AI-Autopilot** — Automatiserede tests ved hvert push. Manus-orkestreret workflow.
- [ ] **Fase 2 hardening follow-ups** — #328/#329 aktiv prioritet; #327 Phase 6 done.
- [ ] **Fase 3: Professional Secret Management** — Phase 6 (bootstrap) LIVE; Phase 1 (#339) + Phase 3-5,7 udestående.
- [ ] **Fase 4: UX-Insight** — Loop I (Clarity) aktiv for at fange 100-bruger feedback.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
