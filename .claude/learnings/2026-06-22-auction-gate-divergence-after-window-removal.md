# Auktion: bud-gate og finalize-gate divergerede efter transfervinduet blev afskaffet

**Dato:** 2026-06-22
**Issue:** [#1694](https://github.com/NicolaiDolmer/CyclingZone/issues/1694) · **PR:** #1736

## Symptom
Spillere kunne tabe en auktion de førte, når truppen blev fuld undervejs, og en vundet rytter kunne blive afvist "trods ledig plads" (Discord-feedback, @bobby2106 21/6).

## Rod-årsag
#16 (altid-åben handel) afskaffede transfervinduet. To konsekvenser der ikke blev holdt i sync:
1. `auctionFinalization` begyndte at håndhæve squad-cap **hardt** ved tildeling (`softCapBuffer: 0`), fordi `squadEnforcement`-cron'ens vindue-luk — der før auto-solgte over-cap-ryttere og gjorde det sikkert at byde over cap — **aldrig fyrer længere** (vinduet er altid åbent).
2. Men **bud-gaten** (`getAuctionBidIssue` + `getAuctionBidWarnings`) beholdt den gamle model: squad-cap var kun en *warning*, ikke en block. Designet stammede fra "byd frit midt i vinduet, ryd op ved vindue-luk"-æraen, som ikke længere findes.

Resultat: UI lod dig byde (warning), finalize afviste hardt (block). Gaterne divergerede.

## Fix
Ny `getAuctionBidSquadBlock` i `auctionRules.js` hard-blokerer bud/autobud når truppen er fuld — med **samme `future_count`-baseline som finalize**, så de aldrig kan divergere igen. Reserverer én plads pr. ført auktion (symmetrisk med pengereservationen i `computeWorstCaseCommitment`). Forsvars-bud på en auktion man allerede fører blokeres aldrig.

## Læring (generaliserbar)
**Når en feature-toggle fjerner en håndhævelses-antagelse ét sted, søg efter ALLE gates der deler antagelsen og opdatér dem sammen.** En "soft warning" og en "hard block" på samme regel skal bruge samme baseline — ellers vil et fremtidigt toggle få dem til at divergere igen. #16 ændrede finalize-siden men efterlod bud-siden i den gamle verden i ~uger.

## Forward-guard
5 unit-tests på `getAuctionBidSquadBlock` (fuld trup blokerer, sidste plads tillades, reservation pr. ført auktion, forsvars-bud aldrig blokeret, legacy `total_count`-fallback). Relateret: [#615](https://github.com/NicolaiDolmer/CyclingZone/issues/615) (cron tick-overlap-guard) og notifikations-dedup er ikke race-sikker — separat opfølgning.
