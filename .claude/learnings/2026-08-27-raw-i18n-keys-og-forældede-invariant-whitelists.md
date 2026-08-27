# Postmortem · 2026-08-27 · Rå i18n-nøgler + forældede vagt-whitelists (samme rod-mønster)

## Hvad skete der?
Spillere så rå kode i stedet for tekst tre steder (#4260, Discord-sweep 25/8):
finans-historikkens transaktionslinjer, historik-linjen ved fyring af en rytter,
og træningspasset "Tempo". Samme dag (#4184) flagede `verify-invariants.js`
13 legitime finans-typer og 22 legitime notifikations-typer som "ukendte" —
ren vagt-støj der druknede ægte fund.

## Root cause
Begge er samme mønster: **en håndholdt liste et sted, der aldrig blev udvidet
da en anden liste voksede.**

- `frontend/public/locales/{en,da}/finance.json`s `transactions.type.*` og
  `backendMessages.json`s `tx.*`-koder dækkede kun de finans-typer der fandtes
  da namespacet blev bygget — 14 typer tilføjet siden (parachute,
  sponsor_race_day, facility_purchase, staff_severance, upkeep, scout_travel,
  m.fl.) fik aldrig en label. `tx.riderRelease` (rytterfyring) og 4 andre
  `tx.*`-koder manglede helt fra backendMessages.json.
- `frontend/public/locales/{en,da}/rider.json`s FLADE `focus_<key>`-liste
  (brugt af `TrainingPage.jsx`/`TrainingHistory.jsx` via
  `training.focus_${row.focus}`) fik aldrig `focus_tempo` tilføjet da #3762
  introducerede `tempo` som et gyldigt trænings-fokus i
  `backend/lib/training.js`s `TRAINING_FOCUSES` — kun den NESTEDE
  `profile.training.focus.*`-liste (en anden komponent) blev opdateret.
- `backend/scripts/verify-invariants.js` havde sin egen hardkodede
  `KNOWN_TX_TYPES`/`KNOWN_NOTIF_TYPES`, uafhængig af BÅDE den autoritative
  `finance_transactions_type_check` (database/*.sql) OG
  `backend/lib/notificationTypes.js`, som allerede fandtes og allerede var
  paritets-testet mod sit eget CHECK.

## Fix
- `frontend/public/locales/{en,da}/finance.json`: tilføjede 14 manglende
  `transactions.type.*`-nøgler (parachute, sponsor_race_day,
  facility_purchase, staff_severance, upkeep, scout_travel,
  sponsor_signing_bonus, sponsor_objective_bonus, sponsor_result_bonus,
  auto_squad_purchase, auto_squad_sale, forced_debt_sale,
  squad_violation_fine, starting_budget).
- `frontend/public/locales/{en,da}/backendMessages.json`: tilføjede 5
  manglende `tx.*`-koder (riderRelease, facilityPurchase, staffSeverance,
  staffRelease, scoutTravel).
- `frontend/public/locales/{en,da}/rider.json`: tilføjede `focus_tempo` +
  `focus_restitution` til den flade liste.
- `backend/scripts/verify-invariants.js`: `KNOWN_TX_TYPES` afledes nu af
  `loadCheckAllowedTypes()` (samme parser som `scripts/lint-finance-types.mjs`
  bruger til den autoritative CHECK-constraint), `KNOWN_NOTIF_TYPES` afledes
  af `NOTIFICATION_TYPES` (backend/lib/notificationTypes.js). Ingen af
  listerne er hardkodede i scriptet længere.
- Samme session: `squad_within_max` og `debt_within_ceiling` i
  verify-invariants.js havde et TREDJE tilfælde af samme mønster (SQUAD_MAX/
  DEBT_CEILING hardkodet uden division 4, og trupoptælling der ikke
  ekskluderede akademi/pensionerede ryttere) — fundet af orkestrator-sessionen
  (#4282/#4146) og foldet ind her: importeret fra `marketUtils.MAX_SQUAD_SIZE`
  og `economyConstants.DEBT_CEILING_BY_DIVISION` i stedet.

## Forhindret-fremover
`backend/lib/handheldCopyGuards.test.js` fik 3 nye guards:
1. Alle `TRAINING_FOCUS_KEYS` (+ restitution) har en flad `focus_<key>`-label
   i `rider.json` (en+da).
2. Samme, for den nestede `profile.training.focus.<key>`-liste.
3. Alle CHECK-tilladte `finance_transactions.type`-værdier (afledt via
   `loadCheckAllowedTypes()`) har en `transactions.type.<type>`-label i
   `finance.json` (en+da).

Et nyt fokus eller en ny finans-type uden oversættelse fejler nu synligt i
`backend-tests` (required check) i stedet for at ramme en spiller først.

## Læring
Samme lektie som #3665/#3681-familien, gentaget på en tredje akse: **når to
lister skal dække det samme sæt, skal den ene afledes af den autoritative
kilde, ikke vedligeholdes ved siden af den.** Her var den autoritative kilde
allerede der to gange (`finance_transactions_type_check`,
`notificationTypes.js`) — ingen af de tre driftende steder importerede den,
de skrev bare deres egen kopi. Næste gang en ny type/type-liste dukker op:
spørg "afledes dette allerede et sted?" før en ny håndholdt liste skrives.
