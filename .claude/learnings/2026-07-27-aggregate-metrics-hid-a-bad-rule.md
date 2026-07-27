# 137 af 137 "rettet" — i begge versioner af en forkert regel

**Dato:** 2026-07-27 · **Issue:** [#3048](https://github.com/NicolaiDolmer/CyclingZone/issues/3048) · **Fundet af:** ejeren, på ét enkelt eksempel

## Hvad skete der

En spiller rapporterede at mellemsprints lå midt på stigninger. Kodefixet flyttede dem til `crest_km + 1` — én kilometer efter toppen. Data-reparationen af sæson 2 rapporterede: **137 af 137 rækker rettet, 0 tilbage på en stigning.** Efterkontrollen var grøn. Alt så færdigt ud.

Ejeren bad om at se fem eksempler visuelt "så jeg ved at det følger virkeligheden". Ved at tegne dem op blev det tydeligt at `crest+1` er en nedkørsel — et sted rigtige løb aldrig lægger en spurt. Reglen blev skrevet om til dalplacering. Anden version rapporterede igen: **137 af 137 rettet, 0 tilbage.** Samme grønne tal.

Ejeren kiggede på de fem etaper igen og afviste én: Vuelta a los Picos etape 4 havde fået sin spurt i et 6 km hul mellem to kategori 1-stigninger. Reglen valgte den *længste* dal, og på en etape med fire store stigninger var 6 km det længste inden for søgevinduet. Tredje version krævede mindst 15 km og valgte den dal der lå tættest på midten af løbet. Først dér var den rigtig.

## Læringen

**Efterkontrollen målte det forkerte.** "0 sprints inde i et klatresegment" var sandt i alle tre versioner — også de to forkerte. Metrikken bekræftede at reglen var *anvendt*, ikke at den var *rigtig*. Et aggregat der går fra 137 til 0 føles som bevis, men det beviser kun at koden gjorde det den blev bedt om.

De to fejl blev fanget af at se på konkrete, navngivne tilfælde — ikke af tal. Og det var domæneviden, ikke kodelæsning, der fangede dem: man skal vide hvor en cykelspurt hører hjemme for at se at en nedkørsel og et hul mellem to bjerge begge er forkerte.

## Hvad jeg gør anderledes

- **Ved regel-ændringer der rammer mange rækker: vis 3-5 konkrete tilfælde visuelt, før reparationen køres.** Ikke som rapportering bagefter — som gate før.
- **Vælg eksemplerne til at være ubehagelige**, ikke repræsentative: den etape med flest stigninger, den korteste, den længste. En middeletape bekræfter altid.
- **Skriv en anden efterkontrol end den der definerede problemet.** Her var "0 på en stigning" cirkulær. De rigtige mål viste sig at være *kvaliteten* af placeringen — mindste dal, gennemsnitlig dal, fordeling over etapen — og de skiftede fra 6/19 km til 15/27 km mellem version to og tre, mens hovedmetrikken stod stille på 0.
- **Når ejeren beder om at se noget visuelt, er det ikke en formalitet.** Begge fejl blev fundet dér, og ingen af dem ville tallene have afsløret.

## Relateret

- Memory: `feedback_show_visuals_proactively_during_work`, `feedback_simulate_before_ship_balance`, `feedback_runtime_verify_first`
- Backup af de 137 rækkers oprindelige data: `backup_3048_20260727_sprints`
