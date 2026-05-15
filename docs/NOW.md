# NOW — Aktuel arbejdsstatus

## Aktiv slice
Ingen aktiv kode-slice efter #373 close-out.

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-15: **`.codex.local/` ryddet — forensic audit GRØN.** 26 lokal-only filer verificeret som duplikater (7 Discord-drafts → issues #308-314, sub-issues #315-316, issue-bodies for #97/#332 allerede postet, 8 commit/PR-buffere for landed commits) og slettet. Token-baselines flyttet til `docs/metrics/` + CLAUDE.md reference opdateret. `cross-pc-forensic-audit.ps1` → `[clean]`.
- 2026-05-15: **Agent context-disciplin rettet til cross-device workflow.** `AGENTS.md`, `CLAUDE.md`, hooks- og cross-PC-docs præciserer nu at varig context kun må ligge i GitHub eller OneDrive-context; `.codex.local/SESSION_CONTEXT.md`, transcripts og Codex memories er kun regenererbare caches/pointers. Ingen PatchNotes: ingen spillerrettet app-adfærd/UI ændret.
- 2026-05-15: **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) Phase 0+1 cache verified + hardened.** Codex fandt/fiksede query-key collision + in-flight invalidation race, tilføjede integration/load-check coverage, og backend `npm test` er grøn (619/619). Lokal mock-load: P50 68.9→25.4 ms, P95 105.3→62.9 ms, Supabase-call-reduktion 100% på warm-cache. Prod-hit-rate/latency aflæses efter 24-48t via `/api/admin/cache-stats` + Sentry.
- 2026-05-15: **[#373](https://github.com/NicolaiDolmer/CyclingZone/issues/373) Vite/plugin-react dependency hygiene — GRØN.** `@vitejs/plugin-react` er opgraderet til `^6.0.2`, lockfile er refreshed, og `npm ls vite` viser clean Vite 8 tree. Verification: `npm test`, `npm run lint` (exit 0 med eksisterende warnings), `npm run build`. Ingen PatchNotes: ingen brugerrettet adfærd/UI ændret.
- 2026-05-15: **[#376](https://github.com/NicolaiDolmer/CyclingZone/issues/376) WebKit Playwright-projekt åbnet** som opfølgning på #367 — permanent iOS Safari-engine-coverage i CI.
- 2026-05-15: **#367 Mobile UX-verify T-1 før Discord-launch — GRØN.** Mobile Chromium og desktop snapshots grønne på core-ruter.
- 2026-05-15: **#332 restore-drill attempt 1 — afbrudt med læring.** Prod kører Free tier uden automatiserede backups/PITR; risk-accept tracked i #375, drill 2 pre-reqs i #374.

Historik før #373 er arkiveret i [`archive/NOW_HISTORIK_2026-05-15-issue-373.md`](archive/NOW_HISTORIK_2026-05-15-issue-373.md).

## Næste session (prioriteret)
1. **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) prod close-out** — aflæs `/api/admin/cache-stats` + Sentry efter 24-48t. Hvis riders hit-rate >70%, hit-latency -40%, og ingen stale-data incidents: Nicolai kan lukke som verified.
2. **Brug AI_OPS_DISABLE_PLAYBOOK** — disconnect ubrugte MCP-connectors via claude.ai/settings/connectors; disable ubrugte plugin-skills via `/plugin`. Mål: cold-start <8K tok.
3. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.
