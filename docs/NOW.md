# NOW — Aktuel arbejdsstatus

> **🟢 2026-05-28 close-out ([#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702)):** UCI scraperens high-value safety-gate fanger nu også matched-zero/upstream minimum-point matches (`points <= 5`) og genbruger protection-pathen i stedet for at patche stjerner ned til minimum. Verification: `python -m unittest scripts.uci_scraper_test` grøn (27/27). PatchNotes v4.10 + postmortem tilføjet; ARCHITECTURE/FEATURE_STATUS afstemt.

> **🟢 2026-05-28 PCM handoff:** Bruger har importeret `dyn-cyclist-fkIDteam-FULL-COLUMN.txt` tilbage i PCM; importen virker, og der er kørt 6 løb efter import.

> **🟢 2026-05-27 close-out ([#711](https://github.com/NicolaiDolmer/CyclingZone/issues/711)):** Blank frontend-crash fallback erstattet med DA/EN fejlside, reload-knap, Sentry event-id og `frontend_error_kind` tags. Stale lazy-chunk deploy-fejl detekteres nu og får højst én sessionStorage-gated reload pr. release. Verification: targeted chunkErrors 5/5, frontend build grøn, lint uden nye errors (kun eksisterende warnings), lokal browser smoke på `/team` → login render uden console errors. PatchNotes v4.09 + postmortem tilføjet.

> **🟢 2026-05-27 close-out ([#667](https://github.com/NicolaiDolmer/CyclingZone/issues/667), PR [#703](https://github.com/NicolaiDolmer/CyclingZone/pull/703)):** dyn_cyclist fkIDteam sync Fase 1 — migration backfilder `teams.ai_source_id` for 17 manager-hold, og `scripts/sync-dyn-cyclist-teams.mjs` genererer paste-ready full column med cz-assignment + cleanup-evict. End-state: 16/17 PCM-tracked teams matcher CZ-roster præcis; Marco Tizza mangler i arket. 482 ændringer, audit-row `b4db5225-...`; Mikkel Bjerg→14 og Brunel→13 verificeret. Follow-ups: [#704](https://github.com/NicolaiDolmer/CyclingZone/issues/704), [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705), [#706](https://github.com/NicolaiDolmer/CyclingZone/issues/706).

> **🟢 2026-05-27 close-out (achievement board-plan fix):** `/api/achievements/check` håndterer nu parallelle `board_profiles` korrekt: completed non-baseline plans aggregeres via max satisfaction i stedet for gammel `.maybeSingle()` antagelse. PatchNotes v4.08 + postmortem + schema/docs-drift fixet. Verification: targeted achievement test, backend 750/750, backend `npm ci`, patchnotes check, frontend build.

> **🟢 2026-05-27 close-out (Manus AI):** 'P1 Smoke & Strategy' session indsat i [`docs/strategy/P1_SMOKE_STRATEGY_2026-05-27.md`](strategy/P1_SMOKE_STRATEGY_2026-05-27.md) efter runtime/GitHub-sammenligning. Loop A (Drift-monitor), B (Pre-push hook) og C (Postmortem) er verificeret i repoet; P0-blockers (S-01 til S-06) står leveret. Kritiske næste skridt: #705 (Supabase Key), #702 (UCI Safety-gate), #701 (Stale data monitor). PatchNotes ikke opdateret: strategisk audit.

> **📚 Arkiv:** Tidligere detaljer ligger i `docs/archive/NOW-2026-05-22.md` til `docs/archive/NOW-2026-05-26.md` samt relevante GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705) Supabase Key verification (Railway/Vercel) → [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) Stale-data monitor → [#706](https://github.com/NicolaiDolmer/CyclingZone/issues/706) Chris/Vestas mapping.

> **🤖 Working agent:** _Ingen aktiv session._
