# Postmortem · 2026-07-30 · Ubegrænset kontraktforlængelse (#3143)

## Hvad skete der?
Spillere opdagede (rapporteret i Discord af @friisisch + bekræftet af @adorable_chipmunk_89342) at man kunne klikke "Forlæng kontrakt" igen og igen på samme rytter i én session og dermed låse en lav løn helt frem til sæson 11+ — for både akademi- og senior-ryttere.

## Root cause
`POST /api/riders/:id/extend-contract` (backend/routes/api.js) håndhævede owner/retired-guards + en løn-stignings-guard (#2237), men intet loft på ANTAL forlængelser. #2424/PR #2548 clampede kun `contract_length` pr. kald til 1-3 sæsoner — men `contract_end_season` (udløbssæsonen) blev beregnet som `max(eksisterende_end, currentSeason) + 1` pr. kald i `computeContractExtension()` (backend/lib/contractSeed.js), uden nogen øvre grænse. Gentagne kald akkumulerede uendeligt.

## Fix
Tilføjede `CONTRACT.MAX_EXTENSION_SEASONS_AHEAD = 3` + `maxAllowedContractEndSeason(currentSeason)`-helper i backend/lib/contractSeed.js. En delt `contractExtensionCapError()`-helper i backend/routes/api.js afviser eksplicit (409, `contract_extension_cap_reached`) når `next.contract_end_season > currentSeason + 3` — håndhævet i BÅDE `POST /extend-contract` (før DB-write) og `GET /extend-quote` (preview), så de aldrig kommer ud af sync. Loftet er forankret i NUVÆRENDE sæson, ikke rytterens eksisterende `contract_end_season` — ellers ville loftet flytte med hver forlængelse og aldrig binde reelt.

## Forhindret-fremover
Tests i backend/lib/contractSeed.test.js beviser at et 10-forsøgs loop af gentagne forlængelser konvergerer PRÆCIS på loftet, aldrig forbi. Route-tests i backend/lib/riderActionsRoutes.test.js verificerer at begge routes kalder guarden, og at tjekket sker FØR `.update()`-kaldet (statisk source-position-check).

## Læring
Et pr.-kald-clamp (#2424: `contract_length` 1-3) beskytter kun mod ÉT kald ad gangen — det stopper ikke akkumulering over GENTAGNE kald. Når en handling kan gentages fritLøbende af brugeren, skal loftet være forankret i en ABSOLUT reference (her: nuværende sæson), ikke i feltets EGEN forrige værdi — ellers "vandrer" grænsen med hver anvendelse i stedet for at binde.
