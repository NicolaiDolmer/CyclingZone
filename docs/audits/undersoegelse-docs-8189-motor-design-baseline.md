# Undersøgelse #8189: teknisk design og målt baseline for motorpakken (#8189, #4596, #7645, #7644)

> Undersøgelsesspor (kind: investigate, #5220), 26/11. Ingen kodeændring. AGENTS 36: design og målt baseline før første motor-PR.
> Hard rule 17: målte andele, medianer og sekunder står **ikke** her. De ligger i workerens scratch-mappe (`.wave-scratch/docs-8189-motor-design-baseline/base.json`, `capon.json`, `*-analysis.txt`) og skal flyttes til `balance-internals/8189/2026-11-26/` af hovedsessionen. Her står kun retning og størrelsesorden i ord.

## 1. Sådan er der målt

- **Motor:** v4 under `s5_profiles_v3` (den aktuelle revision), offline, ingen database, intet netværk.
- **Ruter:** S5-generatoren via `backend/scripts/dev/s5MotorBench.mjs` (`buildS5BenchRaces`, scope `all`), tre sæsontræk. Kun løb med mindst én bølget, kuperet, mellembjerg-, bjerg- eller højfjeldsetape. Hele løbet køres i rækkefølge med akkumuleret træthed (benchens `benchStageFatigues` og `runStagesInOrder`).
- **Felt:** det anonymiserede Giro-felt, alle hold som AI-hold.
- **Seeds:** to motor-seeds pr. rute i baseline. En tredje kørsel med kontakten `descent_regroup_cap_7644` tændt (sat på motor-input, som broen gør ved `app_config = "on"`), én seed.
- **Omfang:** flere end 280 forskellige kuperede etaper og 15 mellembjergetaper (over 600 etapekørsler på de to profiler), plus over 140 bølgede og over 400 bjerg- og højfjeldsetaper.
- **Pr. etape:** afslutning, vinderens ryttertype (benchens z-score mod feltet), om udbruddet vandt, sprintere i top 10, tid til nr. 10, nr. 30 og sidste rytter, tidsgrupper (samme tid inden for 1 s), forgruppens størrelse, ryttere over 5 min efter (grupetto), afstand fra sidste kategoriserede top og sidste kat. 1-2/HC-top til mål, og på nedkørslen: hvor meget de jagende grupper vandt på vinderen fra sidste top til mål (s og s pr. km), samt hvor mange ryttere der lå mindst 3 min efter på toppen og sluttede inden for 30 s.
- **Virkelig cykelsport:** benchmarken `backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json` (Grand Tour-etaper 2021-2025, offentlige data), tid til nr. 10 pr. terræn og afslutning.
- **Scripts** (kun scratch, ikke committet): `measure.mjs` og `analyze.mjs` i scratch-mappen. De importerer benchens egne funktioner read-only.

**Hvad målingen ikke dækker:** kun AI-hold (menneskeholdenes ordrer og udbrudsvilje er ikke med), ét felt, ryttertype ud fra benchens egen z-score, og prod-kontakter ud over revisionen (fx dagsform) er ikke sat. Mellembjerg har et lille udvalg; det er markeret, hvor det betyder noget.

## 2. Baseline pr. issue

### #8189: sprintere vinder for mange kuperede etaper. **Bekræftet.**

- På **kuperet** vinder sprintere den største enkeltandel af etaperne, tæt på halvdelen. Punchere vinder kun en lille del.
- Det kommer næsten udelukkende fra etaper med **flad spurt**, som er den hyppigste afslutning på kuperet. Her vinder sprintere næsten alle, forgruppen er næsten hele feltet, og udbruddet vinder næsten aldrig.
- **Virkeligheden:** i benchmarken har godt en tredjedel af de kuperede flade spurter et tidshul på mindst 30 s til nr. 10 (et udbrud eller et splittet felt spurtede om sejren). I motoren sker det på under hver tyvende. Motoren laver altså ikke de reducerede spurter og udbrudssejre, som virkelighedens kuperede spurtetaper har.
- Bakke-, mur- og nedkørselsafslutninger på kuperet ser rimelige ud: punchere og klatrere vinder, og der er tidshuller.
- **Årsag (ægte, ikke tilfældig):** generatoren vælger flad spurt på en stor del af de kuperede etaper (`backend/lib/raceStageProfileGenerator.js`, `S5_FINISH_WEIGHTS`), og motoren kører flad spurt som en fuld massespurt uanset dagens hårdhed (`backend/lib/engine/v4/tuning.ts` placerings-demand ca. l. 149, jagt l. 904/1035, jagt-gulv l. 992/1053, sent angreb udelukket l. 1125). Det stemmer med designoplægget i PR #8191 (`docs/superpowers/specs/2026-11-15-8189-sprintere-kuperet-design.md`). Den nye måling tilføjer, at selektionen (#7645) er den tredje årsag: feltet samles igen efter stigningerne, så der er ingen reduceret spurt at vinde (se #7645).

### #4596: "rolling" grupperet forskelligt ni steder. **Bekræftet i adfærd.**

- På **bølget** vinder sprintere næsten alle etaper, afslutningen er næsten altid flad spurt, og udbruddet vinder aldrig i målingen. Hele feltet kommer i mål i samme gruppe på langt de fleste etaper.
- Motoren behandler altså bølget præcis som flad. Det følger af de seks flad-placeringer i #4596 (bl.a. `raceTerrain.js` kaptajn-bucket, generatorens `FLAT_FAMILY`) og af at S5's bølget-ruter kun har kat. 4 langt fra mål.
- **Virkeligheden:** benchmarkens bølgede etaper ender også i samlet spurt. Men RULES-målet om, at udbruddet af og til vinder på bølget, rammes ikke (aldrig i målingen).
- **Konflikt i ejerbeslutningerne, skal afklares før byg:** ejer 15/11 (#8189): bølget = sprinterdag med småbakker, men udbrud skal kunne vinde af og til. Ejer 25/11 (#4596): bølget er sin egen kategori alle ni steder og skal ikke favorisere nogen ryttertype. Målingen viser, at bølget i dag favoriserer én type meget stærkt. Det kan ikke både være en sprinterdag og ikke favorisere sprintere. Ét billede-spørgsmål til ejeren.

### #7645: for lidt selektion på kuperet og mellembjerg. **Bekræftet.**

- **Afstanden fra sidste svære stigning (kat. 1-2/HC) til mål afgør næsten alt**, præcis som designet 7/11 fandt i prod:
  - Top under 15 km fra mål: selektivt som en bjergetape, mange små grupper, ofte udbrudssejr.
  - Top 15-30 km fra mål: delvis selektion.
  - Top 30-50 km fra mål: forgruppen er stort set hele feltet, tid til nr. 10 er nul, og sprintere vinder de fleste. En kat. 2 sætter i praksis ingen af.
- **Grupetto findes næsten ikke på kuperet:** kun på få etaper er mindst fem ryttere over 5 min efter.
- **Indhentningen kan måles direkte:** på kuperede etaper med sidste kategoriserede top over 30 km fra mål slutter over halvdelen af de ryttere, der lå mindst 3 min efter på toppen, inden for 30 s af vinderen. Det er ikke `descentRegroup6486` (den gælder kun bjerg og højfjeld), men dal-reglen i den fælles tidsmodel: `backend/lib/engine/v4/mechanics/timeModel.ts` (`valleyReachSeconds` ca. l. 88: hullet kan ikke vokse for grupper inden for rækkevidde; `valleyClosingSecondsPerKm` og `valleyClosingGapFractionPerKm` ca. l. 225-226: gruppen bagved lukker pr. km og en andel af hullet pr. km, skaleret med antallet bagved mod foran; `midDescentSecondsPerKm`/`midDescentGapFractionPerKm` ca. l. 85-86). Andelen af hullet pr. km gør, at en lang dal næsten altid lukker hullet helt.
- **Mellembjerg** (lille udvalg): alt eller intet. Bjergtop og nedkørsel tæt på mål er meget selektive; flad spurt har et reduceret felt foran og mange ryttere langt efter. Det er tættere på virkeligheden end kuperet, men mellemtingen (reduceret felt + en grupetto der taber minutter) er sjælden.
- **Virkeligheden:** en kat. 2 sent på en kuperet etape sætter sprintere og mange hjælpere af; om de kommer tilbage, afhænger af, om deres hold jager. Kun kat. 3-4 langt fra mål giver normalt samlet spurt.

### #7644: lange nedkørsler samler for meget. **Bekræftet, og kontakten rammer ikke hovedkilden.**

- På **bjerg og højfjeld uden topmål** med sidste top 15-30 km fra mål vinder den bedste jagende gruppe på langt de fleste etaper mere end 2 min på vinderen fra toppen til mål. Gevinsten pr. km ligger over de lofter, `DESCENT_REGROUP_6486_TUNING` selv sætter pr. terræn (`mechanics/descentRegroup6486.ts` ca. l. 79-89). Det er kæde- og sneboldeffekten, #7644 beskriver.
- **Med kontakten `descent_regroup_cap_7644` tændt ændrer det sig næsten ikke** (median-gevinsten og andelen af etaper med over 2 min gevinst flytter sig kun lidt). Loftet sidder kun på #6486-modulets egen lukning. Hovedparten af indhentningen kommer altså fra andre led, der også virker efter sidste top: dalens lukning og "hullet kan ikke vokse" i `timeModel.ts` (se #7645), og nedkørselsbogen (`bookFinishDescentClosure`, `finishDescentMaxSecondsPerKm`). Det forklarer også, hvorfor G19 ikke kunne forenes med loftet 8/11: loftet rammer det forkerte led.
- **Virkeligheden:** en samarbejdende gruppe vinder sekunder pr. km på en nedkørsel og lidt mere i en dal, ikke minutter på 20-30 km, og en gruppe 3-5 min efter samles ikke med fronten. Benchmarkens bjerg-nedkørselsetaper har tid til nr. 10 på omkring et minut; der er ingen benchmark for indhentning pr. km, så det tal er et skøn.

## 3. Fælles rodårsag

Tre af de fire issues har samme kerne: **efter sidste stigning har motoren regler, der kun kan samle grupper (lukning pr. km + andel af hullet pr. km + "kan ikke vokse"), men ingen årsag til, at en gruppe holdes ude.** Det giver samlet felt på kuperet (#7645), sprintersejre på kuperede spurtetaper (#8189) og for stor indhentning på bjergnedkørsler (#7644). Bølget (#4596) er den rene ende af samme kæde: ingen stigning, der sætter nogen af, og en finale-type der er en massespurt.

Det er derfor designforslaget nedenfor starter med at erstatte den "gratis" regruppering med en jagt, der har en årsag (#7645 mulighed 2), før generator- og finaleknapperne røres.

## 4. Konkrete ændringer pr. issue (fix-plan)

Alle motorændringer bag én ny regel-revision (fx `s5_profiles_v4`), slukket. Ældre revisioner bit-identiske, bevist mod en frossen kopi af merge-base (#7587). Kontakten får stempel ved løbsstart (som #7726), så et igangværende etapeløb ikke skifter regler (Fable-dom 14/11 på #7644). Bjerg og højfjeld med topmål skal være bit-identiske.

**Trin 0 (måling, ingen adfærd): bogføring pr. mekanisme.** Tilføj en ren, additiv debug-tæller i motoren (kun i bench/testport), der pr. gruppe og segment efter sidste top fordeler indhentede sekunder på `valleyRegroupTempoV3`, `midDescent*`, `descentRegroup6486` og nedkørselsbogen. Uden den kan #7644 ikke tunes på det rigtige led. Filer: `mechanics/timeModel.ts`, `mechanics/descentRegroup6486.ts`, `segmentLoop.ts` (kun output). Risiko: lav (additivt felt, ikke i prod-output).

**Trin 1: #7645 rettelse A + jagt med årsag (mulighed 2).**
- `mechanics/timeModel.ts`: dalens lukning og "kan ikke vokse" kun for grupper inden for rækkevidde af **forgruppen**, ikke af gruppen lige foran (stopper kæden). Fjern eller skær andelen af hullet pr. km kraftigt; behold en fast lukning pr. km for en samarbejdende gruppe.
- Gruppen bagved kommer kun mere tilbage, hvis et hold jager: genbrug etapeinteressen fra udbrudsjagten (`stageWinFinaleWeight`/`finaleTypeChaseWeight`, `tuning.ts` l. 904/1035) for hold med en vinderkandidat i gruppen bagved; hold med kandidater foran kan køre for at holde dem ude. Jagten koster hjælpernes kræfter (eksisterende effort-model), så "spar kræfter" og grupetto-ordrer får betydning.
- Forventet effekt: på kuperet med kat. 2 30-50 km fra mål et reduceret felt foran og en grupetto på en del af etaperne; sprintere med stærkt hold kommer oftere tilbage end sprintere uden. Kat. 3-4 langt fra mål stadig mest samlet spurt.
- Risiko: mellem til høj (jagt, træthed og finale på én gang). Genmål efter A, før jagten.

**Trin 2: #7644 på det rigtige led.** Når trin 0 viser fordelingen: læg loftet pr. km på den samlede indhentning efter sidste top (alle led), ikke kun på #6486-modulet, og skalér med nedkørslens længde og teknik. Forén med G19 ved at genbesøge G19's bånd for lange nedkørsler mod benchmarken (ejervalg, jf. 8/11). Fil: `mechanics/descentRegroup6486.ts`, `mechanics/timeModel.ts`. Risiko: mellem (klassementet flytter sig på bjergetaper uden topmål).

**Trin 3: #8189 i generator og finale.** Efter trin 1 er målt:
- A (generator, lav risiko): `S5_FINISH_WEIGHTS.hilly` talt op igen uden etaper med kun kat. 4, flad spurt-vægt flyttet til bakke, mur og nedkørsel (ikke stigende spurt). Virker fra næste kalender.
- B (motor): flad spurt efter mindst N kategoriserede stigninger (`priorCategorizedClimbs`) får durability-hybriden (`s5Profiles.ts` `s5FinaleDemandVector`, `tuning.ts` l. 1080-1099) og må have det sene angreb (`tuning.ts` l. 1125). Med trin 1 er der nu et reduceret felt at spurte i.
- Forventet effekt: færre rene sprintere, flere punchere, sprintere med udholdenhed og udbrud på kuperet.

**Trin 4: #4596 efter ejerens svar på konflikten (afsnit 2).** Er bølget en sprinterdag: behold flad-placeringerne, dokumentér dem i `CALENDAR_RULES.md` §5a som bevidste, og giv udbruddet en chance via lad-gå-loftet på bølget (`tuning.ts` l. 935) og AI-holdenes udbrudsvilje. Er bølget sin egen kategori uden favorit: egen finale-demand (mere durability, jf. ejer 1/9), egen bucket i `raceTerrain.js`, og flyt de ni steder samlet i én PR med måling. Ingen ændring før svaret.

## 5. Testplan

- **Golden-diff:** `backend/scripts/dev/calendarGoldenDiff.mjs` (generator-ændringen i trin 3A) skal vise, at kun kuperet-afslutningerne flytter sig, og at kalender-gaterne (`s5BenchmarkGate.js`, K-B-komposition, §7b-finalebånd) er grønne.
- **Realisme-gaten:** realismekorpusset (`backend/scripts/dev/buildRealismCorpus.mjs`, #7588) og `raceRouteRealismScorecard.js` uændret grønne efter hvert trin; udbrudsmålene (#6912) må ikke flytte sig den forkerte vej.
- **Bit-identitet:** ældre revisioner og topmål-etaper mod frossen merge-base (#7587); `descent_regroup_cap_7644` slukket = bit-identisk.
- **Motor-testporten** (`motorTestport.mjs`, ≥5 seeds, prod-startlister, alle løbsgrupper: U23, junior, senior, GT, endagsløb): G2, G2F, G19, gcFromBreakaway.
- **Genmåling med denne undersøgelses scripts** (flyttes til `backend/scripts/dev/` hvis trin 0 bygges): vindertype pr. profil × afslutning, forgruppens andel, grupetto-andel, indhentning pr. km efter sidste top, før/efter pr. trin. Private tærskler i `balance-internals/`.
- **Prod-genafspilning** af gemte S5-etaper (kun læsning), som 8/11 for #7644, før ejerens "tænd".

## 6. Risici

- Trin 1 rører jagt, træthed og finale samtidig; #4596 advarer mod at flytte flere variable på én gang. Derfor A før jagten og genmåling imellem.
- Mere selektion på kuperet kan flytte klassementet på etapeløb med mange kuperede etaper og gøre tidsgrænsen relevant (grupetto-reglen §2d skal holde).
- Et loft på al indhentning (trin 2) kan gøre G19 rødere, som 8/11; det kræver ejervalget om G19's bånd.
- Benchen har kun AI-hold; menneskeholdenes ordrer kan både forstærke og dæmpe effekten. Testporten med prod-startlister er derfor obligatorisk før tænding.
- Motor, træning og penge: Fable-dom før merge og ejer-go før tænding (hukommelsesregler).

## 7. Dom

Alle fire fænomener er reproduceret offline på den aktuelle motor med en ægte, navngivet årsag i koden: flad spurt kørt som massespurt og generatorens afslutningsvægte (#8189), bølget behandlet som flad overalt (#4596), dalens regruppering uden jagt-årsag (#7645), og indhentning efter sidste top der primært kommer uden om #7644-loftet. Fix-planen står i afsnit 4.

**bekraeftet + fix-plan**
