# En vagt der fejler tavst er ingen vagt (#4453)

**Dato:** 30/8-2026 (natbølge, spor "Vagt på Railway-logstrømmen")

## Rod-årsag

Første version af `scripts/ops/railway-log-watch.mjs` hentede logs pr. deployment
med `allowFail: true`, fordi en enkelt bortrullet deployment ikke skal vælte hele
kørslen. Kaldet manglede `--environment`, så Railway-CLI'en afviste **alle** 10
deployments med `No environment specified`. Scriptet fangede fejlen, kastede den
væk, og rapporterede glad:

```
== Totaler pr. tag ==
  (ingen strukturerede signaler i vinduet)
[railway-log-watch] OK - ingen taerskel-brud, ingen nye fejlklasser.
```

Grøn linje, nul data. Nøjagtig den fejlmåde issuet blev oprettet for: et korrekt
signal uden modtager. Kun fordi jeg fra en manuel kørsel vidste at prod
producerede `graduation sweep failed` hvert 5. minut, opdagede jeg det.

## Fix

To ting, ikke én:

1. `--service` + `--environment` med på log-kaldet (den egentlige fejl).
2. `collectWindow` kaster nu hvis **alle** hentninger i vinduet fejlede, og
   printer `ADVARSEL: N af M deployments kunne ikke hentes` hvis kun nogle gjorde.
   Nul fund er kun et resultat når vi faktisk har set på noget.

## Læring

Isolationsmønsteret "lad ikke én fejl vælte hele kørslen" (samme som per-rytter
try/catch i graduerings-sweepet) har en bagside: en **systematisk** fejl ser
ud som et sundt nul. Enhver `allowFail`-løkke skal tælle sine fejl og skelne
mellem "én fejlede" og "alle fejlede".

Sekundært: et tal i et gammelt issue er en hypotese. #4453 sagde "~25
strukturerede signaler" og 787 `console.warn`/`console.error`. Målt 30/8: 832
kald, heraf 89 kaldsteder med `[tag]`-præfiks fordelt på **49** distinkte tags.
`[fatal]` blev listet som runtime-signal, men findes kun i `backend/scripts/` og
når aldrig Railways logstrøm.

## Anden runde: jeg fiksede én forekomst af fejlklassen, ikke klassen

Adversarisk review af PR #4469 (31/8) fandt **fire flere** veje til grøn-med-nul-
eller-halv-data i præcis det script der var bygget for at lukke fejlmåden:

1. `collectWindow` kastede kun når `ids.length > 0 && failed === ids.length`.
   Var `ids` tom, faldt vagten igennem som "ingen fund". Railway har altid mindst
   ét deployment i drift, så en tom liste betyder at CLI'ens JSON-form har
   ændret sig, og workflowet installerer `@railway/cli` **upinnet**.
2. Delvis hentefejl (49 af 50) nåede kun Actions-loggen som en `ADVARSEL`.
   `GITHUB_OUTPUT` bar kun `has_findings`, så halv data gav grønt flueben,
   intet issue og ingen Discord-ping.
3. Trunkering ved `maxDeployments` og `linesPerDeployment` var tavs. Listen er
   nyest-først, så loftet skærer de ældste timer væk, og en undertælling der
   lander under alle tærskler ser ud som et sundt døgn.
4. Selve forward-guarden målte ingenting: `walk()` slugte `fs.statSync`-fejl med
   `catch { return out; }`, og `RUNTIME_PATHS` indeholdt `backend/middleware`,
   som ikke findes i repoet. Reviewet **beviste** det ved at køre de fire filer i
   et træ uden `backend/`: 25 tests, 25 pass, inklusive guarden. Testen
   asserterede kun at `missing` var tom, aldrig at scanneren havde fundet noget.

Dertil så tag-scanneren kun `console.warn|error`, mens `classifyLine` tæller
enhver linje der starter med `[tag]` uanset niveau. `[discord-dm:stdout]`
(`console.log`) og `[discord-dm:muted]` (`console.info`) var derfor usynlige for
guarden og havde hverken tærskel eller ignore. Målt efter udvidelsen: **52** tags
/ **99** kaldsteder, ikke 49/89.

## Læring, skærpet

Da jeg fandt fejlklassen "tomt måleresultat ligner et sundt nul", rettede jeg det
sted hvor den havde bidt mig, og skrev postmortem om den. Backwards-checket
manglede: jeg gik ikke det samme script igennem for de **andre** steder hvor
"ingen data" og "alt er fint" er umulige at skelne. Der var fire.

Konkret regel til næste gang: når en guard bygges, så prøv at få den til at melde
grønt uden data: slet inputmappen, tøm listen, lad alle kald fejle. Kan den det,
er den ikke færdig. Og enhver forward-guard-test skal asserte **både** at der
ikke er afvigelser **og** at der blev målt noget (`found.length >= N`).
