# Et afledt tal skal beregnes, ikke læses op af sin egen opsummering

**Dato:** 2026-08-14 · **Hvor:** #3762, migrationen af `training_plans`

## Hvad skete der

Ejeren skulle vælge migrations-regel for 4.589 træningsplaner. Jeg lagde en
mapnings-tabel frem og skrev at **516 planer skifter intensitet**. Han traf
beslutningen på det tal.

Da migrations-scriptet kørte samme aften, var det rigtige tal **2.922**.

Jeg havde talt de rækker i min egen tabel hvor jeg havde *skrevet* et
niveau-skift ("vo2max let → hård", "endurance hård → let") og overset at
`normal` også flytter sig: en zone-plan på normal bliver til en **hård**
session, fordi zonerne kun findes som hårde dage. Det er 1.593 planer alene.

Værre end afvigelsen: retningen. 1.928 af de 2.922 flytter **opad** i
belastning, og 1.085 af de ryttere har allerede træthed ≥ 70, hvor
skaderisikoen tænder. Migrationen ville have kostet ~109 skader dag 1 hos
managere der aldrig havde valgt hård træning. Ingen af de tal fandtes i
beslutningsgrundlaget, fordi jeg ikke havde kørt afledningen.

## Rod-årsagen

Jeg behandlede min egen opsummerings-tabel som data. Tabellen var lavet for at
*forklare* mapningen, ikke for at *tælle* den, og de to ting kræver forskellig
omhu: en forklaring må gruppere ("vo2max hård/normal → Intervaller"), en optælling
må ikke.

Det er samme familie som `feedback_verify_numbers_from_specs_before_shipping`:
et tal er ikke verificeret af at stå i noget jeg selv har skrevet.

## Hvad der skal gøres anderledes

- **Kør afledningen før du citerer den.** Mapnings-scriptet tog 20 minutter at
  skrive og kunne have kørt som dry-run FØR beslutningen blev stillet, ikke efter.
- **Spørg altid om retningen, ikke kun antallet.** "Hvor mange rækker ændrer sig"
  er en svagere måling end "hvor mange bliver hårdere". Den første skjulte en
  skade-spike; den anden afslørede den med det samme.
- **Når et tal indgår i en ejer-beslutning, skal kilden stå ved siden af.**
  Skriver jeg "516", skal jeg kunne pege på kommandoen der producerede det.

## Hvad der virkede

At bygge migrationen som et dry-run-script med tallene i output, i stedet for at
skrive dem i en PR-beskrivelse. Det var dét der afslørede fejlen mens den
stadig kunne rettes, og reglen der kom ud af den (de 1.928 starter på hvile) er
nu en testet funktion i libbet frem for en note i et dokument.
