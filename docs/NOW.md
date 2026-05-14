# NOW — Aktuel arbejdsstatus

## Aktiv slice
**AI/Ops token-reduktion (scalable-wobbling-blossom)** — Phase 1-4 leveret 2026-05-14. Phase 2+3 venter brugerens manuelle disable-handlinger per [`AI_OPS_DISABLE_PLAYBOOK.md`](AI_OPS_DISABLE_PLAYBOOK.md).

## Senest leveret
- 2026-05-14: **Token-reduktion Phase 1-4** — MEMORY.md skåret 109→40 linjer (~3,150 tok); CLAUDE.md slanket + reference-tabel flyttet til `META_DOCS_INDEX.md`; game-invariants flyttet til `GAME_INVARIANTS.md`; quality-canaries + disable-playbook + tier-system docs oprettet; `check-agent-token-hygiene.ps1` udvidet med JSON-baseline.
- 2026-05-14: **Audit-feedback follow-up** — `docs/decisions/cache-adr.md` vælger Upstash Redis for #334; `docs/AI_OPS_COST_MODEL.md` giver 5k/10k baseline for #332; `docs/AI_OPS_BLIND_SPOTS.md` samler restore-cadence/SLO/risici; `docs/decisions/secret-management-adr.md` bekræfter Infisical for #327/#339.
- 2026-05-13: **Zero-known-error hardening LIVE** — PR #345 merged; Drift Monitor, Quality Inbox, CI, CodeQL, Secret Scan og Deploy verify grønne på main.

## Næste session (prioriteret)
1. **Brug AI_OPS_DISABLE_PLAYBOOK** — disconnect ubrugte MCP-connectors (Clarity/Drive/Gmail/Calendar/Control_Chrome/mcp-registry) via claude.ai/settings/connectors; disable ubrugte plugin-skills via `/plugin`. Mål: cold-start <8K tok.
2. **#334 implementering** (Phase 0-1: P95 baseline + Redis-backed rate-limit) ELLER **#332 ops-hardening** (restore-drill runbook).
3. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).
4. Ryd quality-net follow-ups: [#347](https://github.com/NicolaiDolmer/CyclingZone/issues/347), [#346](https://github.com/NicolaiDolmer/CyclingZone/issues/346), [#349](https://github.com/NicolaiDolmer/CyclingZone/issues/349), [#353](https://github.com/NicolaiDolmer/CyclingZone/issues/353).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.

Game-invariants flyttet til [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md).
