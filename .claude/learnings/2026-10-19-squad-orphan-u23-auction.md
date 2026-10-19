# Postmortem · 2026-10-19 · U23-rytter uden for akademiet efter auktionskøb

## Hvad skete der?
En spiller rapporterede i Discord, at en rytter talte i U23-truppen (11 ryttere, 0 pladser), men ikke stod i akademiet og ikke kunne flyttes. Prod-scan: 17 ryttere på 13 hold havde `squad='u23'/'junior'` og `is_academy=false`, og nye tilfælde kom stadig til.

## Root cause
`squad` og `is_academy` er to felter, der skal skrives sammen (#4619). `academy-release` frigiver med `is_academy=false` men beholder `squad`. Den almindelige auktions-finalisering satte kun `seniorSquadPatch()`, når `is_academy===true`, så en fri rytter med ungdomstrup tog sin trup med til køberen. Admin-flyt (`api.js`) skrev også et bart `is_academy=false`.

## Fix
PR #6922: `auctionFinalization.js` bruger senior-patchen også når `isYouthSquad(rider.squad)`; admin-flyt bruger `seniorSquadPatch()`. To tests. Data rettet i prod med backup `riders_squad_orphan_backup_20261019`.

## Forhindret-fremover
Tests dækker fri U23 -> senior og senior uændret. Opfølgning til hovedsessionen: udvid den daglige trup-vagt (#6489) med "hold-rytter med ungdomstrup og is_academy=false".

## Læring
Når to felter beskriver én tilstand, er hver skrivning med kun ét af dem en fejl, der venter. Grep efter bare `is_academy: false` uden `squad` ved hver ny ejerskabssti.
