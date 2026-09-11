# 2026-09-11 — Ni workers mod et loft på tre (#5142)

## Hvad skete der

Dagbølgen 11/9 blev startet som ni håndskrevne Agent-spawns fra orkestrator-sessionen. Loftet var på det tidspunkt tre samtidige byg-workers pr. PC (TIER WAVE, 6/9). CPU'en på DOLMERPC lå på 100 % i timevis. Ejeren måtte spørge to gange hvad der foregik, før det blev klart at der kørte ni spor.

Målt samme dag på maskinen (8 kerner, 32 GB, dedikeret til Claude Code):

| Samtidige workers | CPU |
|---|---|
| 9 (uden semafor) | 100 % i timevis |
| 6 (uden semafor) | 83 % |

Under samme bølge kom et andet symptom af samme klasse: to workers delte scratchpad-sti, og den enes commit-besked-fil blev overskrevet af den andens tekst mellem `Write` og `git commit`. Commiten blev amendet før push, så historikken er ren, men det var tilfældigt at nogen opdagede det.

## Rod-årsag

Ikke uvidenhed. Hver eneste regel fandtes allerede, skrevet ned:

- maks 3 samtidige workers (2/9, `docs/NIGHT_WAVE_RUNBOOK.md`)
- TIER WAVE med målrettet verifikation (6/9, samme doc)
- "fire spørgsmål før spawn" (25/8)
- brief-generatoren der gør de bindende blokke uglemmelige (7/9, `scripts/make-wave-brief.mjs`)
- AGENTS.md hard rule 24: maks 3 tunge verifikationer samtidig

Reglerne lå i **docs og hukommelse**, ikke i **den handling der starter arbejdet**. Agent-toolet spørger ikke om noget. Under tidspres skriver en orkestrator ni prompts, fordi der er ni issues, og der er ikke noget i vejen. Det er præcis samme fejlklasse som 2/9 (workers uden stopgrænse) og 6/9 (frosne laner opdaget 35-70 min for sent): en disciplinregel der ikke er bundet til et værktøj, holder indtil første travle dag.

Ejeren 11/9: *"vi skal vælge en standard som vi bruger hver gang i alle sessions, så jeg stopper med at bede dig om at følge best practice."*

## Forward-guard

To ting, begge i indgangen frem for i prosaen:

1. **`.claude/workflows/wave.js`** — ét gemt workflow er nu eneste vej til parallelt byggearbejde. Det ejer lane-loftet (4), per-spor-timeouten (60 min), brief-genereringen, lane-vagten, reviewer-trinnet og oprydningen. Der er ikke længere en "hurtig vej udenom", fordi den hurtige vej nu er workflowet.
2. **`scripts/hooks/guard-agent-spawn.sh`** — PreToolUse-hook på `Agent` og `Workflow`. Afviser spawns mens `.claude/run/wave-active.json` findes (kun `WAVE-FOLLOWUP:`/`WAVE-REVIEW:` slipper igennem), og afviser mere end 4 spawns inden for 45 min uden for bølger. Selvtestet: `bash scripts/test-guard-agent-spawn.sh`.

Plus de to konkrete symptomer:

3. **`scripts/verify-lock.ps1`** — fil-semafor, maks 2 tunge kørsler ad gangen på tværs af alle worktrees. Samtidigheden er flyttet fra antallet af workers til antallet af tunge kørsler, fordi det var kørslerne og ikke lanerne der åd CPU'en. Selvtestet med 3 parallelle kommandoer: `node --test scripts/verify-lock.test.mjs`.
4. **Brief-generatoren giver hver lane sin egen scratch-mappe**, og commit-besked-filen hedder nu `msg-<branch-slug>.txt` og ligger uden for worktreet. To laner kan ikke længere skrive i den samme fil.

## Backwards-check

Modstridende tal rettet samme dag, med dato og henvisning: `AGENTS.md` hard rule 24 (3 → 2 tunge verifikationer), `docs/NIGHT_WAVE_RUNBOOK.md` (maks 3 byg-workers → 4 laner + semafor), `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` (3 subagents → 4 laner). Et loft der står med to forskellige tal i tre dokumenter er i praksis intet loft.

## Hvad der IKKE er dækket

- Hooken ser kun denne sessions `Agent`/`Workflow`-kald. En anden Claude-session på samme PC har sit eget register, og to sessioner kan tilsammen sprænge loftet. Maskinlæsbart session-claim er sporet i #4016.
- Semaforen er frivillig: den virker kun for kommandoer der faktisk wrappes. Brief-generatoren er det eneste sted der håndhæver wrappingen, så en worker der ignorerer sin brief kan stadig starte en tung kørsel udenom.
- Accept-kriteriet "CPU under ca. 75 % i en målt bølge med 4 laner" er ikke verificeret endnu — det kræver en rigtig bølge. Måles ved næste kørsel af `wave.js`.

Refs #5142, #4918, #4919, #4920, #4924.
