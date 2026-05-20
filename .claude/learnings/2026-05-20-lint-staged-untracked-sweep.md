# 2026-05-20 — lint-staged sweep af untracked filer i fremmed commit

## Hvad skete

Under en session der adresserede CodeQL alerts (#442 housekeeping) committede jeg en lille `.github/workflows/codeql.yml`-ændring. Pre-commit hook'en (lint-staged via `.githooks/pre-commit`) sweepede 14 untracked admin-rewrite-filer + 2 modificerede filer ind i samme commit med MIN commit-besked om CodeQL. Resultat: commit `471ceee` pushet til main MED brugerens arbejde-i-gang admin-tab-navigation, der blev deployet til Vercel som "v3.74".

## Hvordan

`lint-staged.config.mjs` brugte function-tasks der returnerede fast command uden `files`-args:

```js
"frontend/**/*.{js,jsx}": () => "npm run lint --prefix frontend",
```

Lint-staged sin "Updating Git index again"-step antog at ALLE filer der matchede globben var staged-kandidater (inklusive untracked filer der matchede), så restore-fasen re-stagede dem ved at tilføje dem til index'et.

## Recovery (4 commits + PatchNotes-bump)

1. `e0e0aeb` — `git revert 471ceee` — undoer alt incl. min codeql.yml-ændring
2. `17b5f11` — re-apply codeql.yml actions language scan (separat clean commit)
3. `9dc7f54` — fix `lint-staged.config.mjs` så tasks modtager `files` eksplicit og passer dem til `npx eslint`
4. `486b4f8` — PatchNotes 3.75 entry der kommunikerer rollback ærligt til brugere (admin-tabs rullet tilbage; URLs 404'er; kommer tilbage når komplet)

Pre-push blokerede push i mellemtiden fordi 471ceee bumpede PatchNotes til 3.74, mit revert reducerede til 3.73, og pre-push gate kræver at top > origin's top. PatchNotes 3.75 løste det.

## Hvorfor det betød noget

- Brugerens admin-arbejde var i WIP-state (ikke klar til merge — warning-budget brød)
- Vercel deployede 3.74 patch notes der promiserede en feature der ikke virkede (admin-tab-URLs returnerede 404)
- Min commit-besked refererede et issue (#442) der intet havde at gøre med admin-tabs

## Forebyggelse

1. **lint-staged.config.mjs** er fixed permanent ([9dc7f54](https://github.com/NicolaiDolmer/CyclingZone/commit/9dc7f54)) — tasks modtager nu `files` eksplicit
2. **Memory-rule** tilføjet ([feedback_lint_staged_untracked_sweep](../../memory/feedback_lint_staged_untracked_sweep.md)) — tjek `git status` for untracked filer der matcher globs FØR commit
3. **Workflow på admin-rewrite**: gør arbejdet på en branch (admin/tabs-phase-1) i stedet for direkte på main med uncommittet filer. Bruger har allerede denne branch.

## Hvad jeg burde have gjort

Da jeg så `git status` output før commit #2 viste:
```
modified:   frontend/src/App.jsx
Untracked files:
  frontend/src/components/admin/sections/
  frontend/src/components/admin/shared/
  frontend/src/pages/admin/
```

— skulle jeg have STOPPET og enten:
- Bedt brugeren stash'e WIP (`git stash -u`)
- Flyttet WIP til separat branch FØR jeg committede
- Brugt `git stash push -u --keep-index` for at sikre kun staged blev committed

I stedet antog jeg at lint-staged ville respektere mit `git add` af én specifik fil. Det gjorde den ikke.

## Bonus-fund

Under recovery viste det sig at CodeQL kun scannede `javascript-typescript`, ikke `actions`. Re-enable af `actions` matrix i codeql.yml ([17b5f11](https://github.com/NicolaiDolmer/CyclingZone/commit/17b5f11)) auto-closede de 4 originale workflow alerts MEN afslørede 4 nye workflows uden permissions + 1 issue i min lint-staged escape-funktion. Alle 5 fixed i [e7841d7](https://github.com/NicolaiDolmer/CyclingZone/commit/e7841d7).

**Net effekt af session**: 9 CodeQL alerts lukket, lint-staged-bug elimineret, memory-rule tilføjet, postmortem skrevet. 7 admin-route alerts deferred til admin-rewrite per brugerens valg.
