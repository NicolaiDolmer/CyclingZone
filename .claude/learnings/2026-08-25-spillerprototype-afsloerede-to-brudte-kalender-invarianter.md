# En spillerprototype afslørede to brudte kalender-invarianter

**Dato:** 2026-08-25
**Kontekst:** Planning Center fase 2, Z1-sæsonmatrixen (#1146). En spiller byggede en
interaktiv prototype af rytter×løb-gitteret og delte den med ejeren.

## Hvad der skete

Prototypen blev læst som "input til vores design". Den viste sig at være noget andet:
en præcis påstand om to kalender-invarianter, som vi ikke holder i prod.

**Vigtig kredit-rettelse (samme dag):** han byggede videre på VORES egen preview,
`frontend/public/race-planning-preview.html`, shippet 20/8 i #4022. Gem plan, Ryd alle
udtagelser, sorteringen, filtrene inklusive "Clashes only" og rolle-cellerne var vores
allerede. Jeg tilskrev ham fire af dem, indtil ejeren pegede på linket. Hans faktiske
bidrag er ét og det er større: vores preview definerede et løb ved `start`/`end`-DATOER
og målte overlap på delte datoer; han skiftede til `d1`/`d2`-LØBSDAGE. Det skift er det
der afslørede fejlen.

Han skriver dem selv i kommentarer i sin egen kode:

> `d1`/`d2` are race-day numbers straight from the season plan — overlap is measured
> on those, never on dates.

> Race days 0–74 across 27 calendar dates. Each date carries 2–4 race days, so the
> axis is uneven: this table IS the calendar.

Hans `RACE_DAY_BANDS` er en liste af sammenhængende intervaller — `[0,1],[2,3],[4,5],
[6,7],[8,9],[10,12],…` — hvor hver dato ejer ét interval af løbsdage. Det garanterer
to ting, som hans gitter ikke kan tegnes uden:

1. **En løbsdag hører til præcis én dato.** Målt i prod, sæson 3: brudt for 25 af 89
   løbsdage i D1 og 21 af 47 i D3. → [#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236)
2. **Et løbs løbsdage ligger i træk.** 32 af hans 33 løb har spænd lig etapetal. I prod
   har 11 af 13 D1-løb huller, største hul 12. → [#4190](https://github.com/NicolaiDolmer/CyclingZone/issues/4190)

Invariant 1 er årsagen til de fire tynde endagsløb, som stod som `🎯 Next action` i
NOW.md. Le Mur de Huy (16 ryttere mod 101-128) deler løbsdag 29 med Tour des Émirats,
der sluttede dagen før. Feltet var ikke lovligt at fylde — auto-udtagelsen fordelte
rigtigt.

## Lektionen

**Et spiller-mockup er også en måling.** Han tegnede den kalender han troede vi havde.
Forskellen mellem hans model og vores prod-data var diagnosen — og den var gratis.
Vi havde selv kørt akse-reparationen (#4161) og bindingsfixet (#4173) to dage
forinden, uden at opdage at datoerne var faldet fra hinanden bagefter.

Fejlklassen er den samme som #4155 og #4161: **hændelsen opstod i DATA, ikke i kode**,
og alle fire kalender-invarianter rapporterede grønt imens. En invariant der kun måler
det den kender, tier om resten.

## Hvad vi gør anderledes

1. **Ny invariant i `verify-invariants`:** to løb i samme pulje må ikke dele løbsdag
   uden at dele kalenderdato. Den ville have fanget både dette og sæson 2's ti tilfælde.
2. **Prototyper fra spillere læses som målinger.** Når nogen bygger en model af vores
   system, er afvigelsen mellem deres model og vores data et fund — ikke en misforståelse
   der skal rettes hos dem.
3. **Ejer-mandat 25/8:** matrixens celler bliver kladde-baserede med ét samlet gem, fordi
   `marketWriteLimiter` tillader 30 skrivninger pr. 60 sekunder, og bulk-redigering af
   40 celler ville fejle midtvejs. Fundet kom af at læse hans "Save plan"-knap og
   spørge hvorfor den var der.

## Hvad vi tog med fra prototypen

Begge akser samtidig (dato-kalender + løbsdags-strip) · roller i cellen (C/S/B/F/D)
frem for flueben · låsepanel med navngivet årsag og ét-kliks-fix ("Lozano is riding
Tour des Émirats, which shares race days with Le Mur de Huy" → "Unassign from Tour des
Émirats") · fodnoten som live problem-tæller ("No problems" i grønt, ellers antal) ·
filteret "Problem entries only" som femte linse · cap-advarslen på løbsdags-aksen ·
trupstørrelse pr. klasse i cellen · roster-panel sorteret efter rolle.

Ikke taget med: hans route match `/60` (placeholder — vi har ægte 0-100 i
`frontend/src/lib/suitability.js`) og hans spænd-baserede overlap (vores dag-mængde
siden #4173 er mere korrekt).

## Refs

#1146 · #4236 · #4190 · #4161 · #4173 · #4218 · #4022
