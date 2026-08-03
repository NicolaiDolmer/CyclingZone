# 2026-08-03: Roed ratchet-guard merged alligevel, main roed for alle PRs

## Hvad skete

- PR #3238 (scouting-historik, #3203) blev merged 3/8 kl. 19:52 lokal tid med `swallowed-catch-guard` = FAILURE; alle oevrige checks var groenne.
- Den nye route `GET /api/club/staff/:id/scouting-history` tilfoejede `backend/routes/api.js`' 175. svaltede catch mod ratchet-baseline 174 (#2395/#2897).
- Konsekvens: guarden fejlede derefter direkte paa origin/main, dvs. CI blev roed paa ALLE aabne PRs (bl.a. #3246), ikke kun paa synderen.

## Rod-aarsag (praeciseret via parallel-analysen i PR #3257)

Ikke et guard-hul: guarden fangede praecis det den skulle, paa PR'ens egen CI, foer merge. Kaeden der brast:
1. Auto-merge blev armeret kl. 17:50 lokal tid, FOER CI var faerdig paa PR'en.
2. GitHub auto-merge venter kun paa REQUIRED status checks, og `swallowed-catch-guard` er ikke et required check i branch protection paa main.
3. Guarden landede FAILURE, men auto-merge ignorerede den og mergede da de required checks var groenne. Guarden virkede; gaten var hullet.

## Fix

Hotfix samme aften (PR #3254): `captureException(e, { tags: { route: "club-staff-scouting-history" } })` paa det net-nye site. IKKE baseline-bump: ratchetens formaal er at bunken aldrig vokser, og et bump ville re-legitimere gaeld. Parallel duplikat-PR #3257 (samme fix fra boelgen) lukket som overhalet; dens postmortem-praecision er indarbejdet her.

## Laering / forward-guard

- En ratchet-guard der ikke er required status check er kun en anbefaling under auto-merge. Beslutning om required checks loeftet til ejeren i #3259 (anbefaling: goer de billige lint-vagter required).
- Arm ikke auto-merge foer de billige vagter er groenne, saa laenge de ikke er required checks.
- Batch-merge-protokol: foer `gh pr merge` skal `statusCheckRollup` vaere uden FAILURE, ogsaa naar man merger mange PRs i traek.
- Rerun af et workflow-run genbruger den OPRINDELIGE GITHUB_SHA (gammel merge-ref). Efter et main-fix skal blokerede PRs derfor have et NYT event (fx `gh pr update-branch` eller et push), ikke et rerun; rerun fejler bare identisk igen.
- Naar main selv fejler en fil-baseline-guard, er den hurtigste vej at fixe det net-nye site (én linje her), ikke at aendre guarden.

Refs #3203 #3238 #3254 #3257 #3259 #2395 #2897
