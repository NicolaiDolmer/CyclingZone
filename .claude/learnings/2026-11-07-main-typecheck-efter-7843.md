# Main rød på typecheck efter #7843 (7/11)

**Hvad skete:** #7843 (XP trin 2) var grøn på sin egen gren og blev merget. Bagefter fejlede `tsc -p tsconfig.engine.json/routes.json` på main i `developmentXpFlag.ts`: kaldene til JS-hjælperne fik typer udledt af `null`-standardværdier og afviste en `string`. Fundet, da #7875 (der kører på main) fejlede backend-test-shard 1/3 på typecheck.

**Rodårsag:** grenen var testet mod en ældre main. Imellem kom andre merges (bl.a. #7842 og #7851) i kø, og merge-køen verificerer main-CI efter merge, men den stod i GitHub-kø i over 25 min pga. CI-trængsel, så køen stoppede med "ikke verificeret" uden at nogen opdagede den røde typecheck.

**Rettelse:** #7887, casts i de tre kald (kun typer).

**Forebyggelse:**
- Når merge-køen stopper med "main-CI ikke verificeret", tjek den kørsel, før næste PR køres (gjorde jeg ikke ved de to forrige timeouts).
- Kør `npx tsc -p tsconfig.engine.json && npx tsc -p tsconfig.routes.json` lokalt på grenen rebaset på frisk main, før en backend-PR sendes i køen, når main har flyttet sig siden grenens sidste CI.
