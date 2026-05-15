# NOW historik — 2026-05-15 før #373 close-out

Arkiveret for at holde `docs/NOW.md` under 30 linjer efter #373 dependency hygiene.

## Aktiv slice
**AI/Ops token-reduktion (scalable-wobbling-blossom)** — Phase 1-4 leveret 2026-05-14. Phase 2+3 venter brugerens manuelle disable-handlinger per [`AI_OPS_DISABLE_PLAYBOOK.md`](../AI_OPS_DISABLE_PLAYBOOK.md).

> **Parallelt forretningsspor (ikke aktiv slice):** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](../SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](../BUSINESS_STRATEGY.md). Codex får tekniske implementerings-issues.

## Senest leveret
- 2026-05-15: **[#376](https://github.com/NicolaiDolmer/CyclingZone/issues/376) WebKit Playwright-projekt åbnet** som opfølgning på #367 — permanent iOS Safari-engine-coverage i CI (bruger har ikke iPhone).
- 2026-05-15: **#367 Mobile UX-verify T-1 før Discord-launch — GRØN.** Playwright mobile-chromium (Pixel 5, 393×852) kører på alle 8 ruter (`/`, `/dashboard`, `/auctions`, `/board`, `/riders`, `/team`, `/finance`, `/seasons` via `/notifications`-prefix) uden snapshot-diff. Tilføjet eksplicit `/` redirect-assertion til `core-smoke.spec.js`. Ingen layout-regressions detekteret; existing baseline-snapshots stadig matchende. Desktop-suite også grøn. Prod-verify efter push.
- 2026-05-15: **#332 restore-drill 1 attempt 1 — AFBRUDT, men leverede den rigtige værdi.** Drill afslørede at prod kører **Free tier uden automatiserede backups eller PITR** — der er reelt intet at restore. 9 runbook-bugs fixet inline (commit feff217). Risk-accept til 2026-05-29 tracked i [#375](https://github.com/NicolaiDolmer/CyclingZone/issues/375) (`risk:high`, `needs-decision`). Drill 2 pre-reqs i [#374](https://github.com/NicolaiDolmer/CyclingZone/issues/374) suspended indtil DR-strategi besluttet.
- 2026-05-15: **PR-triage** — #369 (vite 8.0.13) merged; #370 (GHA bumps v4→v6/v5→v7) auto-merge queued; #371 (Vercel-bot Analytics) lukket pga. GDPR-regression (`inject()` ubetinget i main.jsx før consent); erstattet af #372 med `VercelAnalyticsIntegration` consent-gated som `SpeedInsightsIntegration`/`ClarityIntegration`. #368 (express-rate-limit MAJOR v7→v8) + #358 (plugin-disable, konflikt) parket.
- 2026-05-15: **Backlog-prioritering + luk-batch live** — `docs/BACKLOG_PRIORITIZED.md` kategoriserer alle 142 åbne issues på 3 akser (værdi V1-V8 / tid / blocker) mod fuldtidsmål. 8 verificeret-done issues lukket (#315, #82, #86, #137, #235, #52, #44, #284 → 150→142). Top 10 highest-leverage identificeret + AI/automation-konflikter (#75-78, #73, #154) flagget til juni-juli for at undgå sprint-crowd. Yderligere 7 luk-kandidater triaged + lukket (#178 polish-sprint, #79 Slice 07 parent, #74 cross-PC migration, #28 reset-checklist; #41/#38 auktion-superseded; #39 vægt/højde-wontfix) → 142→135. #313/#311/#309/#314 holdt åbne som `needs-decision`-backlog.
- 2026-05-14: **Sprint-validation kick-off klar** — 9 GitHub-issues #359-#367 oprettet med fuld spec; uge 1 calendar (13 events) live inkl. T-1 mobile-verify søn 17/5; Decision log udvidet med self-research-track + 3 housekeeping-beslutninger.
- 2026-05-14: **Token-reduktion Phase 1-4** — MEMORY.md skåret 109→40 linjer (~3,150 tok); CLAUDE.md slanket + reference-tabel flyttet til `META_DOCS_INDEX.md`; game-invariants flyttet til `GAME_INVARIANTS.md`; quality-canaries + disable-playbook + tier-system docs oprettet; `check-agent-token-hygiene.ps1` udvidet med JSON-baseline.
- 2026-05-14: **Audit-feedback follow-up** — `docs/decisions/cache-adr.md` vælger Upstash Redis for #334; `docs/AI_OPS_COST_MODEL.md` giver 5k/10k baseline for #332; `docs/AI_OPS_BLIND_SPOTS.md` samler restore-cadence/SLO/risici; `docs/decisions/secret-management-adr.md` bekræfter Infisical for #327/#339.
- 2026-05-13: **Zero-known-error hardening LIVE** — PR #345 merged; Drift Monitor, Quality Inbox, CI, CodeQL, Secret Scan og Deploy verify grønne på main.

## Næste session (prioriteret)
1. **[#373](https://github.com/NicolaiDolmer/CyclingZone/issues/373) Vite/plugin-react dependency hygiene** — kan startes nu hvor #367 er grøn, før nye sprint-features (#359-#365) eller dybere scaling (#334). Langsigtet værdi: clean Vite 8 dependency tree + stabil CI/build før mere frontend-arbejde.
2. **Brug AI_OPS_DISABLE_PLAYBOOK** — disconnect ubrugte MCP-connectors via claude.ai/settings/connectors; disable ubrugte plugin-skills via `/plugin`. Mål: cold-start <8K tok.
3. **#334 implementering** (Phase 0-1: P95 baseline + Redis-backed rate-limit). #332 ops-hardening parket på [#375](https://github.com/NicolaiDolmer/CyclingZone/issues/375)-revisit 2026-05-29.
4. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.

Game-invariants flyttet til [`GAME_INVARIANTS.md`](../GAME_INVARIANTS.md).
