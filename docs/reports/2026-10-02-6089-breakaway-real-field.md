# #6089: morgenudbruddet i rigtige felter (2/10)

Kvalitativ rapport. Tal, holdnavne og fordelinger ligger privat i `balance-internals/6089/` (`tal-2026-10-02.md`, `foer-efter-6089.png`).

## Konklusion

"Udbruddet vinder aldrig" var en maalefejl i dry-run-scriptet, ikke motoren. Med korrekt maaling er billedet i Giroens rigtige felt det modsatte: under `orders_gc_v1` vinder udbruddet for ofte paa bjerg- og kuperede etaper. Hovedaarsagen er at klassementsryttere med udbrudsordre fik det samme ekstra forspring som et harmloest udbrud. Den del er rettet. Et tredje loeb viser et andet problem (alt for faa ryttere maa forsoege udbruddet), som kraever en ejer-beslutning.

## 1. Maalingen

`dryRunUpcomingStage.mjs` testede om vinderen var i udbruddet med `components.breakaway === true`, men broen saetter feltet til 1/0. Testen var derfor altid falsk, og `winner_from_break` var 0 paa alle etaper uanset regler. Scriptet bruger nu motorens egen dom (`breakaway_win`) og viser desuden "vinder fra morgenudbruddet" og "udbrud foran favoritterne".

Scriptet koerer hver etape for sig uden klassement. Under `orders_gc_v1` slukker det GC-reaktionen. Maalingerne nedenfor koerer derfor hele touren i raekkefoelge med det akkumulerede klassement, som `raceRunner` giver motoren i prod.

## 2. Hvorfor udbruddet vandt for ofte i Giroen

- Flere menneskehold satte deres kaptajn til "Forsoeg udbrud" paa naesten hver etape. Det er tilladt efter rolle-reglerne og ingen violators.
- Under `orders_gc_v1` giver feltet morgenudbruddet ekstra lad-gaa-plads (#5955). Ifoelge koden er pladsen til et ikke-farligt udbrud. Den blev ogsaa givet til et udbrud med klassementets foerer eller en rytter tæt paa.
- GC-reaktionen (#5978) og GC-bremsen reagerede korrekt paa truslen. Bremsen daemper dog kun vaeksten, ikke loftet, saa hullet naaede alligevel det fulde ekstra loft.
- Resultatet var et selvforstaerkende moenster. Udbrydere vandt mange minutter, blev klassementets top og sad i udbruddet igen dagen efter med samme plads.

## 3. Rettelsen (kun `orders_gc_v1`)

Rummer udbruddet en alvorlig GC-trussel, som et hold i jagtgruppen reagerer paa, daempes det ekstra lad-gaa-forspring. Det er samme dom som GC-bremsen, og daempningen svarer til gulvet fra #6074, som gaelder naar hele feltet lader gaa. Der er intet nyt tal, kun et eksisterende gulv genbrugt. Et harmloest udbrud faar uaendret plads. Legacy er byte-identisk: golden fixtures og hel-tour-maalingen paa tre loeb gav samme resultat foer og efter.

Effekt i de rigtige felter (kvalitativt):

- Giroen: bjerg og hoejt bjerg falder tydeligt mod ejer-maalet (udbrud foran favoritterne ca. 45 %), men ligger stadig over det. Kuperet er naesten uaendret og flad er stadig sjaelden. Udbruddet vinder stadig jævnligt paa bjerg og kuperet.
- Giro delle Alpi Orientali: bjergetaperne lander omkring ejer-maalet. Flad og rullende er uaendret.
- Kalibreringsharnessen (AI-felter): udbrudssejre falder moderat paa alle profiler, mest paa kuperet. Legacy er uaendret.
- replay5957 (specialist-korrelation): uaendret. Replay sender intet klassement, saa rettelsen er ikke aktiv dér.

Afviste alternativer: en staerkere GC-brems eller at fjerne det ekstra forspring for farlige udbrud helt ramte maalet i Giroen, men fik udbruddet til naesten aldrig at holde paa bjerg i Alpi-loebet. Systemet er knivsæg-praeget: enten holder udbruddet med stor margin, eller ogsaa hentes det.

## 4. Aabent: tynde felter (ejer-beslutning)

I Vuelta a Sierra Nevada vinder udbruddet aldrig og ender aldrig foran favoritterne under `orders_gc_v1`. Det gaelder baade foer og efter rettelsen. Feltet har kun ganske faa jaegere og frie roller og naesten ingen udbrudsordrer. Efter de ejer-godkendte regler maa kaptajner og hjaelpere ikke forsoege uden ordre. Derfor er morgenudbruddet 0-3 ryttere, og det hentes altid. Under legacy fyldtes udbruddet op med ryttere uden ordre, hvilket rolle-reglerne netop forbyder.

Valget er ejerens, fordi det aendrer en ejer-godkendt regel (docs/RACE_ENGINE_RULES.md "Morgenudbrud under orders_gc_v1"):

- A: Hjaelpere paa hold uden udbrudsordre maa selv forsoege udbruddet, naar feltet har for faa udbrydere (spontant, som en fri rolle).
- B: Behold reglen. Et felt uden udbrydere giver intet udbrud, og managerne skal selv saette ordrer.

Anbefaling: A, kun for hjaelpere (aldrig kaptajner) og kun naar feltet har faerre villige udbrydere end et normalt morgenudbrud.

## 5. Hvad maalingen ikke daekker

- Ordrerne er dem der laa i prod 2/10. Managerne kan aendre dem foer hver etape.
- Hel-tour-maalingen bruger motorens egne etaperesultater til klassementet, ikke prods.
- `#6084` (ny regel-revision for bjergetaper) bygger videre paa denne adfaerd. Den revision maales separat.
