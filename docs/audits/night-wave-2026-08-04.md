# Natbølge 2026-08-04 (natten 3/8→4/8)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:45 → ~07:00 |
| Agenter launched / fuldført / døde | 32 / 31 / 1 (D1 hang 00:31, respawnet i samme worktree, fuldførte) |
| PR'er åbnet / merged | 24 / 15 (9 drafts til morgenrunden) |
| Issues → claude:done | #2731, #3266, #3269, #3114 (alle lukket m. evidens) |
| Issues oprettet | #3269 (lukket samme nat), #3290 (RPC-hul, post-23/8) |
| Migrationer applied post-merge | 3 (season_form_reset_runs · selection_warning-type · welcome-type) — alle post-verificeret |
| gh-401-retries (preflight + bølge) | preflight: 0 · bølge: enkelte, ingen blokerende (retry-wrapper) |
| Recoveries (type) | 1 (frossen agent → TaskStop af workflow + standalone respawn i samme worktree) |
| Preflight | GO kl. 23:43 (.codex.local/night-wave-preflight.json) |

## Merged (15)
#3267 cron-monitor · #3268 supabase-audit-doc · #3271 decay-claim-guard · #3272 klynge-SE · #3273 drift-vagt count+tier · #3276 #3172-rodårsag (--test-isolation=none) · #3277 #2887-rehire · #3278 #3114-save-guard · #3280 #2180-varsel+auto-udtag · #3281 cutover-preflight+runbook · #3284 #3269-coverage · #3291 audit-whitelist · #3292 welcome-notif (gap 2a) · #3293 talkorrektion · #3294 patch note 7.89

## Drafts til morgenrunden (9)
#3282 transfer-karantæne (OFF) · #3275 pulje-reseed (OFF) · #3283 sæson-UX · #3285 #3107-display · #3286 #2042A-loginvæg · #3287 #3115-drivere · #3279 #3007-tour-fix · #3288 #2793-akademi-økonomi (migration-først!) · #3289 narrativ-pakke (NOW.md ud af diffen først)

## Adversarial verifikation (fase 2, 6 verifiers)
E1 confirmed · B1/B2/B4/B5/D6 partial: 5 reelle talfejl fundet og korrigeret (23/30-ikke-15/30 · 2,1/2,95-ikke-2,2/7 SE · 9/26-ikke-10/26 · tier3=17-ikke-14 (akademi-bug i poolBalance.js) · D6-metodetekst). INGEN beslutningskonklusion væltede. Korrektioner kommenteret på PRs; kode-doc-fejl rettet i #3293.

## Afvigelser/læringer
- **Agent-hang uden per-agent-timeout:** D1 frøs 00:31 på et tool-kald; barrieren holdt chunk 3 åben. Detektion via journal-vs-transcript-diff (færdige agenter ligner frosne på mtime alene — tjek journal FØR hang-konklusion). Recovery: TaskStop + standalone respawn i samme worktree med handoff = friktionsfrit. 4. lag (ægte per-agent-timeout i Workflow) mangler stadig.
- **Adversarial verify bør være standard:** 5 talfejl i ellers grundige rapporter; alle celler UDEN vedhæftet kør-selv-SQL viste sig at være dem der fejlede. Regel-kandidat: intet balance-tal i beslutningsgrundlag uden reproducerbar query i PR-body.
- **Vercel build-starvation:** aften-batchens hurtige merges gav 6 CANCELED prod-builds i træk (prod hang ~9 commits bagud ved bølgestart). Nattens CI-spacede merge-train selvhelede gappet (READY 02:15). Runbook-kandidat: deploy-verify efter HVER merge-salve + evt. batch frontend-merges.
- **Audit-detector-kædereaktion:** bølgens egen migration (season_form_reset_runs) skabte et nyt Detector-A-fund midt i bølgen → whitelist-entry (hall_of_fame-klassen). Ved migrationer der opretter tomme tabeller: tilføj whitelist-entry i SAMME PR.
- **Patch-note-regel utilstrækkelig:** 3 workers lagde egne 7.89-entries i frontend/src/data/patchNotes.js (reglen nævnte kun PatchNotesPage.jsx). Alle 3 er drafts og skal renummereres til 7.90+ ved merge. Regel-tekst opdateret i denne bølges prompts til fremtidig genbrug: "ingen patch-note-entries overhovedet".
- **gh-CLI-kvirk:** `gh run view --job --log` returnerer forkert indhold for attempt 1 af re-runnede runs; brug `gh api .../jobs/{id}/logs` (fundet af B7, relevant for al CI-arkæologi).
- Parallel merge-aktivitet (aften-batchens close-out + natbølgen) fungerede uden kollisioner; strict=true + update-branch-train håndterer det, men koster en CI-runde pr. merge.

_Refs #605. Fuld beslutningskø: morgenrunde-dossieret (chat 4/8) + wave-statens korrigerede tal._
