# 2026-08-03: Roed ratchet-guard merged alligevel, main roed for alle PRs

## Hvad skete

- PR #3238 (scouting-historik, #3203) blev merged 3/8 kl. 19:52 lokal tid med `swallowed-catch-guard` = FAILURE; alle oevrige checks var groenne.
- Den nye route `GET /api/club/staff/:id/scouting-history` tilfoejede `backend/routes/api.js`' 175. svaltede catch mod ratchet-baseline 174 (#2395/#2897).
- Konsekvens: guarden fejlede derefter direkte paa origin/main, dvs. CI blev roed paa ALLE aabne PRs (bl.a. #3246), ikke kun paa synderen.

## Rod-aarsag

Ikke et guard-hul: guarden fangede praecis det den skulle, paa PR'en, foer merge. Processen brast:
1. `swallowed-catch-guard` er ikke et required check i branch protection, saa merge var muligt med det roedt.
2. Merge-protokollen (groen CI foer merge) blev ikke haandhaevet for netop dét check under aften-batchens PR-for-PR-merges. Med ~35 checks pr. PR drukner ét roedt check visuelt.

## Fix

Hotfix samme aften: `captureException(e, { tags: { route: "club-staff-scouting-history" } })` paa det net-nye site. IKKE baseline-bump: ratchetens formaal er at bunken aldrig vokser, og et bump ville re-legitimere gaeld.

## Laering / forward-guard

- En ratchet-guard der kan overdoeves ved merge beskytter kun main saa laenge ingen merger med roedt. Anbefaling til ejeren: goer de billige lint-vagter (swallowed-catch, dropped-supabase-error, silent-mutation, tone-em-dash) til required checks paa main.
- Batch-merge-protokol: foer `gh pr merge` skal `statusCheckRollup` vaere uden FAILURE, ogsaa naar man merger mange PRs i traek. Et enkelt `--jq`-filter paa FAILURE er nok som gate.
- Naar main selv fejler en fil-baseline-guard, er den hurtigste vej at fixe det net-nye site (én linje her), ikke at aendre guarden.

Refs #3203 #3238 #2395 #2897
