# 2026-09-25: Rød main efter to grønne natbølge-PR'er i samme fil (semantisk merge-konflikt)

## Hvad skete

- Natbølgen 25/9 byggede #5709 (v4 uheld/jury) og #5708 (v4 indsatstrappen) i hver sin lane med overlappende ejerskab på `backend/lib/engine/v4/segmentLoop.ts` og `index.ts` (planens admission afviste overlappet, men det blev "rettet" ved at give #5580 konkrete filer, som stadig overlappede #5582's).
- #5709 blev merget 07:04 (kategori "motor bag slukket v4", uden go). #5708 blev merget 09:48 i dagsessionens bulk-kø. Begge PR'ers egen CI var grøn, fordi ingen af dem havde den anden i sin base, og git flettede rent (forskellige linjer).
- Main blev rød på `tsc`: #5708 fjernede parameteren `profileType` fra `tickGroupRiders`, og #5709's nye kaldsted (jagtens om-tick) sendte stadig 7 argumenter. Fix: #5738 (én linje), main grøn igen efter 15 min.
- Samme mønster ramte #5726 (baseret før #5709): simuleret merge mod main gav 6 tsc-fejl i `index.ts` (to linjer fra #5726's `simulateStageV4WithTrace` landede i #5709's nye `juryInputFor`). Fanget FØR merge ved at simulere merge + tsc i et midlertidigt worktree; en opus-lane flettede main ind og løste det.

## Læring

1. **Grøn PR-CI beviser kun grenen mod sin egen base.** Når to PR'er fra samme bølge rører samme fil, skal den sidste have main flettet ind (eller en simuleret merge + gate) FØR den sættes i køen. `mergeStateStatus: MERGEABLE` siger kun at git kan flette, ikke at koden hænger sammen.
2. **Billig forhåndskontrol der fangede #5726:** `git worktree add --detach <tmp> origin/main && git -C <tmp> merge --no-commit <gren>`, junction til hoved-checkoutets `node_modules`, og PR'ens hurtigste gate (her `tsc`). Under 2 min. Gør det for enhver PR i køen hvis filer også er rørt af en PR merget siden dens base.
3. **Bølgeplanen skal validere ejerskab pr. FIL, ikke pr. issue**, og et overlap må ikke "løses" ved at pege på konkrete filer der stadig er de samme filer. `validateTracks` bør afvise identiske stier på tværs af spor i samme batch (kandidat-issue).
4. **Merge-køen stopper korrekt på rød main** (stop-alt-fix-først). Hotfix-flowet (branch fra main i worktree, junction til node_modules for pre-commit-hooken, `guard-commit-branch.sh <branch> <dir>`, PR, kø) tog 15 min og bør stå som standardopskrift.

## Refs

#5708 #5709 #5738 #5726 #5580 #5582 #5578 #5142
