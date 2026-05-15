# NOW — Aktuel arbejdsstatus

## Aktiv slice
Ingen aktiv kode-slice efter #373 close-out.

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-15: **[#382](https://github.com/NicolaiDolmer/CyclingZone/issues/382) Phase 3 token-cut + Claude/Codex målings-split.** `code-modernization` plugin disabled (-490 tok). Hygiene-script splittet til separate Claude/Codex cold-start metrics — AGENTS.md auto-loades kun af Codex, ikke Claude. `~/.claude/settings.json` nu OneDrive-hardlinked for cross-PC plugin-sync.
- 2026-05-15: **`cross-pc-forensic-audit.ps1` hardlink-detektion fixet (`4067c92`).** `pwsh` 7's tomme `LinkType` for hardlinks flag'ede korrekt-linkede filer som orphan; fix bruger `fsutil hardlink list`.
- 2026-05-15: **`.codex.local/` ryddet — forensic audit GRØN.** 26 lokal-only filer verificeret som duplikater og slettet; token-baselines flyttet til `docs/metrics/`.
- 2026-05-15: **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) Phase 0+1 cache verified + hardened.** Codex fiksede query-key collision + in-flight invalidation race, backend `npm test` 619/619 grønne.
- 2026-05-15: **[#373](https://github.com/NicolaiDolmer/CyclingZone/issues/373) Vite/plugin-react dependency hygiene — GRØN.** `@vitejs/plugin-react` opgraderet til `^6.0.2`, clean Vite 8 tree.

Ældre entries (#376/#367/#332 + før-#373) er arkiveret i [`archive/NOW_HISTORIK_2026-05-15-issue-373.md`](archive/NOW_HISTORIK_2026-05-15-issue-373.md).

## Næste session (prioriteret)
1. **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) prod close-out** — aflæs `/api/admin/cache-stats` + Sentry efter 24-48t. Hvis riders hit-rate >70%, hit-latency -40%, og ingen stale-data incidents: Nicolai kan lukke som verified.
2. **[#382](https://github.com/NicolaiDolmer/CyclingZone/issues/382) close-out** — Anden PC: kør `pwsh -File scripts/link-onedrive-context.ps1` så `~/.claude/settings.json` hardlinkes til OneDrive-versionen (code-modernization disable rammer derefter automatisk). Verificér via session-start: ingen `code-modernization:*` skills i listen.
3. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.
