# NOW — Aktuel arbejdsstatus

## Aktiv slice
Sprint-validation foundation **KOMPLET**: tabel ([#359](https://github.com/NicolaiDolmer/CyclingZone/issues/359)) + form ([#362](https://github.com/NicolaiDolmer/CyclingZone/issues/362)) + admin-dashboard ([#363](https://github.com/NicolaiDolmer/CyclingZone/issues/363)) + landing page ([#361](https://github.com/NicolaiDolmer/CyclingZone/issues/361) i [PR #436](https://github.com/NicolaiDolmer/CyclingZone/pull/436)) klar til Monetization Validation Sprint 2026-05-18.

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-16: **Sprint-validation foundation komplet — landing page #361 merged ([#436](https://github.com/NicolaiDolmer/CyclingZone/pull/436)).** `/founder-supporter` er nu fuld landing page (hero, fair-løfte, 4-tier sammenligning, "må sælges vs IKKE"-tabel, Founder benefits, FAQ, embedded form). DA/EN-toggle via `?lang=en` oversætter hele siden + formen. `?variant=A|B|C` ændrer Supporter-pris dynamisk (annual = monthly × 10). OpenGraph + 1200×630 SVG OG-image. `validateForm`/`mapInsertError` lang-aware (default `"da"` backwards-compat); 35/35 tests grønne. **Prod verificeret** (`fe4641e` 200 OK + ny OG-meta + ny JS-bundle hash). PatchNotes v3.45.
- 2026-05-16: **[#362](https://github.com/NicolaiDolmer/CyclingZone/issues/362) waitlist-form + [#363](https://github.com/NicolaiDolmer/CyclingZone/issues/363) admin-dashboard live** (foundation-pair før #361). Form: kontakt+interest+tier+benefits+country, UTM-capture, `Prefer: return=minimal` (anon RLS-safe), honeypot, 24 unit-tests + 7/7 #359-regression. Admin `/admin/waitlist`: tabel, 5 filtre, 5 KPI-kort, CSV-export. PatchNotes v3.43+v3.44.
- 2026-05-16: **PR-batch (6 merged, 1 lukket).** [#372](https://github.com/NicolaiDolmer/CyclingZone/pull/372) Vercel Analytics consent-gate (GDPR-fix vs bot-PR #371, PatchNotes 3.42), [#370](https://github.com/NicolaiDolmer/CyclingZone/pull/370)+[#368](https://github.com/NicolaiDolmer/CyclingZone/pull/368) deps, [#432](https://github.com/NicolaiDolmer/CyclingZone/pull/432)+[#433](https://github.com/NicolaiDolmer/CyclingZone/pull/433) NOW.md Discord+i18n prioritering, [#381](https://github.com/NicolaiDolmer/CyclingZone/pull/381) auto-heal `Where-Object` hook-bug ([postmortem](../.claude/learnings/2026-05-15-claude-settings-hook-bash-pwsh-pipe.md)). [#358](https://github.com/NicolaiDolmer/CyclingZone/pull/358) lukket som superseded af #382.
- 2026-05-16: **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) cache prod-verification GRØN.** Synthetic 5x `/api/riders?limit=20`: hit-rate 80%, hit-latency -83.6% (665ms→~109ms). Alle 4 gates opfyldt, klar til close.

2026-05-15-entries arkiveret i [`archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md`](archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md) (#359 foundation, #312/#255/#8/#223/#308 user-features, #390 time-tracking, #382 token-cut, #334 cache, #373 deps). Endnu ældre: [`archive/NOW_HISTORIK_2026-05-15-issue-373.md`](archive/NOW_HISTORIK_2026-05-15-issue-373.md).

## Næste session (prioriteret)
1. **Landing page user-verifikation** — kør Lighthouse på prod `/founder-supporter` (target Performance ≥ 90, Accessibility ≥ 95, SEO ≥ 90), test OG-preview i Discord-test-kanal, mobil-touch. Luk [#361](https://github.com/NicolaiDolmer/CyclingZone/issues/361) ved grønt lys (label allerede `claude:done`).
2. **[#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415) Discord community-opsætning.** Epic + 16 sub-issues (#416-431). Blokeret på bot-invite til server `1504615050831466669`. Fase 1: #416-420.
3. **[#409](https://github.com/NicolaiDolmer/CyclingZone/issues/409) i18n EN-default + DK-version.** Epic + 5 sub-issues (#410-414). Start med [#410](https://github.com/NicolaiDolmer/CyclingZone/issues/410) Foundation (`risk:high` — DB-migration + auth-meta sync).
4. **[#382](https://github.com/NicolaiDolmer/CyclingZone/issues/382) close-out** — Anden PC: kør `pwsh -File scripts/link-onedrive-context.ps1` så `~/.claude/settings.json` hardlinkes til OneDrive-versionen.
5. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.
