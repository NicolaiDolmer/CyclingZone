# Postmortem · 2026-09-11 · wave.js stoppede levende spor som "frys" (timeout ≠ frys)

## Hvad skete der?
Begge bølger gennem `.claude/workflows/wave.js` (første dag i drift, #5142) endte med `stoppedByFreeze`. Bølge 1 stoppede på #4845 efter 60 min, selv om lanen havde committet 12 min før og pushet hvert kvarter. Bølge 2 stoppede tre laner (#5159, #5155 og reviewer på #5150) på samme måde; #5159 havde committet 6 min før stoppet. Bølge 2 efterlod ucommittet arbejde i to worktrees (5 + 2 filer), og fire spor i bølge 1 nåede aldrig at starte, fordi et "frys" pr. design stopper hele bølgen.

## Root cause
`wave.js` bruger agent-svar inden for `trackTimeoutMinutes` (60) som eneste frys-signal. Store spor (kalenderpakker, reload-koordination, 800-2.900 linjer med e2e-kørsler bag semaforen) tager længere end 60 min uden at være frosne. TIER WAVE-reglen (6/9) siger allerede at frys måles på BRANCH-aktivitet (push/commit), men wave.js implementerer den ikke. Reviewer-trinnet deler samme timeout og har ingen gen-spawn.

## Fix
Ikke rettet 11/9; issue #5178 oprettet (kode i wave.js kræver egen PR). Genoptagelse skete manuelt som `WAVE-FOLLOWUP:` i samme worktree, hvilket virkede: #4845 blev færdig på 20 min, #5159 på 1 t 45 min. Foreslået ændring, logget på #5142:
1. `trackTimeoutMinutes` 60 → 120.
2. Frys = ingen commit/push på branchen i 45 min (målt i worktreet, `git log -1 --format=%ct`) OG intet agent-svar. Aktivitet på branchen = lever.
3. Reviewer-timeout separat (30 min) med ét automatisk gen-spawn.
4. Ved timeout: bed agenten committe WIP før stop, så worktreet aldrig efterlades dirty.

## Forhindret-fremover
- Spor i næste bølge: "wave.js: frys-tjek på branch-aktivitet + graceful stop" med test i `scripts/make-wave-brief.test.mjs`-stil.
- Indtil da: forvent at store spor rammer timeouten, og genoptag med `WAVE-FOLLOWUP:` i SAMME worktree (aldrig reset). Tjek `git status` i worktreet først; efterladte filer kan være halvfærdige.

## Læring
En timeout er en måling af agentens tavshed, ikke af arbejdets tilstand. Når reglen siger "frys måles på branchen", skal koden også måle på branchen; ellers straffer værktøjet netop de spor der giver mest værdi (de store).
