# En regel der kun er en test-assertion er ikke håndhævet (#4203)

**Dato:** 2026-09-03 · **PR:** #4718 · **Område:** kalender-generatoren

## Hvad skete der

§4 i `docs/CALENDAR_RULES.md` har siden 21/8 sagt at monumenterne skal ligge spredt over
sæsonen: mindst 2 kalenderdage mellem naboer, mindst 14 dages samlet spredning. Reglen
levede udelukkende som to `assert`-linjer i `raceCalendarLanePackerInvariants.test.js`.

Ved 31 kalenderdage passede den af sig selv. Da ejeren 3/9 valgte 28 dage til sæson 4,
holdt den op: pakkeren lagde to monumenter på nabodage. Testen blev ikke rød på en måde
der stoppede noget — den blev opdateret til en "kendt tilstand"-vagt (`KENDTE_TAETTE_NABOPAR = 1`)
med en henvisning til at reparationen hørte til et andet spor.

Samme mønster ramte monument-i-GT-reglen fra den anden side: den fik en rigtig gate (#4709,
`detectMonumentsInsideGrandTours`, hård, ingen override), men gaten kunne kun sige FRA.
Ingen kode fortalte pakkeren hvor et monument SKULLE ligge, så S4's plan blev bygget med
2 brud og `--apply` var blokeret.

## Rod-årsag

En regel kan stå tre steder, og de er ikke ligeværdige:

1. **En assertion i en test** — måler ét udfald mod én fixture. Ændrer forudsætningen sig
   (28 dage i stedet for 31), er svaret at opdatere testen, ikke koden.
2. **En gate** — siger fra når reglen er brudt. Nødvendig, men den bygger ikke en kalender
   der overholder reglen; den forbyder bare at skrive den forkerte.
3. **En binding i generatoren** — den eneste af de tre der får reglen til at HOLDE.

§4 havde 1 og (siden #4709) 2, aldrig 3. §9's egen tekst sagde det ordret om spredningen
("MÅLT her, men aldrig HÅNDHÆVET i pakkeren"), og det blev alligevel læst som en note frem
for som en mangel.

## Hvad der blev gjort

Reglerne er nu bindinger i `solveContiguousStarts` (R9-R11), konstanterne i
`calendarTierCaps.js`, og SSOT'en er opdateret i samme PR.

**Den oplagte lap virkede ikke — og det var værd at måle før den blev bygget.** Et monument
er et 1-etapes løb som enhver klassiker, så et slot-bytte efter søgningen ser gratis ud.
Målt på S4-planen lå kun 7 af D1's 19 endagsløbs-slots uden for et GT-vindue, i to klumper
på 4 og 3 datoer i træk: 4 mulige slots til 5 monumenter. Reglen kunne ikke opfyldes af en
oprydning, uanset hvor smart den var skrevet.

## Forward-guards

- `raceCalendarLanePackerInvariants.test.js` går fra kendt-tilstand-vagt til at håndhæve
  reglen (0 for tætte nabopar, ikke 1).
- Ny `raceCalendarLanePackerMonuments.test.js`: R9, R10, R11, kronologi, at de øvrige
  invarianter er urørte, determinisme — og at pakkeren **siger fra højlydt** når reglerne
  er uopfyldelige i stedet for at lyve grønt (`monumentRulesHeld` + `solveAttempts`).
- Pakkeren rapporterer `monuments`-diagnostik på begge akser, så dry-runnet kan måle
  afstanden til reglen i stedet for kun at få et ja/nej.

## To bifund fra samme session

**Et script der aldrig er kørt, er ikke verificeret.** `dumpRacePoolFixture.mjs` bar selv
sætningen "DETTE SCRIPT ER SKREVET, IKKE KØRT". Første kørsel døde med det samme:
`fetchAllRows(buildQuery, pageSize)` blev kaldt som `fetchAllRows(sb, (query) => ...)`.
Headeren advarede om at scriptet ikke var kørt; ingen læste det som "og derfor virker det
måske ikke".

**En fixture der ikke følger prod, tester en verden der ikke findes.** Snapshottet var
taget før `2026-08-25-4218-katalog-22-nye-loeb.sql`, og kompensationen var en IN-MEMORY
katalog-udvidelse i `s3OfflineCalendarPlan.mjs`. Da fixturen blev genopfrisket, blev
udvidelsen til 22 navnekollisioner. Kompensationen er fjernet — men den havde ligget som
et permanent lag oven på en fixture ingen havde et fast tidspunkt for at genopfriske.

## Læring, kort

Når du læser "reglen måles her, men håndhæves ikke i generatoren" i en SSOT: det er et
åbent hul, ikke en note. Og et hul der kun kan lukkes i generatoren, kan ikke lukkes af en
gate — mål om reparationen overhovedet er mulig efter det sted du havde tænkt dig at lave
den, før du bygger den.
