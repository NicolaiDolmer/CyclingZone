# NOW — Aktuel arbejdsstatus

## Aktiv slice
Ingen aktiv kode-slice efter #373 close-out.

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-15: **`cross-pc-forensic-audit.ps1` hardlink-detektion fixet (`4067c92`).** `pwsh` 7's tomme `LinkType` for hardlinks flag'ede korrekt-linkede filer som orphan; fix bruger `fsutil hardlink list`. Postmortem: [`learnings/2026-05-15-cross-pc-audit-pwsh-hardlink-bug.md`](../.claude/learnings/2026-05-15-cross-pc-audit-pwsh-hardlink-bug.md).
- 2026-05-15: **`.codex.local/` ryddet — forensic audit GRØN.** 26 lokal-only filer verificeret som duplikater (Discord-drafts → issues #308-316, commit-buffere for landed commits) og slettet; token-baselines flyttet til `docs/metrics/`.
- 2026-05-15: **Agent context-disciplin rettet til cross-device workflow.** `AGENTS.md`/`CLAUDE.md`/cross-PC-docs præciserer at varig context kun må ligge i GitHub eller OneDrive-context — `.codex.local/` er kun regenererbar cache.
- 2026-05-15: **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) Phase 0+1 cache verified + hardened.** Codex fiksede query-key collision + in-flight invalidation race, backend `npm test` 619/619 grønne; metrics + GO/NO-GO i [issue-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/334#issuecomment-4458418897).
- 2026-05-15: **[#373](https://github.com/NicolaiDolmer/CyclingZone/issues/373) Vite/plugin-react dependency hygiene — GRØN.** `@vitejs/plugin-react` opgraderet til `^6.0.2`, clean Vite 8 tree; ingen PatchNotes (intet brugerrettet ændret).

Ældre entries (#376/#367/#332 + før-#373) er arkiveret i [`archive/NOW_HISTORIK_2026-05-15-issue-373.md`](archive/NOW_HISTORIK_2026-05-15-issue-373.md).

## Næste session (prioriteret)
1. **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) prod close-out** — aflæs `/api/admin/cache-stats` + Sentry efter 24-48t. Hvis riders hit-rate >70%, hit-latency -40%, og ingen stale-data incidents: Nicolai kan lukke som verified.
2. **Brug AI_OPS_DISABLE_PLAYBOOK** — disconnect ubrugte MCP-connectors via claude.ai/settings/connectors; disable ubrugte plugin-skills via `/plugin`. Mål: cold-start <8K tok.
3. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.
