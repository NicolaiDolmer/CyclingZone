# NOW — Aktuel arbejdsstatus

## Aktiv slice
Sprint-validation foundation: tabel `founder_supporter_waitlist` + RLS live ([#359](https://github.com/NicolaiDolmer/CyclingZone/issues/359)). Unblocker [#361](https://github.com/NicolaiDolmer/CyclingZone/issues/361) landing page, [#362](https://github.com/NicolaiDolmer/CyclingZone/issues/362) form og [#363](https://github.com/NicolaiDolmer/CyclingZone/issues/363) admin-dashboard til uge 3 (1-7 juni).

> **Parallelt forretningsspor:** Monetization Validation Sprint starter 2026-05-18. Live status i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

## Senest leveret
- 2026-05-15: **[#359](https://github.com/NicolaiDolmer/CyclingZone/issues/359) Founder Supporter waitlist-tabel + RLS.** `founder_supporter_waitlist` med Manus' 9-felts intent-schema (interest_level + preferred_tier + valued_benefits + fairness_red_line + follow_up_consent), GDPR `consent_given_at NOT NULL`, generated `intent_score` (1-5 efter Manus-formel), workflow-status og genbrugelig `is_admin()`-helper. RLS: anon/authenticated INSERT med consent-check, admin-only SELECT, service_role for mutation. 10/10 intent_score-matrix + 7/7 constraint-tests grønne via prod `BEGIN/ROLLBACK`. TS-types regenereret; ingen ERROR-level advisors. Migration markeret applied i `schema_migrations` (auto-migrate skipper). Backend-only — ingen PatchNotes-entry (foundation, ingen UI endnu).
- 2026-05-15: **[#312](https://github.com/NicolaiDolmer/CyclingZone/issues/312) Indbakke aggregerer overbud-notifikationer.** Gentagne `auction_outbid` på samme auktion stables nu til én boble med tæller, første+seneste timestamp og expanderbar historik. Aggregat skjules når auktionen afsluttes (`auction_won`/`auction_lost`). Client-side i `frontend/src/lib/groupNotifications.js` (12 unit-tests grønne), ingen DB-migration. Bobby2106's Discord-feedback adresseret (PatchNotes v3.38).
- 2026-05-15: **[#255](https://github.com/NicolaiDolmer/CyclingZone/issues/255) Manager-navn under holdnavn.** /team og /teams viser nu manager-navn som undertekst. Frontend-smoke maxDiffPixelRatio: 0.03 tolerance så små intentional UI-tilføjelser ikke fejler (PatchNotes v3.37).
- 2026-05-15: **[#8](https://github.com/NicolaiDolmer/CyclingZone/issues/8) Ryttere-filtre persisterer.** Filtre encodes i URL via `useSearchParams` + `sessionStorage` fallback. Pure helper `ridersUrlState.js` med 11 unit-tests (PatchNotes v3.36).
- 2026-05-15: **[#223](https://github.com/NicolaiDolmer/CyclingZone/issues/223) Hall of Fame Managers-fane navne.** Viser nu manager-/holdnavn med fallback til teams.name; rækker linker til holdets profil (PatchNotes v3.35).
- 2026-05-15: **[#308](https://github.com/NicolaiDolmer/CyclingZone/issues/308) Indstillinger flyttet til bunden af sidebaren.** Sidebar `BOTTOM_ITEMS` indeholder nu Indstillinger sammen med Hjælp & Regler og Patch Notes; Klubhus-gruppen er trimmet tilsvarende (PatchNotes v3.34).
- 2026-05-15: **[#390](https://github.com/NicolaiDolmer/CyclingZone/issues/390) Time-tracking system MVP live.** `scripts/time-tracker/report.mjs` parser Claude/Codex/Manus-sessions og krydsrefererer GitHub-issue `cat:*`-labels (6 nye: user-feature/bug/infra/community/ai-ops/founder). Heuristisk backfill labelled 264 issues. W20-rapport: 75% in-business, 21% on-business, 4% meta — 45% infra-tung uge. Output: [`docs/metrics/time-2026-W20.md`](metrics/time-2026-W20.md).
- 2026-05-15: **[#382](https://github.com/NicolaiDolmer/CyclingZone/issues/382) Phase 3 token-cut + Claude/Codex målings-split — verificeret NICOLAIPC.** `code-modernization` plugin disabled, målt -203 tok (projekteret -490 var overestimat). Hygiene-script splittet til separate Claude/Codex cold-start metrics — AGENTS.md auto-loades kun af Codex, ikke Claude. `~/.claude/settings.json` OneDrive-hardlinked for cross-PC plugin-sync. Anden PC mangler stadig link-script-run.
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
