# NOW — Aktuel arbejdsstatus

## Aktiv slice
**i18n Fase 1 foundation ([#410](https://github.com/NicolaiDolmer/CyclingZone/issues/410))** — react-i18next + ICU + `users.language`-kolonne + sync-trigger til auth-meta + LanguageSwitcher i sidebar + mobile topbar. Eksisterende 23 brugere backfilled til `'da'`. Klar til Fase 2 ([#411](https://github.com/NicolaiDolmer/CyclingZone/issues/411)) der oversætter Login + onboarding.

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-16: **[#410](https://github.com/NicolaiDolmer/CyclingZone/issues/410) i18n Fase 1 foundation leveret.** DB-migration (users.language + CHECK en/da + sync-trigger til auth.users.raw_user_meta_data) applied til prod — 23 brugere backfilled til 'da'. react-i18next + i18next-icu + HTTP backend installeret. LanguageProvider + useLanguage hook + Intl-wrappers (formatCurrency/Date/Number). LanguageSwitcher (🇩🇰/🇬🇧 dropdown) i sidebar-bunden + mobile topbar. Common.json bundlet inline → FOUC-fri first paint. `?pseudo=1` aktiverer en-XA pseudo-locale. `scripts/i18n-check-keys.mjs` + CI workflow (advisory). `docs/i18n/GLOSSARY.md` med 20+ termer. PatchNotes v3.46. ESLint ml-*/mr-* deferred til Fase 5 (#414) — warning-budget på 26 vs 59 eksisterende sites.
- 2026-05-16: **Sprint-validation foundation komplet — landing page #361 merged ([#436](https://github.com/NicolaiDolmer/CyclingZone/pull/436)).** `/founder-supporter` er nu fuld landing page (hero, fair-løfte, 4-tier sammenligning, "må sælges vs IKKE"-tabel, Founder benefits, FAQ, embedded form). DA/EN-toggle via `?lang=en` oversætter hele siden + formen. `?variant=A|B|C` ændrer Supporter-pris dynamisk (annual = monthly × 10). OpenGraph + 1200×630 SVG OG-image. `validateForm`/`mapInsertError` lang-aware (default `"da"` backwards-compat); 35/35 tests grønne. **Prod verificeret** (`fe4641e` 200 OK + ny OG-meta + ny JS-bundle hash). PatchNotes v3.45.
- 2026-05-16: **[#362](https://github.com/NicolaiDolmer/CyclingZone/issues/362) waitlist-form + [#363](https://github.com/NicolaiDolmer/CyclingZone/issues/363) admin-dashboard live** (foundation-pair før #361). Form: kontakt+interest+tier+benefits+country, UTM-capture, `Prefer: return=minimal` (anon RLS-safe), honeypot, 24 unit-tests + 7/7 #359-regression. Admin `/admin/waitlist`: tabel, 5 filtre, 5 KPI-kort, CSV-export. PatchNotes v3.43+v3.44.
- 2026-05-16: **PR-batch (6 merged, 1 lukket).** [#372](https://github.com/NicolaiDolmer/CyclingZone/pull/372) Vercel Analytics consent-gate (GDPR-fix vs bot-PR #371, PatchNotes 3.42), [#370](https://github.com/NicolaiDolmer/CyclingZone/pull/370)+[#368](https://github.com/NicolaiDolmer/CyclingZone/pull/368) deps, [#432](https://github.com/NicolaiDolmer/CyclingZone/pull/432)+[#433](https://github.com/NicolaiDolmer/CyclingZone/pull/433) NOW.md Discord+i18n prioritering, [#381](https://github.com/NicolaiDolmer/CyclingZone/pull/381) auto-heal `Where-Object` hook-bug ([postmortem](../.claude/learnings/2026-05-15-claude-settings-hook-bash-pwsh-pipe.md)). [#358](https://github.com/NicolaiDolmer/CyclingZone/pull/358) lukket som superseded af #382.
- 2026-05-16: **[#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) cache prod-verification GRØN.** Synthetic 5x `/api/riders?limit=20`: hit-rate 80%, hit-latency -83.6% (665ms→~109ms). Alle 4 gates opfyldt, klar til close.

2026-05-15-entries arkiveret i [`archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md`](archive/NOW_HISTORIK_2026-05-16-sprint-validation-foundation.md) (#359 foundation, #312/#255/#8/#223/#308 user-features, #390 time-tracking, #382 token-cut, #334 cache, #373 deps). Endnu ældre: [`archive/NOW_HISTORIK_2026-05-15-issue-373.md`](archive/NOW_HISTORIK_2026-05-15-issue-373.md).

## Næste session (prioriteret)
1. **Landing page user-verifikation** — kør Lighthouse på prod `/founder-supporter` (target Performance ≥ 90, Accessibility ≥ 95, SEO ≥ 90), test OG-preview i Discord-test-kanal, mobil-touch. Luk [#361](https://github.com/NicolaiDolmer/CyclingZone/issues/361) ved grønt lys (label allerede `claude:done`).
2. **[#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415) Discord community-opsætning.** Epic + 16 sub-issues (#416-431). Blokeret på bot-invite til server `1504615050831466669`. Fase 1: #416-420.
3. **[#411](https://github.com/NicolaiDolmer/CyclingZone/issues/411) i18n Fase 2 — Critical path.** LoginPage, NavBar (delvist gjort i #410 — common.json dækker), Onboarding-modaler, fejlbeskeder. Bygger på `useTranslation('common'|'auth'|'errors')`-mønstret etableret i Fase 1.
4. **[#382](https://github.com/NicolaiDolmer/CyclingZone/issues/382) close-out** — Anden PC: kør `pwsh -File scripts/link-onedrive-context.ps1` så `~/.claude/settings.json` hardlinkes til OneDrive-versionen.
5. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)); aktivér Sentry secrets ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).

## Skalerings-roadmap
- [x] **Fase 1: Bulletproof Baseline** — zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automated tests + audit-feedback omsat til ADRs.
- [ ] **Fase 3: Secret mgmt + Cache scaling** — #339 Infisical · #334 cache-ADR · #333 Realtime.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook.
