# NOW — Aktuel arbejdsstatus

## Aktiv slice
**i18n Fase 3a (#412)** — Dashboard leveret i [PR #461](https://github.com/NicolaiDolmer/CyclingZone/pull/461) klar til review/merge. Auctions/Transfers/Help/Admin følger som 3b–3d under samme issue.

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-17: **i18n Fase 3a Dashboard ([PR #461](https://github.com/NicolaiDolmer/CyclingZone/pull/461), Refs [#412](https://github.com/NicolaiDolmer/CyclingZone/issues/412))** — DashboardPage + 5 indholds-kort + FinanceForecastCard/Badge + 2 onboarding-kort oversat EN/DA (112 keys/sprog). `dashboardSquadStats.warning` refaktoreret til pure data → ICU plurals i UI. `formatDate` udvidet med `style=null` for fine-grained Intl-options. **+ snapshot-test refactor:** `core-smoke.spec.js` masker nu tekst-elementer så fremtidige i18n-faser ikke break'er smoke ([learning](`.claude/learnings/2026-05-17-visual-snapshots-layout-only.md`)). PatchNotes v3.51. CI alt grønt. Også klar: [PR #463](https://github.com/NicolaiDolmer/CyclingZone/pull/463) Discord ops-scripts flyttet `.claude/` → `scripts/discord/` (Refs #462).
- 2026-05-16: **Tier-1 bug-batch ([#458](https://github.com/NicolaiDolmer/CyclingZone/pull/458))** — 5 issues i én PR: [#446](https://github.com/NicolaiDolmer/CyclingZone/issues/446) signup-bootstrap (5s session-wait + forward-guard mod "Division undefined"), [#447](https://github.com/NicolaiDolmer/CyclingZone/issues/447) EN-locale privacy-link, [#258](https://github.com/NicolaiDolmer/CyclingZone/issues/258) mobil bud-historik, [#268](https://github.com/NicolaiDolmer/CyclingZone/issues/268) squad-cap dobbelttælling, [#252](https://github.com/NicolaiDolmer/CyclingZone/issues/252) João Almeida duplikat.
- 2026-05-16: **[#364](https://github.com/NicolaiDolmer/CyclingZone/issues/364) Survey-CTA-banner ([#456](https://github.com/NicolaiDolmer/CyclingZone/pull/456)).** Banner på Dashboard, gated bag admin-preview indtil Tally-URL klar. Genbrugelig `app_config`-tabel (RLS: read=auth, write=admin). Flip-protokol (uden re-deploy): `UPDATE app_config SET value='"<tally-url>"'::jsonb WHERE key='survey_banner_url'` + `value='true'::jsonb WHERE key='survey_banner_enabled'`. **Husk PatchNotes-entry ved flag-flip.**
- 2026-05-16: **DX/Automation sweep ([#73](https://github.com/NicolaiDolmer/CyclingZone/issues/73), [#75](https://github.com/NicolaiDolmer/CyclingZone/issues/75), [#76](https://github.com/NicolaiDolmer/CyclingZone/issues/76), [#77](https://github.com/NicolaiDolmer/CyclingZone/issues/77), [#154](https://github.com/NicolaiDolmer/CyclingZone/issues/154), [#380](https://github.com/NicolaiDolmer/CyclingZone/issues/380))** — 3 nye PreToolUse-hooks (gh-lint warning, NOW.md 30-linjer block, archived-paths block), Stop-hook auto-archive + Refs #N reminder, `audit-memory-dir.mjs` + growth-WARN, #154 verificeret som LIVE. PatchNotes v3.48.
- 2026-05-16: **[#411](https://github.com/NicolaiDolmer/CyclingZone/issues/411) i18n Fase 2 LIVE ([#444](https://github.com/NicolaiDolmer/CyclingZone/pull/444) → `dac4d9e`).** Login/Signup/Reset-password/Setup-wizard/Onboarding/NavBar/sidebar alle EN/DA. PatchNotes v3.47. Follow-ups: #446/#447/#448 + #445 (publishable key).
- 2026-05-16: **[#410](https://github.com/NicolaiDolmer/CyclingZone/issues/410) i18n Fase 1 foundation MERGED ([#437](https://github.com/NicolaiDolmer/CyclingZone/pull/437) → main `9c3d09d`).** react-i18next + ICU + `users.language` + LanguageSwitcher. Prereq for Fase 5 lint-guard: [#438](https://github.com/NicolaiDolmer/CyclingZone/issues/438) `ml-*`/`mr-*` → `ms-*`/`me-*`.

Ældre 2026-05-16-entries (#361 landing page, #362/#363 waitlist, PR-batch, #334 cache) arkiveret i [`archive/NOW_HISTORIK_2026-05-16-i18n-fase-2-live.md`](archive/NOW_HISTORIK_2026-05-16-i18n-fase-2-live.md). 2026-05-15: [`archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md`](archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md) + [`NOW_HISTORIK_2026-05-15-issue-373.md`](archive/NOW_HISTORIK_2026-05-15-issue-373.md).

## Næste session (prioriteret)
1. **[#412](https://github.com/NicolaiDolmer/CyclingZone/issues/412) i18n Fase 3b** — AuctionsPage (1376 linjer) + bid-modal + auction-rules-modal. Fortsætter under samme issue; PR-titel format `feat(i18n): Fase 3b — Auctions på EN/DA (Refs #412)`.
2. **[#448](https://github.com/NicolaiDolmer/CyclingZone/issues/448) Vercel Preview env** — kræver bruger-handling i Vercel-dashboard: tilføj `VITE_SUPABASE_ANON_KEY` til Preview-scope. Lukker #296 follow-up endeligt.
3. **[#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415) Discord community-opsætning.** Epic + 16 sub-issues (#416-431). Blokeret på bot-invite til server `1504615050831466669`. Fase 1: #416-420.
4. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.
