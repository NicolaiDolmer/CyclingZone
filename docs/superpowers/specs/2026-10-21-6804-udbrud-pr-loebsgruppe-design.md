# #6804 trin 2: udbrud, tidsgab og kuperet enkeltstart pr. løbsgruppe (design)

Status: design besluttet af ejeren 21/10 (alle fem beslutninger A, se §6); intet bygget. Refs #6804 #6857 #6909 #6912 #6464 #6369 #5978 #6441.
Bygger videre på `2026-10-17-6804-hilly-breakaway-design.md` (P1-P5, ejer-go 20/10), som stadig gælder.
SSOT for reglerne: `docs/RACE_ENGINE_RULES.md` (Udbrudsmål, GC-reaktion, "Farlige klassementsryttere får
kortere snor", "Bjergets tidsgab ens i alle divisioner"). Bygge-PR'erne opdaterer reglerne dér.
Hard rule 17: ingen vægte, tærskler, bånd eller målte andele her. Baseline, kalibrering og de
foreslåede bånd ligger privat i `balance-internals/6804/2026-10-21/baseline-6804-loebsgrupper.md`.
Hard rule 36: baseline målt 21/10 offline på testportens S5-cache (nye ruter, 437 løb, 8 seeds).
Motoren er ikke rørt; denne PR er ren docs.

## 1. Problem (ejer 21/10)

Ejeren bestilte tre ting: udbrudssejre vurderet pr. løbsgruppe (Grand Tours, andre etapeløb,
endagsløb) og pr. terræn, mål for tidsgab i korte etapeløb (der i dag kun har Grand Tour-mål), og
en vurdering af den kuperede enkeltstart i etapeløb. Observationer, målinger og kalibreringsgrundlag
står privat i `balance-internals/6804/2026-10-21/baseline-6804-loebsgrupper.md` (hard rule 17).

## 2. Rod-årsager (mekanik; målingerne der understøtter dem er private)

**R1 Dannelsen afhænger af ordrer.** Kaptajn, sprint-kaptajn og hjælper forsøger kun morgenudbruddet
med en ordre (ejer 10/10, valg B; "Morgenudbrud under `orders_gc_v1`"). Et testfelt uden
holdordrer og jæger-roller for menneskeholdene danner derfor kun udbrud fra AI-holdene, og det
undervurderer felter med mange menneskehold. I prod sætter menneskeholdene selv jæger-roller og
"Forsøg udbrud".

**R2 Klassementsjagten i etapeløb starter tidligt og henter i stedet for at kontrollere.** Under S5
(`assessGcThreat`):
- efter en flad etape står alle på samme tid, så en udbryder med lidt klassementsevne regnes som
  inden for rækkevidde;
- vurderingen lægger udbruddets fremskrevne gevinst på de resterende åbne km oveni, så margenen er
  opbrugt længe før forspringet er stort;
- "noget at forsvare" følger tidshullet, så næsten alle hold forsvarer i et kort etapeløb;
- svaret på en alvorlig trussel er jagt til hentning, ikke kontrol på en snor, hvilket giver et
  yo-yo-mønster: hentet, nyt udbrud (#6369), hentet igen.
Endagsløb har ikke denne jagt; flere udbrydere hjælper der, men ikke i etapeløb.

**R3 Målene er Grand Tour-mål.** Udbrudsmål §2 (pr. terræn) er forankret i Grand Tour-data og
anvendes på alle løb, og tidsgab har kun Grand Tour-bånd (`TOUR_BENCHMARKS`, `headToHeadAnchors`).
I virkeligheden vindes ugeløb sjældnere fra udbruddet end Grand Tours (tæt klassement, daglig kontrol).

**R4 Kuperet enkeltstart måles i absolutte evne-point.** Hullet følger feltets evne-spredning, så
samme rute spreder mere i felter med større spredning (de lavere divisioner). Bjergetaperne fik en
felt-skalering i #6464; den kuperede enkeltstart fik den ikke. "Bakket" og "stejl/opad" enkeltstart
ligger desuden i samme klasse med ét loft, selv om de spreder forskelligt i virkeligheden.

## 3. Mål pr. løbsgruppe (forslag til ejeren, tal privat)

Tre løbsgrupper: Grand Tours, korte etapeløb (2-4 og 5-8 etaper) og endagsløb.

- **M1 Udbrudssejre pr. løbsgruppe × terræn.** Grand Tours beholder terrænbåndene i Udbrudsmål §2
  uændret. Korte etapeløb får lavere bånd end Grand Tours på flad, rullende, kuperet og bjerg; endagsløb
  får et bånd på kuperet, der ligger mellem de to. Ejerens gruppe-bånd fra 19/10 (GT > korte > endags,
  låst) gælder oveni og gælder **gruppens samlede andel af vejetaper**, ikke hvert terræn: endagsløb
  har få kuperede dage i forhold til flad, brosten og klassiker, så et højere kuperet bånd end i korte
  etapeløb er foreneligt med en lavere samlet andel. Gaten tester begge dele (G1': pr. terræn og samlet
  pr. gruppe). Bånd: privat.
- **M2 Tidsgab i korte etapeløb.** Egne bånd for nr. 10 i slutklassementet og vindermarginen i
  2-4 og 5-8 etaper, forankret i slutklassementer 2023-2025. Ens i alle divisioner (samme princip som
  #6464). Scorecardet dømmer korte løb mod dem i stedet for Grand Tour-båndet.
- **M3 Kuperet enkeltstart i to klasser.** "Bakket" (ingen topankomst, lav stigningstæthed) og
  "stejl/opad" (topankomst eller høj stigningstæthed), hver med sit bånd pr. 40 km, ens i alle
  divisioner.
- Uændret: K1-K8 og G1-G10 fra designet 17/10; bjerg/højfjeld-ankre; et hold jager aldrig sine egne
  (#6187); en top-10 får aldrig 5 minutter uden jagt (#5978); skala-invarians (#4707); determinisme.

Kilder (virkelig cykelsport):
- Frontier Economics, "Tour de France: Breaking down the breakaway" (114 Tour-vejetaper; ca. hver
  fjerde vundet fra udbruddet; flad næsten aldrig; mellem- og højbjerg over fire ud af ti):
  https://www.frontier-economics.com/uk/en/news-and-insights/articles/article-i6444-breaking-down-the-breakaway/
- Cyclingbeginner, seks Grand Tours 2020-2021 pr. etapetype (metode ikke beskrevet, tallene summerer
  ikke helt): https://cyclingbeginner.com/success-rate-of-cycling-breakaway-comprehensive-analysis/
- Scelles m.fl., udbrud lykkes oftere på kuperet og bjerg end flad (Touren 2013-2016):
  https://www.emerald.com/insight/content/doi/10.1108/TPM-03-2017-0012/full/html og
  https://www.stir.ac.uk/research/hub/publication/522272
- Ugeløb: egen optælling af etapeberetninger 2024 (fransk Wikipedia) for Paris-Nice, Dauphiné,
  Tour de Suisse, Itzulia, Volta a Catalunya og Tirreno-Adriatico. Ingen publiceret statistik fundet.
- Tidsgab og enkeltstart: slutklassementer og etaperesultater på Wikipedia (en), 2022-2025, fx
  https://en.wikipedia.org/wiki/2024_Paris%E2%80%93Nice, https://en.wikipedia.org/wiki/2024_Boucles_de_la_Mayenne,
  https://en.wikipedia.org/wiki/2023_Tour_de_France,_Stage_12_to_Stage_21. Den fulde liste står i den
  private baseline.
- ProCyclingStats afviser automatiseret hentning; tallene er ikke krydstjekket mod PCS.
- Korte etapeløb og endagsløb pr. terræn: **ingen kilde, antagelse** forankret i Grand Tour-kilderne
  og ugeløbs-optællingen.

## 4. Pakken (oven på P1-P5, byg-rækkefølge)

**P0 Testporten måler et prod-lignende felt (R1).** Det syntetiske felt giver menneskeholdene
udbrudsvilje som i prod (andel jægere og "forsøg udbrud" pr. division og løbsgruppe, læst
read-only fra den seneste afsluttede sæson). Ingen motorændring. Rapporten viser begge felter side
om side, så målet dømmes på prod-feltet og testfeltet stadig fanger "intet udbrud"-tilfældet.

**P6 Klassementskontrol på snor i stedet for tidlig hentning (R2).** Bag `s5_profiles_v2`:
1. En trussel tidligt på etapen giver kontrol: holdet holder forspringet på det det tolererer for
   truslen (snoren findes allerede, #5978), i stedet for at jage til hentning. Hentning er finalens
   opgave eller sker når snoren brydes.
2. Den fremskrevne gevinst regnes først fuldt med, når resten af etapen er kort nok til at den kan
   realiseres; tidligt på dagen tæller den mindre.
3. "Noget at forsvare" i korte etapeløb følger holdets realistiske klassementschance (evne og
   placering), ikke kun et lille tidshul; et hold uden reel chance kontrollerer ikke.
4. Udbrydere uden klassementsevne er aldrig en trussel, uanset tidshul (samme fare-mål som #5978).
Ingen ny tilfældighed: hver udbrudssejr kan forklares i filmen (P5: kontrol, træthed, terræn).

**P7 Tidsgab-mål i scorecardet (M2).** `tourScorecard.mjs` og testportens rapport får båndene for
2-4 og 5-8 etaper. Ingen motorændring. Halen (meget store hul i korte løb) måles pr. årsag; P2
(realistisk forspring) forventes at tage den.

**P8 Kuperet enkeltstart (M3, R4).** Bag `s5_profiles_v2`: den kuperede enkeltstarts tidshul måles i
feltets egen spredning (samme regel som #6464 for bjerg), og scorecardet deler klassen i bakket og
stejl/opad. Rækkefølgen på etapen er uændret; kun hullets størrelse følger feltet.

Rækkefølge: P0 og P7 først (måling, ingen motor), så P1 → mål → P6 → mål → P2 → P3/P4 → P5 → P8,
ét trin pr. commit så hver ændring kan isoleres.

## 5. Testport (hårde gates, under `s5_profiles_v2`, S5-ruter + S4-ruter)

- G1' (erstatter G1) Udbrudsandel pr. løbsgruppe × terræn inden for M1 og samlet pr. løbsgruppe
  inden for ejerens gruppe-bånd (19/10) på prod-feltet (P0); Grand
  Tours på kuperet og bølget skal ramme båndet, ikke kun være > 0.
- G11 (ny, R2) Andelen af etaper i korte etapeløb og Grand Tours hvor klassementsjagten henter
  udbruddet i første del af etapen, under et privat loft; ingen yo-yo (hentet, nyt, hentet igen) som
  normaltilfælde.
- G12 (ny, M2) Nr. 10 og vindermargin i 2-4 og 5-8 etaper inden for båndet, median og hale.
- G13 (ny, M3) Kuperet enkeltstart pr. klasse inden for båndet i hver division; samme rute spreder
  ikke markant mere i lavere divisioner.
- G14 (ny) Endagsløb overstiger ikke båndet på kuperet, når feltet får flere udbrydere (P0).
- G2-G10 uændret. v1 og ældre bit-identiske.

## 6. Ejer-beslutninger (besluttet 21/10, låst)

**Besluttet 21/10:** ejeren valgte A i alle fem (#6804). Pakken i §4 og gatene i §5 gælder som
skrevet og bygges i rækkefølgen fra §4, startende med P0. Afsnittet nedenfor står som beslutningsgrundlag.

Pakken i §4 og gatene i §5 er skrevet ud fra anbefalingerne, men er **ikke klar til byg**: hver del
er betinget af sin beslutning. Rækkefølgen er 1 → 2 → 3 → 4 → 5, og den næste stilles først, når den
forrige er besvaret, fordi svaret kan ændre den næste (fx måles 2-4 på det felt 1 vælger).
Afviser ejeren en anbefaling, skrives den berørte del af §4/§5 om, før noget bygges.
- Beslutning 1 åbner P0. Beslutning 2 åbner M1, G1' og G14 (G14 kræver både 1 og 2). Beslutning 3 åbner M2, P7 og G12.
  Beslutning 4 åbner P6 og G11. Beslutning 5 åbner M3, P8 og G13.

1. **Testfeltet (P0).** A: testporten giver menneskeholdene prod-lignende udbrudsvilje. B: mål med
   det nuværende felt uden ordrer. Anbefaling A: B undermåler Grand Tours og ville få os til at
   kalibrere motoren mod et felt der ikke findes.
2. **Udbrudsmål pr. løbsgruppe (M1).** A: egne bånd pr. løbsgruppe × terræn, korte etapeløb lavere end Grand
   Tours. B: Grand Tour-terrænbåndene gælder alle løb. Anbefaling A: virkelighedens ugeløb vindes
   sjældnere fra udbruddet, og B ville kræve at korte løb ramte Grand Tour-niveau.
3. **Tidsgab-mål for korte etapeløb (M2).** A: egne bånd for nr. 10 og vindermarginen i 2-4 og 5-8
   etaper, ens i alle divisioner. B: egne bånd, men bredere i de lavere divisioner. Anbefaling A:
   samme princip som #6464, og slutklassementets bredde skal komme af løbet, ikke af divisionen.
4. **Klassementsjagten (P6).** A: kontrol på snor tidligt, hentning i finalen, kun hold med reel
   chance forsvarer. B: kun en mindre dæmpning af den fremskrevne gevinst. Anbefaling A: B flytter
   tidspunktet men ikke yo-yo-mønsteret.
5. **Kuperet enkeltstart (M3, P8).** A: felt-skalering som #6464 og to klasser. B: én klasse med højere
   loft. Anbefaling A: B ville godkende for stor spredning i de lavere divisioner.

## 7. Verifikations-tier

TIER FULL for P6/P8 (motor): `scripts/verify-local.ps1`, hele backend `node --test`, s5MotorBench,
tourDryRun-tests, testporten G1'-G14. P0/P7 (måleværktøj): `node --test` på scripts og en fuld
testport-kørsel. Ejeren ser tallene (privat) og udvalgte løbsfilm på preview før "tænd".

## 8. Risiko

Bag slukket revision; ingen spillerpåvirkning før ejer-go. Største risiko: P6 gør klassementet for
løst (udbrud der vinder løbet); G-gaten fra #5978 (top-10 aldrig 5 min uden jagt) og G12 fanger det.
P0 kan afsløre at endagsløb vinder for ofte med prod-feltet; G14 fanger det, og P1/P2 justerer.
