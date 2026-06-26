# Auktion-"sælger"-fejllabel + bulk-træning rammer markeds-rate-limit

**Dato:** 2026-06-26
**Issues:** [#1886](https://github.com/NicolaiDolmer/CyclingZone/issues/1886) + [#1885](https://github.com/NicolaiDolmer/CyclingZone/issues/1885) · **PR:** #1897

## Symptom
@thelamba (Discord 25/6): (1) "spillet lod mig gå over 30-cap, trup på 32"; (2) "under auktioner sælger jeg 9 ryttere — som jeg lige har vundet"; (3) "kan ikke sætte træning op for hele truppen".

## Rod-årsager
1. **(1) var ikke en bug.** Senior-count = 29 ≤ 30; akademi tæller aldrig mod cap'en, og "32" var hele truppen inkl. 3 akademi vist mod en senior-only cap. Cap-håndhævelsen (bud-gate + finalize, begge hard) var aldrig brudt.
2. **(2) navne-conflation.** `auctions.seller_team_id` BETYDER auktionens *initiator*, ikke den økonomiske sælger (kommentar i `api.js`). Starter man en auktion for at KØBE en free agent, bliver man selv `seller_team_id` OG `current_bidder_id`. Den afledte boolean `isManagerSeller = seller_team_id===mig && rider.team_id===mig` var korrekt under *aktiv* auktion (rider ikke ejet endnu) men forkert efter *vundet* (rider.team_id flipper til mig → begge sande). Et ikke-atomisk finalize-vindue (rytter overdraget før status→completed) eksponerede det.
3. **(3) bulk-fan-out arvede per-request rate-limit.** Frontend "anvend på flere" loopede ét `POST /training/:riderId` pr. rytter bag `marketWriteLimiter` (30/min). Fuld trup (30+) → 429 på de sidste. Træning delte fejlagtigt markeds-budget med auktioner/transfers.

## Fix
- `isManagerSeller` + `getAuctionSellerLabel`: udeluk `current_bidder_id===teamId` (en ægte sælger byder aldrig på sin egen rytter → afslører en vundet købs-auktion på tværs af alle lifecycle-states).
- TeamPage: vis senior-count mod cap + akademi separat (UI-tydeliggørelse, ikke håndhævelse).
- Nyt `POST /api/training/bulk` (ren `partitionBulkTrainingTargets` + atomisk batch-upsert) → ét request = én rate-enhed.

## Læring (generaliserbar)
1. **En kolonne hvis navn antyder én betydning men holder en anden ("seller_team_id" = initiator) vil før eller siden producere forkert afledt state.** Når en afledt boolean kombinerer sådan en kolonne med en state der ÆNDRER sig over tid (`rider.team_id`), så verificér diskriminatoren mod ALLE lifecycle-states (aktiv vs. vundet), ikke kun den happy-path du tænker på. Spejler [#1694] (gate-divergens) — samme familie: en antagelse holdt ikke på tværs af tilstande.
2. **Bulk-UI der fan-out'er N requests arver per-request rate-limits.** Batch dem til ét endpoint i stedet for at loope; og bucket ikke ikke-markeds-handlinger (træning) under markeds-limiteren.
3. **Verificér en "cap-brud"-rapport mod ground-truth FØR du fixer håndhævelse** — her var håndhævelsen korrekt; bug'en var ren visning (akademi i totalen).

## Forward-guard
Unit-tests: `isManagerSeller`/`getAuctionSellerLabel` vundet-køb-case (auctionLogic.test.js), `partitionBulkTrainingTargets` (training.test.js), bulk-route registreret før `:riderId` (api.test.js).
