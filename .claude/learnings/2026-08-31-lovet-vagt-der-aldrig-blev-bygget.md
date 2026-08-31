# En lovet vagt der aldrig blev bygget (#4479)

**Dato:** 31/8 2026 · **Issue:** #4479 · **Klasse:** falsk tryghed, ikke fejlende kode

## Symptom

`docs/ECONOMY_RULES.md` (§2 og §7) og kommentarerne i BÅDE
`backend/lib/economyConstants.js` og `frontend/src/lib/marketValues.js` udpegede
`frontend/src/lib/salaryRateParity.test.js` som den aktive vagt mod at lønsatsen
driver mellem frontend og backend. Filen har aldrig eksisteret. Kun tre omtaler
af navnet fandtes i træet.

## Rod-årsag

Ikke én forglemmelse, men to lag der forstærkede hinanden.

**Lag 1: løftet erstattede vagten.** Begge kodefiler brugte den lovede test som
eksplicit *begrundelse* for at duplikere satsen ("duplikeringen er acceptabel
fordi en paritetstest fanger drift"). Da testen aldrig blev skrevet, var
duplikeringen ubevogtet — men den så bevogtet ud, så ingen kiggede efter. Et
manglende løfte er værre end ingen løfte: det fjerner mistanken.

**Lag 2: den vagt der FANDTES pinnede til en død konstant.** `RULES_NUMBERS.salaryRatePct`
stod 6.7 og var pinnet af `rulesNumbers.test.js` til `SALARY_RATE` (0.067 ×
market_value). Ingen signeringssti har brugt den konstant siden #3989 — den
kørende formel er `current_production_value × SALARY_RATE_PRODUCTION` (0.35).
Guarden var derfor grøn hele vejen, mens `/rules` og `/help` fortalte spillerne
både forkert sats og forkert grundlag. Samme klasse som
`2026-08-28-groent-flueben-der-intet-verificerede.md`: et flueben der verificerer
noget andet end det man tror.

Heldigt udfald denne gang: satsen var faktisk 0,35 på begge sider, så ingen
spiller har set ét lønkrav og betalt et andet. Det var held, ikke en vagt.

## Fix

1. `frontend/src/lib/salaryRateParity.test.js` bygget. Importerer begge sider,
   sammenligner både konstanten og de fire formel-indgange (`getRiderSalary`
   vs `resolveRiderSalary`, `projectSeniorSalary`/`projectYouthSalary` vs
   `computeFrozenSalary`) over hele CPV-spektret. Bevist at den bider: frontend
   sat til 0.36 → 3 af 4 tests fejlede med begge værdier i beskeden.
2. `salaryRatePct` og `academySalaryPct` 6.7 → 35, begge repinnet til
   `SALARY_RATE_PRODUCTION`. `rules.json` (en+da) siger nu "current production
   value" / "nuværende produktionsværdi" — samme ordlyd `help.json` og
   `finance.json` allerede brugte, så ingen ny term introduceres.
3. Backwards-check fandt tre andre kodekommentarer der navngav testfiler som
   ikke findes. Alle tre var stale navne, ikke manglende vagter, og er rettet.

## Forward-guard

`backend/lib/promisedTestFilesExist.test.js`: scanner `docs/`-topniveau (SSOT)
plus al kildekode i `backend/lib|routes|scripts` og `frontend/src` for enhver
omtale af en `*.test.js|ts`-fil og fejler hvis filen ikke findes. Historiske
dokumenter (`docs/`-undermapper, `.claude/learnings/`) er bevidst uden for
scope — en plan fra juni må gerne beskrive noget der siden blev omdøbt.

Guarden har selv tre tandhjul, fordi en scanner der stille holder op med at
matche ville være præcis den fejl den skal fange: en sanity på antal fundne
testfiler, en sanity på antal fundne referencer, og en statisk selvtest af
matcheren mod ét gyldigt og ét brudt løfte.

## Læring

Skriv aldrig "håndhæves af X" før X findes og er kørt rødt én gang. Og når en
guard pinner et player-facing tal: kontrollér at den pinner til den konstant der
faktisk kører, ikke til den der stod der først. En pin til en død konstant er
en grøn check der beskytter ingenting.
