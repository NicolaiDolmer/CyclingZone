# #6075: Klatreselektionen henter udbruddet for tidligt på bjergetaper

Dato: 2. oktober 2026. Kun undersøgelse, ingen motorændring. Refs #6075, #5957, #5978.

Rapporten er kvalitativ, fordi repoet er offentligt. Tal, fordelinger og harness-output ligger privat i `balance-internals/6075/` (gitignoreret): `analyze6075.mjs`, `summarize6075.mjs`, `blocks6075.mjs` og JSON-filerne `x-*.json` (proxy) og `r-*.json` (replay).

## Kort svar

Udbruddet bliver ikke hentet af en målrettet jagt. Det bliver hentet fordi feltet går i stykker på dagens første rigtige stigning, længe før finalen. Bagefter ligger favoritterne i en lille elitegruppe, og den kører i den bedste klatrers tempo på hver stigning. Det tempo lukker hullet til et udbrud af overvejende ikke-klatrere. Den samme tidlige knækning giver den store top-10-spredning fra #5957.

Problemet er altså to ting, og de kan rettes hver for sig:

1. **Timingen af fangsten**: elitegruppens tempo på stigningerne før finalen.
2. **Spredningen**: en "alt eller intet"-selektion på den første rigtige stigning.

## Sådan er det målt

Kun lokale, diagnostiske kørsler. Intet er skrevet til prod.

- **Proxy**: den låste population og de låste proxy-etaper, alle bjerg- og højfjeldsetaper, fem seeds, fulde hold med AI-ordrer ad prod-vejen. Samme opsætning som kalibreringen 1/10 (`calibrate.mjs`).
- **Replay**: alle S4-bjerg- og højfjeldsetaper i replay-cachen fra #5957 (`replay5957.mjs`'s `buildCases`), med prod-felter og prod-ordrer, kørt gennem v4 som legacy.
- **Instrumentering**: segmentløkken kørt med de rigtige hooks, pakket ind så hvert segment logger hullet mellem udbruddet og favoritgruppen. Hullet logges efter tempo-driften, efter klatreselektionen og efter jagtmodellen (M5). Det logger også favoritgruppens størrelse og reserve og årsagen til hver split. "Favoritgruppen" er den gruppe, der rummer flest af feltets bedste klatrere.
- **Eksperimenter**: små indgreb i selve harnessen, ikke i motoren. Fx slukket W'-tvang eller en højere split-tærskel på stigninger før finalen, eller tempo-driften mellem favoritter og udbrud sat i bero på de tidlige stigninger. De viser retningen af hvert løsningsforslag. De er ikke en færdig kalibrering.

## Hvad sker der på en typisk bjergetape

1. **Udbruddet** dannes tidligt. Det har en realistisk størrelse og består overvejende af ryttere, der klatrer klart dårligere end feltets bedste. Typisk er der kun én eller to ægte klatrere med.
2. **Feltet kører ind til første stigning med en stor del af reserven allerede brugt**. Reserven tæres allerede på det rullende terræn i etapens første del.
3. **Første rigtige stigning** ligger typisk før etapens midte. Her knækker feltet: langt størstedelen af favoritgruppen falder fra i ét skridt. Ved slutningen af stigningen har et klart flertal af feltet tom reserve. De bliver tvunget af, og resten bliver sorteret fra af selektionsscoren. Udbruddet splittes på samme stigning.
4. **Næste stigning** tager favoritgruppen ned til en håndfuld ryttere. Før finalestigningen er der typisk kun nogle få favoritter tilbage sammen.
5. **Fangsten**: elitegruppen henter udbruddet på stigningerne før finalen. Jagtmodellen bidrager kun lidt her. Det er gruppens eget klatretempo, der lukker hullet. I en lille gruppe sætter den stærkeste rytter tempoet alene. På bjergetaper bliver udbruddet typisk hentet et godt stykke før finalen, og som regel før finalestigningen. Det gælder både proxy og replay af de rigtige S4-etaper.
6. **Spredningen**: rytterne der faldt fra på første stigning, kommer aldrig tilbage. Top-10 i mål er derfor spredt over flere minutter, og flere af feltets bedste klatrere taber minutter. Det er det billede, #5957 og spillerne har beskrevet.

