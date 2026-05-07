# 2026-05-07 — Ship-flow-friction (PR #152 + #153)

## Hvad skete

Brugeren bad om at "sende live" to PRs back-to-back: [#152](https://github.com/NicolaiDolmer/CyclingZone/pull/152) (admin-cancel) og [#153](https://github.com/NicolaiDolmer/CyclingZone/pull/153) (proxy-bidding). Begge endte LIVE, men sessionen havde 3 friktioner:

1. **PatchNotes versionskollision** — PR #153 sigtede mod `2.63`, men [#51](https://github.com/NicolaiDolmer/CyclingZone/pull/151) blev merget som `2.63` imellem PR #153's åbning og merge. Manuel bump til `2.64` under konflikt-resolution.
2. **Stale background-poll-job** — `until ... gh pr checks 153 --required`-loop med `run_in_background: true` blev efterladt kørende efter merge. Brugeren spurgte "Hvad betyder 1 shell running?".
3. **Passiv venten på user-prompt efter CI grøn** — PR #153's CI passed, men merge ventede til brugeren spurgte "Er denne kommet live rigtigt?". Burde have merget straks.

## Root cause

1. **Versionskollision er strukturel:** PR-author (claude[bot]) ved PR-creation kender ikke main's seneste version. Samtidige PRs vil altid kollidere. Auto-merge tager ikke stilling til version-unikhed. Ingen CI-gate fanger duplikat.
2. **To ventemekanismer aktiveret samtidigt:** Polling-loop OG `ScheduleWakeup` blev startet på samme task. Ingen automatisk oprydning når task'ens udfald nås før timer fyrer. Default mental-model: "lad det dø af sig selv" → tasks hænger.
3. **Manglende selv-trigger på CI-status-skift:** Jeg satte ScheduleWakeup til at "checke senere", men reagerede ikke på det øjeblikkelige `pass`-signal fra polling-loopet. Manglede en "merge-when-green"-disciplin.

## Fix

### Memory (3 nye filer)

- `feedback_patch_notes_version_collision.md` — protokol for at tjekke main's seneste PatchNotes-version før merge + bumpe ved kollision
- `feedback_cleanup_background_tasks.md` — vælg ÉN ventemekanisme (poll ELLER wakeup); stop poll-tasks aktivt ved task-completion
- `feedback_auto_merge_after_ci_green.md` — default-flow ved "send live"-anmodning: merge straks ved required-CI grøn, ikke vente på user-prompt

### Issue (1 systemic fix)

[#154](https://github.com/NicolaiDolmer/CyclingZone/issues/154) — CI-check der fejler PR med duplikat eller ≤ main PatchNotes-version (`scripts/check-patch-notes-version.js`). Forebygger versionskollisionen på systemniveau, så fremtidige claude[bot]-PRs ikke kan smutte forbi.

## Læring

- **Procesregler skal kunne håndhæves af systemet, ikke kun memory.** Memory-regler gælder kun for mig — claude[bot] der åbner PR husker dem ikke. CI-check er den eneste pålidelige forebyggelse for systemiske problemer der spænder over flere agenter/sessioner.
- **Ventemekanismer skal være atomare.** Polling-loop + ScheduleWakeup er duplikat — dobbelte notifikationer, halvt-stoppet state. ÉN mekanisme per task = forudsigelig.
- **"Send live"-anmodninger har implicit mandat.** Brugeren har givet shipping-tilladelse én gang; jeg skal ikke spørge "skal jeg merge?" for hver step, men eksekvere kæden (rebase → migration → merge → verify → rapportér) i én bevægelse.
- **Postmortem-disciplin selv ved process-friktion.** Det her var ikke en kode-bug, men et workflow-mønster. Lærepenge er værdifulde uanset.
