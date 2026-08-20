# 2026-08-20 — Etapetype-badge forsvandt bag en fold-sektion (#3985, regression af #3914)

## TL;DR
#3914 (v7.147) flyttede etape-fanens fulde profilgraf ned i en default-lukket
CollapsibleSection ("Etapeprofil") for at give resultatet pladsen øverst. For
etaper MED rutedata viste den flyttede komponent (StageProfileCard) i
forvejen ALDRIG en terræn-tekst — kun distance/højdemeter/graf. Terræn-typen
(flad/bakket/bjerg/brosten/enkeltstart) havde derfor ingen synlig plads
tilbage på etape-fanen for færdigkørte etaper, medmindre man foldede sektionen
ud. Spiller-rapport 19/8. Fix: en lille badge i fanens metadata-linje, foran
klassement-sub-fanerne, synlig uden at folde noget ud.

## Rod-årsag
To komponenter dækker "vis terræn-type", og #3914 flyttede kun én af dem:
- `LegacyStageProfileCard` (etaper UDEN rutedata) viser terræn-TEKST
  (`t(\`detail.${labelKey}\`)`).
- `StageProfileCard` (etaper MED rutedata, Sub-4) viser KUN stats + graf —
  ingen profile_type-tekst nogen steder i komponenten.

Før #3914 lå `<StageProfileSlot>` (som vælger mellem de to) altid-åben øverst
på etape-fanen. Legacy-etaper viste dermed terræn-teksten synligt; Sub-4-
etaper viste den aldrig, men spilleren så i det mindste GRAFENS form (en
implicit terræn-antydning). Da #3914 flyttede samme slot ned i en default-
lukket sektion, mistede BEGGE veje deres eneste synlige sted — Sub-4-etaper
havde reelt ALDRIG haft en tekst-terræn-label nogen steder, kun grafens form,
og den forsvandt nu bag et klik.

## Hvorfor det blev overset i #3914
PR'ens egen e2e-verifikation (`race-detail.spec.js`) udfoldede eksplicit
"Etapeprofil" via `<summary>`-klik FØR den asserterede på terræn-badges — så
testen beviste at terrænet stadig fandtes NÅR MAN FOLDER UD, ikke at det var
synligt UDEN. En regressionstest der selv udfører den handling der netop blev
gjort besværlig, kan ikke fange denne klasse fejl.

## Fix
Ny lille lokal komponent `StageTerrainTag` i `RaceDetailPage.jsx` — genbruger
`profileShape`/`profileLabelKey` fra `stageProfileConfig.js` (samme SSOT som
`LegacyStageProfileCard`/`StageStripe`/calendar-glyphen) og eksisterende
`detail.profileType.<key>`-i18n-nøgler. Rendered i StageTab's metadata-linje,
foran `<Tabs>`. Ingen nye i18n-nøgler, ingen layout-genåbning af #3914.

## Forward-guard
1. **Når en "flyt til collapsed" PR flytter en komponent, tjek om den
   komponent var den ENESTE kilde til et stykke information et andet sted i
   flowet er afhængigt af at se uden interaktion** — ikke kun om informationen
   stadig FINDES et sted i træet.
2. **En regressionstest der selv udfører den handling som gør noget
   utilgængeligt (fold ud, klik "vis mere"), beviser kun at data findes — ikke
   at det er synligt i default-state.** Tilføj en eksplicit "synlig UDEN
   interaktion"-assertion for information brugeren tidligere så uden klik.
3. **StageProfileCard (Sub-4/rutedata-vejen) har fortsat ingen terræn-TEKST**
   — kun grafens form. Det er ikke rettet her (ude af #3985's scope), men er
   en kandidat til samme mønster (`StageTerrainTag`) hvis det bliver rapporteret.