Under `orders_gc_v1` (#5955/#5978) hentes udbruddet senere, fordi lad-gå-fasen giver det mere plads. Men knækningen på første stigning er den samme, og spredningen er mindst lige så stor. Balancen fra #5955 kompenserer for timingen, men retter ikke årsagen.

## Hvad driver det

Ordnet efter vægt. Hvert punkt er belagt med målingerne og eksperimenterne ovenfor.

1. **Gruppetempoet på stigninger sættes af de stærkeste i gruppen** (front-andelen i `computeGroupTempo`). Kravet til alle andre er en fast andel af netop det tempo. For en stor gruppe betyder det, at alle under elite-niveau ligger over deres egen tærskel op ad hver stigning. For en lille elitegruppe betyder det, at den bedste klatrer alene sætter tempoet. Det er denne mekanik, der lukker hullet til udbruddet på de tidlige stigninger.
2. **W'-tvangen** (`wprimeDepletionForcesSplit`) slår til på næsten enhver stigning. Sammen med den alvors-skalerede selektionsscore (underskud målt mod gruppens bedste klatrer plus energi-underskud) gør det første stigning til en klippe. Hver af de to alene flytter næsten intet: en højere tærskel alene eller en slukket tvang alene giver stort set samme knækning. Først når begge lempes på stigningerne før finalen, bliver feltet samlet.
3. **Feltet ankommer udtæret** til første stigning (trin 2 i forløbet). Det gør punkt 1 og 2 værre.
4. **Udbruddets klatreevne**: dagens udbrud er overvejende ikke-klatrere, så det har intet at sætte imod elitegruppens tempo. Det er realistisk og ikke en fejl i sig selv.
5. **Jagtmodellen (M5)** er en lille faktor på stigningerne. Bemærk dog: når feltet er knækket, er M5's jagtgruppe ofte et udbrudsfragment eller en lille gruppe og ikke favoritgruppen. Desuden stopper lad-gå-fasen, når jagtgruppen bliver lille. Efter første stigning styres hullet altså mest af tempo-driften og ikke af holdenes ordrer. Det forklarer også, hvorfor GC-reaktionen i #5978 næsten ingen effekt havde på bjergetaper.

## Løsningsforslag

Alle tre forslag ændrer den fælles motor. De skal derfor ligge bag en regel-revision (som `orders_gc_v1`), så legacy-løb og golden fixtures forbliver byte-identiske, indtil ejeren tænder. Retningen er målt i proxy og replay. Størrelserne skal kalibreres i en egen PR.

### A. Kontrolleret tempo på stigningerne før finalen (timingen)

*Hvad*: på stigninger før finalestigningen kører favoritgruppen ikke i elitetempo mod udbruddet. Hullet til udbruddet ændres dér kun gennem jagten (M5), ligesom det allerede gør på fladt og rullende terræn (`neutralizeBreakawayTempoDrift`). På finalestigningen er tempoet uændret.

*Forventet effekt (målt)*: udbruddet hentes markant senere, typisk først i finalen og ikke på mellemstigningerne. Udbruddet overlever kun lidt oftere. Top-10-spredningen ændres ikke, fordi knækningen af feltet er den samme.

*Risiko*: lav til mellem. Ændringen er snæver og bygger på en mekanik, der allerede findes. Den skal afgrænses til dagens udbrud og "før finalestigningen", ellers rammer den kuperede etaper med flere stigninger. Alene retter den ikke #5957's spredning.

### B. Blødere selektion før finalen (spredningen)

*Hvad*: på stigninger før finalestigningen gælder to ting. W'-tvangen slår kun til på alvorlige stigninger eller kun i finalen, og split-tærsklen er højere. Så falder kun de klart svageste fra tidligt. Den hårde selektion samles på de sidste stigninger.

*Forventet effekt (målt)*: feltet overlever første stigning stort set samlet, og en reel favoritgruppe når samlet frem til finalestigningen. Top-10-spredningen falder tydeligt, både i proxy og replay. Udbruddet hentes også senere, fordi elitegruppen opstår senere.

*Risiko*: mellem. Udbruddet overlever oftere på bjergetaper. Det er sandsynligvis for ofte uden en kalibrering af jagten i finalen. Klassementet kan blive mindre afgørende, hvis selektionen i finalen ikke strammes tilsvarende. Ændringen rører den selektion, alle stigninger deler, så kuperede etaper skal måles med. Begge håndtag skal ændres sammen. Hver for sig virker de ikke.

### C. Jagten følger favoritgruppen (struktur, ikke målt)

*Hvad*: M5 måler jagten mod den gruppe, der rummer klassementets favoritter (eller feltets hovedgruppe), og ikke mod den nærmeste gruppe bag udbruddet. Lad-gå- og jagtfasen må ikke falde bort, bare fordi den gruppe er blevet mindre.

*Forventet effekt*: holdenes ordrer og GC-reaktionen (#5978) virker igen efter første stigning. Fangstens timing bliver et taktisk valg og ikke en bivirkning af tempoet. Det er en forudsætning for, at "jag" eller "lad gå" betyder noget på bjergetaper.

*Risiko*: høj. Det er en strukturel ændring i M5 og kræver nye kontrakttests. Effekten er ikke målt her, fordi den ikke kan simuleres uden at ændre motoren.

### Anbefaling

**B + A sammen bag én ny regel-revision.** B retter årsagen til både den tidlige fangst og spredningen fra #5957. A sikrer, at udbruddet hentes i finalen og ikke på mellemstigningerne. Kombinationen er målt i begge harnesses: feltet holder sammen til finalen, udbruddet hentes sent, og top-10-spredningen falder tydeligt. Den kendte pris er, at udbruddet overlever oftere. Det skal kalibreres mod en målsætning for udbrudssejre på bjergetaper, før noget tændes. C bør komme som næste skridt, når GC-reaktionen skal virke på bjergetaper.

## Hvad målingen ikke dækker

- Træthed fra etape til etape og klassementstider. Proxy-kørslerne er enkeltetaper med første-etape-kontekst.
- Kuperede og rullende etaper. Forslag A og B kan påvirke dem og skal måles dér før en beslutning.
- Eksperimenterne er indgreb i harnessen, ikke en implementering. En rigtig implementering kan give andre størrelser, især for forslag B's tærskel.
- Replay-felterne bruger rytternes nuværende evner og ikke evnerne på løbsdagen (samme forbehold som #5957).
- Løbsfilm og tidslinje-tekster. De følger motoren og er ikke vurderet her.
