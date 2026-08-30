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
