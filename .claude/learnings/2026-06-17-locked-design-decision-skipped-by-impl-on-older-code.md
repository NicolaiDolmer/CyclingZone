# Låst design-beslutning sprunget over (impl byggede på ældre kode + tests frøs forkert forventning)

**Dato:** 2026-06-17
**Issue/PR:** #1122 (rod), fix i #1434 (typer) + #1435 (værdi). Refs #49, #1101.
**Symptom (ejer-observeret):** "Ryttertyperne følger ikke det vi har aftalt."

## Hvad skete

Design-session 2 (15/6, `docs/decisions/rider-ability-system-v2.md` §0.1 **Beslutning 6**)
låste **8 typer — `leadout` skåret** (benchmark: næsten-død, foldes i sprinter/rouleur).
Men #1122-implementeringen (go-live #1428, gc-fix #1432) byggede oven på den ældre
9-type-kode (#1133, 7/6, FØR design-sessionen) og fik **aldrig fjernet leadout**.

Resultatet på prod var det stik modsatte af intentionen: `leadout` var endt som
**næst-største type** (2.119 primær, 3.364 = 37 % inkl. sekundær), fordi z-score+kontrast
tildelte den bredt — ægte sprintere blev fejlmærket som lead-outs.

Det blev ikke fanget før ejeren bemærkede det med øjnene.

## Rod-årsager

1. **SSOT superseder kode, men ingen verificerede at de låste beslutninger faktisk landede.**
   En senere "go-live"-PR (#1428) blev antaget at have implementeret hele design-doc'en;
   ingen diffede den endelige type-liste i koden mod §0.1's endelige liste.
2. **Testene frøs den forkerte forventning.** `riderTypes.test.js` asserterede
   `RIDER_TYPES.length === 9` og listede leadout eksplicit. Testen var skrevet til at
   matche den (stale) implementering, ikke SSOT — så den var grøn mens den var forkert.
   Samme mønster i `fictionalRiderGenerator.test.js` + `archetypePhysiology.test.js`
   ("alle 9 typer/arketyper").
3. **Ingen fordelings-sanity-check.** At leadout var 2. største type modsagde direkte
   begrundelsen for at skære den ("næsten-død"). En simpel "matcher fordelingen
   intentionen?"-check ville have råbt op.

## Hvad fang det / hvad ville have fanget det tidligere

- **Diff implementering mod SSOT's *endelige* liste**, ikke mod et tidligere doc-forslag,
  når en design-session eksplicit superseder kode (§0.1: "Ved konflikt vinder §0.1").
- **Tests skal referere SSOT, ikke fryse nuværende adfærd.** En test der siger "8 typer
  jf. §0.1 Besl. 6" havde fejlet rødt på den stale 9-type-kode i stedet for at blofæste den.
- **Fordelings-sanity mod intentionen** (simulér-før-ship): en type der skulle være
  "næsten-død" men er 2. størst = rødt flag.

## Sekundære fund (rettet i samme omgang)

- **Type-backfill sprang retired ryttere over** (`is_retired=false`-filter), men retired
  ryttere vises på profiler/Hall of Fame → de stod med tomt badge efter type-fjernelsen.
  Fjernet filteret (matcher base_value-backfill, der allerede dækker alle). Forward-guard:
  enhver fremtidig type-ændring dækker nu også retired.
- **Værdi-koblingen var skjult:** `market_value` er en GENERATED-kolonne af `base_value`
  (= model-output med `offset[primary_type]`). Type-backfill alene efterlod ~2.119
  re-klassificerede ryttere med en værdi beregnet på det gamle leadout-offset → værdimodel-
  re-fit + base_value-backfill var nødvendig for at lukke kæden.

## Regel-destillat

> Når en design-session låser en beslutning der superseder eksisterende kode: diff den
> endelige implementering mod SSOT'ens endelige liste, og skriv tests der refererer SSOT
> (ikke fryser nuværende adfærd). En grøn test der koder den forkerte forventning er værre
> end ingen test. Sanity-tjek altid fordelingen mod intentionen.
