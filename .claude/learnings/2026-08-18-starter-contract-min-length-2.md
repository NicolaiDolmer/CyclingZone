# Starter-kontrakter kunne udløbe dagen efter signup (#3037)

## Root cause

`contractSeed.js`s `pickContractLength()` trækker uniformt 1-3 sæsoner, og
`computeContractEndSeason = startSeason + length - 1`. For et NYT hold, der
allokeres sent i en sæson, betyder et udfald på 1: `contract_end_season ==
startSeason`. `releaseExpiredContractRiders` frigiver ved `contract_end_season
<= den AFSLUTTEDE sæson` — så en kontrakt "på 1 sæson" reelt kunne vare fra
timer til dage, afhængig af hvor sent på sæsonen holdet meldte sig.

Easy Riders (oprettet 25/7) mistede 9/12 ryttere ved S1→S2-cutoveren 26/7,
dagen efter signup. Lip Air France Team (også 25/7) mistede 2/13.

## Fix

Ny helper `pickStarterContractLength(rng)` i `contractSeed.js`: uniform
2-3 (aldrig 1) — garanterer at en start-trup overlever mindst én HEL sæson
efter den holdet blev oprettet i, uanset signup-tidspunkt. Bevidst IKKE
`Math.max(2, pickContractLength(rng))`, som ville skævvride fordelingen
(1'ere → 2'ere, så 2 bliver dobbelt så hyppig som 3).

`starterSquadAllocator.js` (både den ældre applyContractFieldsForRiders-sti og
`runStarterSquadAllocation`s hovedsti) og det endnu ikke kørte
`backfill-2902-contract-fields.mjs` (samme population — 100% co-occurrence
med `starter_squad_allocated_at != null`) skifter til den nye helper.
`runContractSeed` (founders/andre ejede hold) og allerede-udførte make-good-
scripts røres IKKE — kun fremadrettede/ikke-kørte start-trup-kontrakter.

## Læring

Enhver "længde i sæsonnumre" beregning, hvor start-tidspunktet kan falde SENT
i en sæson, skal have et gulv der garanterer mindst én hel efterfølgende
sæson — ellers kolliderer "kontraktlængde i sæsoner" med "faktisk kalendertid
tilbage af indeværende sæson". Samme mønster kan ramme andre steder, hvor
sæsonnummer bruges som tidsenhed for noget der oprettes løbende (ikke kun ved
sæsonstart).

## Make-good (allerede kørt, ikke del af denne PR)

26/7 ~23:15: alle 11 frigivne ryttere gen-indskrevet (Easy Riders 9,
Lip Air France Team 2), friske kontrakter, managerne notificeret in-app.
Script: `backend/scripts/makegood-3037-resign-released-riders.mjs`.
