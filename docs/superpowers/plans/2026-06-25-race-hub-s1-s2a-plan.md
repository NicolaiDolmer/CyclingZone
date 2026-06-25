# Race Hub S1 + S2a — implementeringsplan (stabilisering)

> **Dato:** 2026-06-25 · **Branch:** `worktree-feat-race-hub-s1-s2a` · **Scope:** KUN S1 (#1823) + S2a (#1828, #1829, frys-del af #1825). Ingen migration.
> **SSOT:** `docs/superpowers/specs/2026-06-25-race-hub-program-design.md` + `-2026-06-23-race-hub-redesign-design.md`.

## Korrigeret rod-årsag for #1823 (repro mod prod 2026-06-25 — ERSTATTER spec §2.1's gæt)

Spec'ens to hypoteser (manglende `race_stage_schedule`-rækker / regenerate-auto-lock-hul) er **ikke** den primære årsag. Prod-repro (read-only):

- Binding-vindue = `[min(scheduled_at), max(scheduled_at)]`. Et **endagsløb er et nul-bredt instant** (Hamburger Klassiker = `[Jun23 22:00, Jun23 22:00]`).
- La Corsa (7-etaper) = `[Jun23 23:00, Jun26 15:00]`. `windowsOverlap`: `LaCorsa.start(23:00) <= Hamburger.end(22:00)` → **false**.
- → to **samme-dag**-løb regnes som ikke-konflikt → generatoren sætter samme top-ryttere i begge. Præcis @jeppeks "8 ryttere til 12 pladser".
- **Omfang:** 798 samme-dag dobbeltbookede par i prod, 144 hold, 796 ryttere — **0** med ægte tidsoverlap. Kernen `assignTeamAcrossRaces` ER korrekt; vindue-definitionen er fejlen.

**Fix:** dag-granulært binding-vindue — én rytter pr. CET-kalenderdag (design §2/§3 + #1823's invariant). DST-robust via CET-dag-ordinaler. Anvendes KUN på binding-sites; ms-vinduet bevares til display/kolonner.

De 798 eksisterende prod-dobbeltbookinger fikses IKKE af kode-ændringen (ingen migration). De selv-heler når en manager trykker "auto-udfyld igen" (regenerate) på den ramte dag, og board'ets bindingMap viser nu låsen. Engangs prod-regenerering = ejer-opfølgning.

## Delt fundament (pure, TDD)

1. `raceBindingWindow(scheduleRows)` (raceBinding.js) — CET-dag-ordinal `{start,end}` (DST-robust via `copenhagenDateString`). `windowsOverlap` er unit-agnostisk → uændret. Returnerer null for tom/ugyldig.
2. `deriveRaceStatus(status, stages_completed, stages)` (frontend raceHubLogic.js) — `"live"` når `status==='scheduled' && 0<completed<stages`; `"completed"`/`"scheduled"` ellers. SKRIV ALDRIG 'active' i backend.
3. `poolRaceDayTotals(races)` (seasonRaceDays.js) — `{completed, total, inProgress}` = sum(stages_completed inkl. igangværende) / sum(stages) over puljens løb. Pure.

## S1 (#1823)

- **B-bind:** swap `raceTimeWindow`→`raceBindingWindow` ved binding-sites (raceEntryGenerator windowByRace, regenerate windowByRace+lockedWindows, loadTeamBindingContext, GET /distribution bindingMap-vindue). Display (buildColumnSet/timeline) beholder ms.
- **B-regen:** regenerate dual-mode `?mode=missing|all` (`missing` springer manuelt-udtagne kolonner over → folder dem ind i lockedWindows); transaktionel (efterlad ikke 0 entries ved fejl); spring started-løb (`stages_completed>0`) over (frys).
- **B-lock1b:** lås OGSÅ auto-filled (ikke kun manuelle) entries i ikke-target overlappende løb under regenerate (defense-in-depth mod multi-dag-stage-overlap).
- **FE-board:** RaceHubBoard `putSelection/removeRider/toggleWithdraw/regenerate` tjekker `res.ok`, parser fejlkode, viser toast/inline, optimistisk rollback bevares. Map `selection_wrong_size/_wrong_pool/_rider_bound/_race_not_open/_race_started`.
- **FE-captain:** kaptajn-/rolle-vælger i RaceColumn (klik rytter → captain/sprint_captain/hunter) → eksplicit `captain_id` i PUT.
- **FE-mode:** dual-mode auto-udfyld-knap (missing|all).
- **WC core:** delt suitability-fit-bar (navy/guld + Strong/Average/Poor), navngiv binding ("Locked — racing in {løbsnavn}"), smart popover (ranger mål-løb efter fit).

## S2a (#1828, #1829, frys)

- **FE-status:** `deriveRaceStatus` + "I gang"-badge + etape-fremdrift (X/Y) + countdown på Dashboard + RaceDetailPage + RacesPage-badge.
- **FE-counter:** per-pulje tæller (løbsdage kørt inkl. igangværende / puljens total) på Dashboard.
- **B-freeze:** `PUT /selection` afvist når `stages_completed>0` → `selection_race_started`; service_role-autofill (raceRunner) IKKE ramt. Synlig "Lineup locked" i board + RaceSelectionPanel.

## Proces

TDD (node --test backend+frontend) · CI-gate-sæt (lint + i18n-leak + tone + warning-budget + icu-braces) · playwright core-smoke alle 3 + snapshot-refresh ved visuel ændring · patch notes + help.json (en+da) · INGEN AI-slop · EN-først copy · adversariel verifikation af hver fix før luk.
</content>
</invoke>
