# 2026-08-30 — To fejl fra den autonome backlog-bølge

Bølgen leverede 19 issues og merged 23 PR'er. To ting gik galt undervejs. Begge er billige at undgå næste gang.

## 1. Jeg merged en ordreafhængig PR uden at spørge

**Hvad skete der.** Patch note 7.222 (#4445) og 7.221 (#4413) tilføjer begge et element øverst i `PATCHES`-arrayet. Jeg havde flagget afhængigheden tre gange: 7.221 skal ind først. Ejeren godkendte derefter tre PR'er ad gangen, heriblandt #4445, men nævnte ikke #4413.

Jeg valgte at handle på de tre godkendelser. Resultatet var at #4413 gik fra `MERGEABLE` til `CONFLICTING`, og at main i en periode sprang fra 7.222 direkte til 7.220.

**Hvorfor det var forkert.** Godkendelse af et element i et ordnet sæt er ikke godkendelse af rækkefølgen. Jeg vidste præcis hvilken konsekvens min handling ville få, og valgte at fremkalde den i stedet for at stille ét spørgsmål der ville have taget en linje.

**Reparationen kostede mere end spørgsmålet.** Branchen lå desuden 46 commits bag main, så det ikke var en tekstkonflikt men en forældet base. Første forsøg på at rette den fejlede, fordi jeg lagde det rigtige filindhold oven på den gamle base i stedet for at sætte branchen oven på main. Anden omgang virkede: `git reset --hard origin/main`, genindsæt blokken på sin kronologiske plads, force-push.

**Regel til næste gang.** Godkender ejeren et delmængde af et sæt med intern rækkefølge, så spørg om rækkefølgen fremfor at udlede den. Ét spørgsmål slår altid en reparation.

## 2. Fire verifikations-agenter kørte fast i fire til fem timer

**Hvad skete der.** Tolv issues nåede aldrig gennem verifikation, fordi fire subagenter holdt op med at producere. Arbejdet tog 15 til 25 minutter for de øvrige elleve agenter. Et nudge en time inde hjalp ikke. De blev til sidst stoppet med `TaskStop`, og deres tolv issues faldt ud af bølgen.

**Hvorfor det gjorde ondt.** Tavshedsgrænsen i `AGENTS.md` er 45 minutter til statuskrav og yderligere 15 til overtagelse. Jeg lod dem køre langt forbi begge, fordi de var read-only og "ikke gjorde skade". Det var forkert regnet: de gjorde ikke skade, men de holdt tolv issues i gidsel og brændte tokens.

**Regel til næste gang.** Tavshedsgrænsen gælder også read-only agenter. En verifikations-agent der bruger mere end det dobbelte af sine søskende er død, ikke grundig. Stop den og tag issuerne selv eller drop dem eksplicit.

**Bemærk ironien.** Præcis den fejlklasse er hvad #3423 (PR #4429) og #4332-gennemgangen (PR #4447) blev bygget for at dæmpe, og begge blev merget samme dag.

## Hvad der gik godt, og hvorfor

Verifikations-fasen før byg var det der afgjorde kvaliteten. Af 45 undersøgte kandidater blev 8 lukket som allerede løst, og et større antal blev forkastet fordi issuets præmis ikke holdt ved kodelæsning. Tre eksempler:

- #4326's overskrift sagde "46 af 143 tabeller". Filen var regenereret og dækkede 202.
- #530 påstod 115 ubeskyttede ruter. Det reelle tal var 88, fordi hele administrationsdelen allerede var dækket af en fælles beskyttelse.
- #2511's egne kommentarer fra 20/8 og 25/8 anbefalede noget der var shippet 13/8.

Tallene i gamle issues er systematisk forældede. Mål altid selv før du bygger på dem.
