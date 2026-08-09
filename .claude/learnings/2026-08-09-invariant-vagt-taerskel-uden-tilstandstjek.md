# En invariant-vagt må ikke gætte på varighed når den kan spørge om tilstand

**Dato:** 2026-08-09 · **Fundet af:** daglig Sentry/Railway-triage · **Sentry:** CYCLINGZONE-48 · **PR:** #3544 · **Refs:** #3330, #2647

## Hvad skete der

Ownership-invariant-vagtens invariant E (#3330) meldte dagligt "1 rytter med pending_team_id parkeret > 48t" — 29 events på 4 dage. Der var intet galt. Rytteren (Tobias Richter) var midt i "O Gran Camiño Menor", et 4-etape-løb hvor 3 etaper var kørt efter 55 timers realtid. Handlen var en helt lovlig deferral (#1995): flushen kan først køre ved løbs-finalisering.

## Rod-årsag

Tærsklen på 48t byggede på en **skønnet varighed**, skrevet direkte i koden:

> "bevidst længere end det længste fleretape-løb realistisk kan tage (typisk 1-3 dages afvikling i denne motor)"

Skønnet var forkert. Et fleretape-løb spænder over flere game-days, og game-days er realtids-pacede — så 4 etaper tager let over 48 timer, og et længere løb tager tilsvarende mere. Tærsklen målte altså på en variabel ingen havde kontrol over.

Det tragikomiske: kommentaren lige over tærsklen citerer CYCLINGZONE-31-lektien om at *"en for stram tærskel spammer Sentry på lovlige, langvarige tilstande"* — og faldt så i præcis den fælde, fordi tærsklen blev valgt ud fra et gæt i stedet for en målt værdi.

## Den egentlige læring

**Vagten havde allerede adgang til det rigtige signal og brugte det ikke.** Heal-sweepen (`deferredTransferHealSweep.js`) — den der faktisk reparerer klassen — bruger `getRidersInActiveStageRace` som diskriminator: "rør aldrig en rytter der stadig kører". Vagten, der er backstop for netop den sweep, brugte i stedet et ur.

Når en vagt og dens reparatør er uenige om hvad "problem" betyder, larmer vagten på det reparatøren med vilje lader ligge.

Reglen: **en invariant skal formuleres som en tilstand, ikke som en varighed.** "Parkeret og løbet er ovre" er en tilstand systemet kan svare på. "Parkeret i mere end 48 timer" er et gæt på hvor lang tid en tilstand plejer at vare. Brug kun tid som *sekundært* kriterie — et vindue der giver reparatøren en chance for at nå det først — aldrig som det eneste.

Efter fixet er invariant E "gammel parkering MEN intet aktivt løb" = præcis den tilstand hvor heal-sweepen burde have virket og ikke gjorde. Det er et ægte backstop.

## Sekundært fund samme sted

`cron.js` loggede kun 3 af vagtens 5 tællere. Et brud på invariant D eller E printede derfor:

```
🚨 Ownership-invariant-vagt: brud fundet — youthOwned=0, sellerlessOwned=0, staleIntake=0
```

"Brud fundet" efterfulgt af tre nuller. Den linje er værre end ingen linje: den får en ægte alarm til at ligne en fejl i vagten. Da invariant D og E blev tilføjet, blev log-linjen ikke opdateret — den blev skrevet dengang der var tre invarianter og blev aldrig rørt igen.

**Regel:** når et aggregat udvides med et nyt felt, er log-/rapporterings-linjen en del af feltets kaldested. En tæller der ikke logges, findes ikke når nogen fejlsøger kl. 23.

## Forward-guard

- Ny test: `CYCLINGZONE-48 ingen alders-kandidater → race-opslaget kaldes SLET IKKE` — låser at det ekstra opslag kun sker når der er kandidater
- Ny test kører den **ægte** `getRidersInActiveStageRace` mod mockede `races`/`race_entries`, ikke en DI-stub, så query-formen (race_type/status/stages_completed) er dækket
- Vasco-klassen (parkeret 40+ dage, intet aktivt løb) har egen test og fanges uændret
- `cron.js`-kommentar siger nu eksplicit: "Nye invarianter SKAL med her"

## Backwards-check

Gennemgået om andre vagter bruger en gættet varighed hvor en tilstand var tilgængelig:

- `aiTeamTrimHealSweep.js` (STALE_BACKSTOP_HOURS) — har allerede tilstandstjek (`pending_removal_at` + inflight-guard); tiden er dér korrekt et sekundært backstop
- `academyIntakeExpirySweep.js` — tid er selve forretningsreglen (tilbud udløber), ikke et gæt på hvor længe noget plejer at tage

Ingen yderligere forekomster fundet.

## Prod-verifikation

```
aged_over_48h = 1   →   breaches_after_fix = 0
```

4 parkerede handler i prod, 1 over 48t, alle 4 i aktivt etapeløb → alarmen forsvinder uden at maskere et ægte brud.
