# 2026-09-03 · Menneskehold uden bestyrelsesmedlemmer (#4664)

## Symptom

Målt 2/9 kl. 23:30: 16 menneskehold uden rækker i `team_board_members`. Re-målt under denne session
(3/9): 40 (heraf 4 test-konti). Issuet antog at rod-årsagen var en oprettelses-sti der "sprang
tildelingen over" for hold oprettet siden 24/8. Runtime-verifikation modsagde den antagelse delvist.

## Hvad blev faktisk fundet (verificeret mod prod, read-only)

To adskilte populationer blandt de boardless hold:

1. **`team_dna_key` er SAT, men 0 rækker i `team_board_members`.** Denne tilstand er ifølge koden
   umulig — to af `chooseDnaForTeam`s tre grene (førstegangsvalg, DNA-genvalg i sæson 1) har
   eksplicit atomisk rollback (#878) hvis `regenerateBoardMembersForTeam` kaster. Alligevel fandtes
   den i prod, for hold oprettet spredt fra 29/6 til 2/9 — IKKE kun "siden 24/8".
2. `team_dna_key` er `NULL`, holdet er inden for normal onboarding-/auto-accept-vindue (spillere har
   op til 5-10 kalenderdage til selv at vælge DNA før `boardAutoAccept.js` griber ind). Ikke i sig
   selv et brud — men tælles med i backfillen, fordi AGM-deadline ikke kan vente på det naturlige
   vindue for alle 12 rigtige S3-hold.

## Rod-årsag

`regenerateBoardMembersForTeam` (`backend/lib/boardMembers.js`) sletter et holds
`team_board_members`-rækker og indsætter derefter det nye sæt — **to separate, ikke-transaktionelle
Supabase-kald**, ingen DB-transaktion imellem. Kalderens tredje gren i `chooseDnaForTeam` — "samme DNA
valgt igen" (idempotent regenerering, bruges også som recovery-sti for netop et dna-sat-men-boardless
hold) — havde **intet try/catch** omkring kaldet, i modsætning til de to andre grene. Kaster
`assignBoardMembersForTeam`s insert EFTER delete'et er committet (transient netværksfejl, en
samtidig dobbelt-indsendelse mod `/board/dna-choose` — fx dobbeltklik uden debounce på tværs af to
faner, eller en frontend-retry efter en tilsyneladende hængende request), står holdet tilbage med
`team_dna_key` uændret men **0 rækker** i `team_board_members`. Fordi `requiresBoardDnaChoice`
(`routes/api.js`) er `season_1_identity_basis && !team_dna_key`, viser frontend ALDRIG DNA-vælgeren
igen når `team_dna_key` allerede er sat — den eneste sti der (gen)tildeler medlemmer er dermed
utilgængelig, og holdet sidder fast permanent. Samme sårbarhed findes strukturelt i ALLE kaldere af
`regenerateBoardMembersForTeam` (også `boardAutoAccept.js`s auto-accept-sti, som dog selv har en
DNA-rollback for netop den situation — men board-tabet fra selve delete'et var stadig ikke dækket
før dette fix).

De 12 "rigtige" S3-hold nævnt i issuet er formentlig en blanding af begge populationer — nogle har
ramt den transiente fejl (fx via en dobbelt-indsendelse under S3-tilmeldings-runet), andre er simpelt
hen stadig inden for det normale DNA-valgs-vindue og ville være selv-helet af `boardAutoAccept.js`
i løbet af nogle dage.

## Hvorfor "siden 24/8" var en for snæver ramme

Issuets egen måling (16 hold, alle "rigtige" oprettet 24/8-2/9) var et øjebliksbillede, ikke et bevis
for at ÆLDRE hold var upåvirkede. En bredere query (alle menneskehold uden 5 medlemmer, uanset
oprettelsesdato) viste hold helt tilbage til 29/6 med `team_dna_key` sat og 0 medlemmer — samme
signatur. Konklusionen "kun nye hold" var en for tidlig generalisering fra en filtreret liste
(issuet havde allerede navngivet de 12 hold og antog resten fulgte samme mønster). Lektion: når en
"root cause i oprettelses-stien" skal verificeres, mål den FULDE population, ikke kun den delmængde
issuet selv har navngivet — ellers risikerer man at "fixe" et symptom (nye holds onboarding) og
overse den strukturelle årsag (en race i en delt regenererings-funktion, ramt af enhver kalder, når
som helst).

## Fix

- `regenerateBoardMembersForTeam` gemmer nu de eksisterende rækker FØR delete og genindsætter dem
  best-effort hvis `assignBoardMembersForTeam` kaster bagefter — et fejlet regenereringsforsøg
  efterlader ALDRIG holdet dårligere stillet end før kaldet. Lykkes hverken den nye indsættelse eller
  gendannelsen (dobbelt-fejl), captures det til Sentry i stedet for at være tavst.
- `backend/scripts/repairMissingBoardMembers.js`: dry-run default, `--apply` skriver via
  `assignBoardMembersForTeam` (samme funktion som holddannelsen selv bruger), springer
  `is_test_account` over, idempotent, post-verify.
- Ny invariant F i `backend/lib/ownershipInvariantWatch.js` (daglig, read-only): menneskehold uden
  5 bestyrelsesmedlemmer, Sentry-capture med fast fingerprint `human-team-without-board-members`.

## Ikke rettet her (out of scope)

- Hvorfor den transiente insert-fejl faktisk opstod i det enkelte tilfælde (netværk/timeout/dobbelt-
  indsendelse) er ikke instrumenteret — kun konsekvensen (tabt board) er nu selv-helende.
- Frontend-siden af dobbelt-indsendelse (fx en anden fane, eller en retry-mekanisme uden idempotency-
  key) er ikke undersøgt eller ændret.
