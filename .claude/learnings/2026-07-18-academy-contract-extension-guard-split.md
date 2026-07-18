# Akademi-ryttere kunne ikke forlænge kontrakt uden op-/nedrykning

**Dato:** 2026-07-18
**Issue/PR:** #2179
**Type:** manglende funktionalitet (unødvendig friktion i eksisterende flow)

## Symptom
`POST /api/riders/:id/extend-contract` og `GET /api/riders/:id/extend-quote`
delte SAMME guard-helper (`loadOwnedSeniorRiderForAction`) som `POST
/api/riders/:id/release` — som med vilje afviser akademi-ryttere, fordi
release har sit eget akademi-flow (`academyGraduation.js`). Guarden blev
skrevet til release og genbrugt til extend uden at spørge om
akademi-udelukkelsen faktisk gav mening der. Resultatet: en manager der
ville forlænge en akademi-rytters kontrakt skulle først rykke rytteren op i
seniortruppen, forlænge, og rykke ned igen.

Frontend havde allerede (fra #1779) kompenseret for symptomet i stedet for
roden: `TeamPage`'s `RiderActionModal` viste "extend"-fanen for ALLE
ryttere, men fangede 403'en pænt og viste en forklaring ("akademi-ryttere
styres i dit akademi…") i stedet for evig "indlæser…". Det var en god
UX-patch på et backend-hul, ikke en løsning.

## Rod-årsag
`computeContractExtension()` (contractSeed.js) er fuldstændig
akademi-agnostisk — den genberegner kun løn/kontraktlængde ud fra
market_value/base_value/kontraktfelter, som akademi-ryttere allerede har
sat ved signing (academyIntake.js). Guarden der forhindrede kaldet havde
INGEN teknisk begrundelse for akademi-riters vedkommende — den var bare
kopieret fra release-guarden.

## Fix
Splittede guarden i to funktioner i `backend/routes/api.js`:
- `loadOwnedSeniorRiderForAction` — owner+retired+**akademi**-check.
  Bruges KUN af release/release-quote (akademi har sit eget release-flow).
- `loadOwnedRiderForExtension` — owner+retired-check, INGEN akademi-check.
  Bruges af extend-quote/extend-contract.

Frontend: `RiderManageActions.jsx` (rytterprofilen) fik forlæng-panelet
løftet ud i en delt `extendPanel`-variabel der nu renderes i BÅDE
akademi- og senior-grenen. `TeamPage`'s modal krævede INGEN ændring —
tabben var allerede unconditional, den holder bare op med at ramme 403.

## Lære (forward-guard)
Når en delt guard-helper blokerer flere handlinger, tjek HVER handling
individuelt om ekskluderingen faktisk gælder den — ikke bare "denne
handling deler kode med en anden der har god grund til at blokere X".
Samme mønster som [[feedback_match_ui_filter_for_capacity_logic]], men
omvendt retning: her var UI'et allerede korrekt (viste handlingen), og
det var BACKEND-guarden der var for bred. Relateret: #1799 (akademi-signing
lander forkert på senior) er en anden variant af samme klasse — akademi vs.
senior-antagelser der lækker mellem flows uden eksplicit tjek.
