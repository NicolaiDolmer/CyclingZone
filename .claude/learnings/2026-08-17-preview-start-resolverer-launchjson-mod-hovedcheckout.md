# preview_start resolverer launch.json mod hoved-checkoutet — falsk negativ ved worktree-verifikation

**Dato:** 2026-08-17 · **Kontekst:** #3396-workeren (PR #3857), UI-verifikation fra worktree

## Hvad skete

En worker i en worktree startede dev-serveren via Browser-panelets `preview_start` med et launch.json-navn. Konfigurationen blev resolvet mod HOVED-checkoutets cwd (`C:\Dev\CyclingZone`), ikke worktreen — serveren serverede derfor den u-fixede main-kode, og fixet så ud til ikke at virke (falsk negativ). Bekræftet ved diff af den serverede modul-source.

## Regel fremover

Ved UI-verifikation af worktree-ændringer: start dev-serveren MANUELT fra worktreen (`npm run dev -- --port <ledig port>`) og peg browseren på den port. Brug ALDRIG launch.json-navne fra en worktree-session uden først at verificere hvilken kode serveren faktisk serverer (diff et ændret modul i browserens source mod worktree-filen).

## Hvorfor det bider

Falsk negativ ligner en ægte fejl → risiko for symptom-patching-loop på kode der allerede virker. Omvendt kan det også give falsk POSITIV (main-koden virker tilfældigt) — screenshots fra forkert server er ubrugelige som PR-bevis.
