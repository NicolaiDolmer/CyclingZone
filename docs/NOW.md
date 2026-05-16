# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen aktiv slice** — i18n Fase 2 (#411) LIVE per 2026-05-16. Næste session vælger fra prioriteret liste nedenfor.

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-16: **[#364](https://github.com/NicolaiDolmer/CyclingZone/issues/364) Survey-CTA-banner ([#456](https://github.com/NicolaiDolmer/CyclingZone/pull/456)).** Banner på Dashboard, gated bag admin-preview indtil Tally-URL klar. Genbrugelig `app_config`-tabel (RLS: read=auth, write=admin). Flip-protokol (uden re-deploy): `UPDATE app_config SET value='"<tally-url>"'::jsonb WHERE key='survey_banner_url'` + `value='true'::jsonb WHERE key='survey_banner_enabled'`. **Husk PatchNotes-entry ved flag-flip.**
- 2026-05-16: **[#411](https://github.com/NicolaiDolmer/CyclingZone/issues/411) i18n Fase 2 LIVE ([#444](https://github.com/NicolaiDolmer/CyclingZone/pull/444) → `dac4d9e`).** Login/Signup/Reset-password/Setup-wizard/Onboarding/NavBar/sidebar alle EN/DA. `auth.json` (75+ keys) + `errors.json` bundlet inline ([postmortem](../.claude/learnings/2026-05-16-i18n-lazy-ns-rerender-fouc.md) re FOUC). Signup sender `options.data.language` → DB-sync. Alle 4 brugerverifikations-items verificeret på prod ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/pull/444#issuecomment-4467644990)). PatchNotes v3.47. Follow-ups: #446/#447/#448 + #445 (`.env.production` → publishable key, lukker #296 follow-up).
- 2026-05-16: **[#410](https://github.com/NicolaiDolmer/CyclingZone/issues/410) i18n Fase 1 foundation MERGED ([#437](https://github.com/NicolaiDolmer/CyclingZone/pull/437) → main `9c3d09d`).** react-i18next + ICU + `users.language` + LanguageSwitcher. Prereq for Fase 5 lint-guard: [#438](https://github.com/NicolaiDolmer/CyclingZone/issues/438) `ml-*`/`mr-*` → `ms-*`/`me-*`.

Ældre 2026-05-16-entries (#361 landing page, #362/#363 waitlist, PR-batch, #334 cache) arkiveret i [`archive/NOW_HISTORIK_2026-05-16-i18n-fase-2-live.md`](archive/NOW_HISTORIK_2026-05-16-i18n-fase-2-live.md). 2026-05-15: [`archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md`](archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md) + [`NOW_HISTORIK_2026-05-15-issue-373.md`](archive/NOW_HISTORIK_2026-05-15-issue-373.md).

## Næste session (prioriteret)
1. **[#446](https://github.com/NicolaiDolmer/CyclingZone/issues/446) signup bootstrap silent fail** ⭐ Fundet under #444-verifikation: nye signups lander i Setup-wizard fordi `PUT /api/teams/my` fejler stille. Cosmetic UX-regression der ramler nye brugere. Quick win.
2. **[#448](https://github.com/NicolaiDolmer/CyclingZone/issues/448) Vercel Preview env** — fjerner skrøbelighed: tilføj `VITE_SUPABASE_ANON_KEY` til Preview-scope i dashboard. Lukker #296 follow-up endeligt.
3. **i18n Fase 3 — Dashboard** (separat slice fra #444 out-of-scope). Dashboard-cards, sidebar online-count, balance-formatering på alle pages. Bygger på #410 + #411 foundation.
4. **[#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415) Discord community-opsætning.** Epic + 16 sub-issues (#416-431). Blokeret på bot-invite til server `1504615050831466669`. Fase 1: #416-420.
5. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.
