# NOW — Aktuel arbejdsstatus

> **🟢 2026-05-27 close-out ([#711](https://github.com/NicolaiDolmer/CyclingZone/issues/711)):** Blank frontend-crash fallback erstattet med DA/EN fejlside, reload-knap, Sentry event-id og `frontend_error_kind` tags. Stale lazy-chunk deploy-fejl detekteres nu og får højst én sessionStorage-gated reload pr. release. Verification: targeted chunkErrors 5/5, frontend build grøn, lint uden nye errors (kun eksisterende warnings), lokal browser smoke på `/team` → login render uden console errors. PatchNotes v4.09 + postmortem tilføjet.

> **🟢 2026-05-27 close-out ([#706](https://github.com/NicolaiDolmer/CyclingZone/issues/706)):** Chris Machines → PCM-25 (TotalEnergies) + Vestas - Vov Vov → PCM-95 (Team UKYO) mapping anvendt. Migration udfylder de sidste 2 manager-hold (nu 19/19 med `ai_source_id`). Re-sync efter v2 paste: **52 ændringer** (19 cz-assignment for Chris/Vestas, 33 cleanup-evict af originale PCM-25/95 ryttere). End-state: **18/19 PCM-teams matcher CZ-roster præcis** — eneste mismatch er stadig Bahrain (8/9, Marco Tizza pcm_id=4044 mangler i arket). Paste-ready: `dyn-cyclist-fkIDteam-FULL-COLUMN-v3.txt` + `dyn-cyclist-DIFF-52-changes-v3.csv` i Downloads. Audit-row `b4f0a2ee-...`.

> **🟢 2026-05-27 close-out ([#667](https://github.com/NicolaiDolmer/CyclingZone/issues/667), PR [#703](https://github.com/NicolaiDolmer/CyclingZone/pull/703)):** dyn_cyclist fkIDteam sync Fase 1 — migration backfilder `teams.ai_source_id` for 17 manager-hold, og `scripts/sync-dyn-cyclist-teams.mjs` genererer paste-ready full column med cz-assignment + cleanup-evict. End-state: 16/17 PCM-tracked teams matcher CZ-roster præcis; Marco Tizza mangler i arket. 482 ændringer, audit-row `b4db5225-...`; Mikkel Bjerg→14 og Brunel→13 verificeret. Follow-ups: [#704](https://github.com/NicolaiDolmer/CyclingZone/issues/704), [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705), [#706](https://github.com/NicolaiDolmer/CyclingZone/issues/706).

> **🟢 2026-05-27 close-out (achievement board-plan fix):** `/api/achievements/check` håndterer nu parallelle `board_profiles` korrekt: completed non-baseline plans aggregeres via max satisfaction i stedet for gammel `.maybeSingle()` antagelse. PatchNotes v4.08 + postmortem + schema/docs-drift fixet. Verification: targeted achievement test, backend 750/750, backend `npm ci`, patchnotes check, frontend build.

> **🟢 2026-05-27 close-out (Manus AI):** 'P1 Smoke & Strategy' session indsat i [`docs/strategy/P1_SMOKE_STRATEGY_2026-05-27.md`](strategy/P1_SMOKE_STRATEGY_2026-05-27.md) efter runtime/GitHub-sammenligning. Loop A (Drift-monitor), B (Pre-push hook) og C (Postmortem) er verificeret i repoet; P0-blockers (S-01 til S-06) står leveret. Kritiske næste skridt: #705 (Supabase Key), #702 (UCI Safety-gate), #701 (Stale data monitor). PatchNotes ikke opdateret: strategisk audit.

> **🟢 2026-05-27 close-out (#657):** Lockfile drift check workflow tilføjet på `main` pushes der rører root/backend/frontend `package.json` eller `package-lock.json`: kører `npm ci` i alle tre workspaces, parser `agent-doctor` `install-parity`, og opretter/opdaterer markeret GitHub issue ved drift. Verification: actionlint grøn; `npm ci` root/backend/frontend grøn uden lockfile-diff; lokal `agent-doctor.ps1 -Json` viser `install-parity=OK` (unrelated eksisterende doctor-fails: `main-protection`, `feature-liveness`). PatchNotes ikke opdateret: intern CI/agent-infra.

> **🟢 2026-05-27 close-out (#695):** Klub-DNA på BoardPage renderes nu via DA/EN `board.json` i stedet for backend-DA strings: DNA labels/descriptions, suggestion rationales og tradition-goal labels. Verification: targeted `boardClubDna` 19/19, backend pattern-suite 79/79, frontend build grøn, i18n checks grønne, lint uden nye errors (kun eksisterende warnings). PatchNotes v4.07 + FEATURE_STATUS opdateret.

> **📚 Arkiv:** Tidligere detaljer ligger i `docs/archive/NOW-2026-05-22.md` til `docs/archive/NOW-2026-05-26.md` samt relevante GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** **Bruger paster `dyn-cyclist-fkIDteam-FULL-COLUMN-v3.txt` ind i sheet E2** (52 ændringer ift. v2 paste — Chris Machines/Vestas + 33 cleanup-evictions). Importér ark tilbage i PCM. Derefter: [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705) Supabase Key verification → [#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702) Safety-gate → [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) Stale-data monitor.

> **🤖 Working agent:** _Ingen aktiv session._
