# Motor v3-tilvalg: målt baseline + kort design (#6937 #6938 #6814 #6912 #2757 #6939 #6486)

Status: design-udkast 23/10, intet bygget. Ejer-tilvalg til motor v3 fra 22/10 (natprompten, spor 1).
Bygger oven på `2026-10-17-6804-hilly-breakaway-design.md` (P1-P5) og
`2026-10-21-6804-udbrud-pr-loebsgruppe-design.md` (P0, P6-P8, PR #7013, fem valg låst A). Intet af
det der er låst dér genåbnes her; tilvalgene lægges oven på i revisionen `s5_profiles_v3`.
SSOT for reglerne: `docs/RACE_ENGINE_RULES.md`. Bygge-PR'erne opdaterer reglerne dér.

Hard rule 17: ingen vægte, tærskler, bånd eller målte andele her. Alle tal, inklusive
prod-målingerne, ligger privat i `balance-internals/6804-tilvalg/baseline-2026-10-23.md`
(gitignoreret). Hard rule 36: baseline målt FØR kode; denne PR er ren docs og rører ikke motoren.

Refs #6937 #6938 #6814 #6912 #2757 #6939 #6486 #6804

## 1. Metode og hvad baselinen ikke dækker

- **Prod, kun SELECT** (afsluttede løb i sæson 3 og 4): klassementsvindere, bjergtrøje, pointtrøje,
  daglige klassementer, startlister, etapeprofiler og tidslinjestørrelser. Evner er rytternes
  nuværende evner, brugt som stedfortræder for evnerne på løbsdagen.
- **Offline simulering** med motoren lokalt (ingen prod, ingen skrivning) på testportens to
  eksisterende cacher med prod-startlister og S4-ruter, 8 seeds, under `s5_profiles_v1` og
  `s5_profiles_v2` side om side. Måleskriptet ligger i den private mappe.
- **#6486** er målt med S5-ruter (læst med SELECT) kørt isoleret med D1-, D2- og D3-felter fra cachen.
- **Ikke kørt:** testporten på S5-ruterne med generator-felt. Det kald kræver prod-hemmeligheder
  og var ikke tilladt i denne session. Simuleringen er derfor på S4-ruter. Det dækkes, når P0
  (#7016, prod-lignende testfelt) kører, og hver gate nedenfor dømmes dér.
- **Ingen lokal PG17** på denne maskine (kun PG16-binærer; PG17-runneren fra #6765 kræver en PG17-bin).
  Motor-målingerne er DB-uafhængige. For #6814 er databasesiden målt read-only i prod
  (tidslinjernes størrelse), og motorsiden offline. **Hard rule 36 er derfor ikke opfyldt for
  #6814 endnu:** den lokale PG17-baseline (løbsfilm-designet §3A) køres og noteres i
  `balance-internals/6804-tilvalg/` på en maskine med PG17, FØR første kode-PR for #6814. Indtil da
  er #6814 ikke byg-klar; de øvrige tilvalg er DB-uafhængige motor- eller frontendændringer.

## 2. Tilvalgene

### 2.1 Bjergtrøjen vindes for ofte af klassementsvinderen (#6937)

**Baseline.** I prod vinder klassementsvinderen også bjergtrøjen langt oftere end i virkeligheden,
i både korte og lange etapeløb og under både v3 og v4. Simuleringen rammer samme niveau, så
fejlen er motorens og ikke et prod-tilfælde. v2 ændrer det ikke. I virkeligheden sker det i omkring
hver femte Grand Tour 2015-2025 (Touren oftere, Vueltaen næsten aldrig; egen optælling fra
Wikipedias slutklassementer, ikke krydstjekket mod ProCyclingStats); for ugeløb er der ingen
publiceret statistik. Båndet for G16 forankres først efter en kildetjekket optælling.

**Rod-årsag (målt):**
1. Topankomster på HC/1. kategori tæller dobbelt (ejer-låst skala) og afgøres af målordenen, dvs.
   af favoritterne. Når bjergtrøjens vinder har topankomst-point, er han langt oftere også
   klassementsvinder end når han ikke har.
2. En stigning undervejs er åben for alle i en lille gruppe (#5914: et udbrud kører samlet). På de
   sidste stigninger er favoritgruppen så lille, at kaptajnerne selv tager pointene.
3. Udbrydere scorer næsten aldrig flest bjergpoint: typisk kommer næsten ingen af bjergtrøjens
   point fra udbrud. Der findes ingen rytter der jagter trøjen over flere dage.

**Design (kort).** Skalaerne røres ikke (ejer-låste). Adfærden ændres bag `s5_profiles_v3`:
- **B1 Bjergjæger:** et hold med en jæger eller fri rytter med klatreevne kan gå i udbrud på
  kuperede og bjergetaper for at samle bjergpoint (samme udvælgelse som P3, ny motivation
  "bjergpoint"). Bjergtrøjens fører forsvarer, som i dag.
- **B2 Favoritter kører ikke om bjergpoint undervejs:** i en favoritgruppe uden udbrydere ruller
  kaptajnerne over toppen bag dem der kæmper; topankomsten er uændret (målordenen). Dette er en
  ændring af #5914's regel for små grupper og er derfor en ejer-beslutning (§4, beslutning 1).
- **Gate G16:** andelen af etapeløb hvor klassementsvinderen også vinder bjergtrøjen, inden for et
  privat bånd pr. løbsgruppe; bjergtrøjens vinder har udbrudspoint i en mærkbar del af løbene.

### 2.2 For få ryttere udgår (#6938)

**Baseline.** I prod udgår kun en lille brøkdel af dem der starter et etapeløb, og nogle løb har
slet ingen udgåede. Simuleringen giver endnu færre: styrt-udgang er næsten fraværende på alle
terræner, og uden for tidsgrænsen er den eneste reelle kilde, og kun på bjerg. I virkeligheden
mister en Grand Tour typisk en sjettedel til en femtedel af feltet (Touren 2023 og 2024, egen
optælling fra Wikipedias slutklassementer, ikke krydstjekket), og ugeløb og endagsløb mister mange
flere end i spillet. Båndet for G17 forankres først efter en kildetjekket optælling.

**Rod-årsag.** Motoren kender kun to veje ud: alvorligt styrt (sjældent) og tidsgrænsen (med
grupetto-redning og juryens genindsættelse). Den kender ikke de største kilder i virkeligheden:
sygdom og træthed der får en rytter til ikke at starte næste dag, og hjælperen der stiger af i et
endagsløb når arbejdet er gjort.

**Design (kort), bag `s5_profiles_v3`:**
- **U1 Ikke-start mellem etaper** ud fra træthed og form (samme træthedsmodel som #6984), højest i
  lange løb og efter bjergetaper. Ingen skade; rytteren er bare ude af løbet.
- **U2 Styrt-udgang** kalibreres mod et privat bånd pr. terræn (brosten og nedkørsler højest).
- **U3 Endagsløb:** en hjælper der er sat (langt efter og uden opgave) kan stige af. Det giver ingen
  straf og ingen skade og vises som "udgået" i resultatet.
- **Gate G17:** udgåede pr. løbsgruppe inden for et privat bånd; kaptajner udgår ikke oftere end
  hjælpere (ellers rammer det spillernes løb for hårdt).

Spillerpåvirkning: en udgået kaptajn kan koste et klassement. Hvor ofte det må ske, og om U1 og U3
skal med, er ejer-beslutning 2 (§4).

### 2.3 Jagtafstand på `gap_update` til løbsfilmen (#6814)

**Baseline.** Ingen `gap_update` har jagtafstand, hverken i prod eller i simuleringen under v1/v2,
så filmens gab-kurve er tom på alle udbrudsetaper. Motoren har signalet: gruppe-snapshots viser
udbruddets forspring i de fleste segmenter af en udbrudsetape. Tidslinjerne er små; tilføjelsen
lægger to felter på eksisterende udbrudsrækker plus ét slutpunkt ved hentningen.

**Design.** Uændret fra `2026-10-22-loebsfilm-pakken-design.md` §3A (som igen bygger på
`2026-10-18-6814-gap-update-chase-design.md`): `chase_group_id` + `separation_seconds` fra
`findChaseGroup`, slutpunkt fra tilstanden før sammenlægningen, før/efter-sammenligning på samme
revision. Placering: i v3 efter P6 (én skriver i `breakaway.ts`, aftalt 21/10). Kurven vises først
når v3 tændes. Ingen ny ejer-beslutning; løbsfilm-designets §7 punkt 2 (v3 frem for v2) er dermed
besvaret som anbefalet.

### 2.4 15-minutters-udbrud (#6912)

**Baseline.** Forspringet på feltet stiger på flade etaper rutinemæssigt helt op til lad-gå-loftet,
og en betydelig del af de flade udbrudsetaper passerer ejerens
loft for flade udbrud (tallet er privat). Feltet henter dem til sidst (flade udbrudssejre er få og små), men filmen og
spillerne ser det store tal undervejs. På bjerg ses de store forspring i halen. v2 ændrer det ikke;
på flad er det en anelse værre.

**Rod-årsag (målt del og hypotese).** Målt: P2's gate G2 (17/10-designet) dømmer kun kuperet og
bjerg, og på flad når forspringet loftet i stedet for at stoppe i mellemzonen. Hypotese, ikke
verificeret i koden endnu: spurterholdenes etapeinteresse (`stageWinChaseForceV3`) virker først
sent på etapen, og P2's tekst "jagt-gulvet på flad/rullende beholdes" lader loftet stå. Første
bygge-trin læser `breakaway.ts`/`stageWinChaseForceV3` og bekræfter eller afkræfter hypotesen, før
der ændres noget.

**Design (kort).** Ingen ny mekanik, men en udvidelse af P2 til flad, som ændrer P2's formulering
om flad og derfor er en ejer-beslutning (§4, beslutning 6):
- Spurterhold med etapeinteresse (flad afslutning) går i kontrolleret jagt, når forspringet nærmer
  sig det et fladt udbrud realistisk får, i stedet for at vente på finalen.
- **G2 udvides** til flad og rullende med eget privat loft for den øvre zone og en hård grænse;
  enhver etape over den øvre zone skal have "ingen jagt-interesse" i sin hændelse (som G2 i dag).
- G15 (Hedjaz-casen) dækker allerede at et ufarligt udbrud på en flad etape hentes.

### 2.5 Pointtrøjen: sprintpoint på bakke/bjerg vægter for højt (#2757)

**Baseline.** Point pr. etapetype er allerede skaleret (siden #2770), og pointtrøjens vinder henter
størstedelen af sine point på flade etaper. Alligevel vinder feltets bedste sprinter kun en
mindre del af pointtrøjerne, i prod og i simuleringen, og klassementsvinderen vinder en mærkbar del.
Antallet af flade etaper i løbet ændrer ikke billedet mærkbart i simuleringen; i prod er stikprøven
med flere flade etaper for lille til en konklusion. Den gamle flade tabel
(`classPointsForRank`) kører ikke i S5: alle S5-etapeløb har fulde rutedata.
"Bedste sprinter" er i målingen rytteren med højest sprint-evne i feltet; G18 bruger en bredere
definition (sprint-kaptajn eller en af feltets bedste sprintere).

**Rod-årsag (målt, i rækkefølge):**
1. **Hvem vinder de flade dage (største):** når den bedste sprinter taber trøjen, taber han allerede
   på de flade etaper; trøjens vinder tager langt flere flad-point end ham. Hvorfor (spurtfinalens
   evne-blanding, leadout, brosten, reducerede spurter) er **ikke målt**; kun vinderens rolle er talt
   (kaptajner og sprint-kaptajner deler det meste).
2. **Ekstrapoint:** indlagte spurter og kuperede afslutninger giver kaptajner og udbrydere de få point
   der afgør et tæt regnskab.
3. **Rutemix (mindre, men reel for nogle løb):** en del S5-etapeløb har ingen flade etaper. Der kan en
   sprinter ikke vinde trøjen, uanset motoren.

**Design (kort).** Ejer-låste skalaer røres ikke.
- **S0 Mål spurtfinalen først (måling, ingen motorændring):** på flade etaper med spurtafslutning
  måles hvem der vinder (rolle, sprint-evne, leadout, brostens- vs. ren flad), så årsag 1 kan
  designes på data. Det er første trin for #2757 og kommer før S1.
- **S1 Pointjagt (motor, v3):** som i virkeligheden kan pointtrøjens fører og hold med en
  sprint-kaptajn sende en pointjæger i morgenudbruddet på kuperede etaper for at tage den indlagte
  spurt (samme udvælgelse som B1, motivation "sprintpoint"). Skalaerne og #5914 er uændrede.
- Brosten bruger flad-skalaen (ejer-låst) og vindes ofte af klassikerkaptajner; det er virkeligt
  og ændres ikke.
- **S2 (rute-generator, ikke motor):** etapeløb med pointtrøje får mindst én flad etape, og længere
  løb flere (minimum pr. løbslængde er privat). Den hører til generatoren (#6369-linjen), ikke v3.
- **Gate G18:** i løb med flere flade etaper vinder en sprinter (sprint-kaptajn eller
  en af feltets bedste sprintere; definitionen er privat) pointtrøjen inden for et privat bånd; klassementsvinderen vinder den sjældent.
- Issue #2757's første acceptkriterie (fallback-stien) er ikke rettet, men gjort irrelevant for S5,
  fordi alle S5-løb har rutedata. Kriteriet beder om at det dokumenteres i issuet; det gør bygge-PR'en.

### 2.6 Favoritter efter etapens profil, ikke klassementet (#6939)

**Baseline.** Etapesidens favoritliste (`favouritesFor`, `stagePageV2Model.ts`) er top 5 i det
samlede plus tidligere etapevindere. I prod rammer listen sjældent vinderen af en flad etape og
kun en del af gangene på bjerg og kuperet. En liste efter etapens krav og rytternes (skjulte)
evner ville i simuleringen ramme vinderen markant oftere på flad og enkeltstart. Det er et loft:
den spillervendte liste må kun bruge offentlig information og når ikke loftet. Dens træfsikkerhed
er ikke målt endnu; bygge-PR'en måler den mod prod-resultaterne før go-kortet.

**Rod-årsag.** Listen kender ikke etapens profil.

**Design (kort), frontend, ingen motor, ingen revision:**
- Favoritterne vælges efter etapens afslutning: på flad/spurt rytterne med flest gode placeringer på
  flade etaper i dette løb og denne sæson; på bjerg og enkeltstart det samlede klassement plus de
  bedste på samme terræn; på kuperet en blanding. Kun offentlig information (resultater og
  rytterens type), aldrig skjulte evner eller route fit for andre hold (fog of war).
- Før første etape: uændret tom liste (bevidst valg i `favouritesFor`: intet ærligt grundlag i løbet
  endnu). En sæsonbaseret liste før etape 1 er en mulig senere udvidelse, ikke en del af dette design.
- Fodnoten ændres fra "Baseret på løbet indtil nu" til en tekst der siger at listen følger etapens
  profil (EN først, DA under, efter `docs/TONE_OF_VOICE.md`).
- Etapesiden deles med #6512, #6683 og #6970; bygges i rækkefølge efter ejerskabsreglen.
- Visuelt go-kort med skærmbillede før merge (UI-PR).

### 2.7 D3: bjergetape uden topankomst (#6486)

**Baseline.** Ingen D3-bjergetape med nedkørselsfinale er kørt i prod under v4 eller S5-motoren
(kun før tændingen 11/10). S5's D3-bjergetaper med nedkørselsfinale er nye generator-ruter; den rute
#6486 beskriver, blev ikke fundet blandt de to S5-ruter der er set i detaljer (af fire ruter, hver i
fire D3-grupper). To af dem er målt isoleret med felter fra alle tre divisioner: ruten med én lang
stigning og toppen tæt på mål ligger på loftet i alle divisioner; ruten med flere lange stigninger og
toppen langt fra mål ligger over loftet i alle divisioner, også D1.

**Foreløbig afgørelse (svagt grundlag).** Målingen er én rute af hver type, kørt isoleret uden
klassement og holdordrer, så den peger på rutetypen frem for divisionen, men beviser det ikke. Begge
steder er derfor stadig mulige:
- **D1 (motor, v3):** på en bjergetape uden topankomst kan favoritgruppen samle sig på en lang
  nedkørsel og i dalen før mål (finale-nedkørslens regruppering), så nr. 10 dømmes mod sit eget loft
  (`mountain_non_summit`, #6456) i alle divisioner. Risiko: den samme regruppering virker på alle
  bjergetaper uden topankomst i alle løb.
- **D2 (rute-generator):** generatoren undgår, eller placerer anderledes, den rutetype der spreder
  over loftet (flere lange stigninger med toppen langt fra mål) i de divisioner hvor det sker.
- **Næste skridt før valget:** alle fire S5-D3-ruter (og de tilsvarende i D1/D2) køres i testporten
  med hele løb og P0-feltet. Ligger hullet kun på én rutetype, er D2 det mindste indgreb; ligger det
  bredt på bjerg uden topankomst, er D1 det rigtige. Valget er ejer-beslutning 7 (§4).
- **Gate G19 (forslag):** nr. 10 på bjerg uden topankomst inden for loftet i alle divisioner på
  S5-ruterne, uden at topankomsterne flytter sig (G5 uændret).

## 3. Placering og rækkefølge

| Tilvalg | Hvor | Revision | Efter |
|---|---|---|---|
| #6814 jagtafstand | motor (`breakaway.ts`/`segmentLoop.ts`) | v3 | P6 |
| #6912 forspring på flad | motor (P2 udvidet) | v3 | P2 |
| #6937 bjergtrøje (B1, B2) | motor (`breakawayPermission.ts`, `bonusSeconds.ts`) | v3 | P3 |
| #2757 S0 | måling (testport/tourScorecard), ingen motor | ingen | kan køres nu |
| #2757 S1 | motor (`breakawayPermission.ts`) | v3 | B1 og S0 |
| #2757 S2 | rute-generator | ingen (generator) | efter ejer-beslutning |
| #6938 udgåede (U1-U3) | motor + kørsels-flow (ikke-start mellem etaper) | v3 | sidst, efter G1'-G15 er grønne |
| #6486 D1 eller D2 | motor (finale-nedkørsel) eller rute-generator | v3 eller ingen | efter testport på alle S5-D3-ruter |
| #6939 favoritter | frontend (etapesiden) | ingen | kan bygges nu, uafhængigt |

Ét trin pr. commit, testport efter hvert, som P0-P8. Al motorændring bag slukket `s5_profiles_v3`;
v1 og v2 bit-identiske. Tænd-gaten fra 22/10 gælder uændret. G16-G19 er forslag; om de skal
lægges til tænd-gaten, er ejer-beslutning 8.

## 4. Ejer-beslutninger (én ad gangen, hver med anbefaling)

1. **Bjergpoint i favoritgruppen (#6937, B2).** A: kaptajner ruller over toppen undervejs, når de
   kører i en lille favoritgruppe; topankomster uændrede. B: kun B1 (bjergjæger i udbrud), #5914's
   regel uændret. Anbefaling A: B1 alene flytter ikke de point favoritterne tager på de sidste
   stigninger.
2. **Flere udgåede (#6938).** A: U1 (ikke-start af træthed) + U2 (styrt kalibreret) + U3 (hjælper
   stiger af i endagsløb). B: kun U2. Anbefaling A: U2 alene giver flere styrt, men ikke den store
   kilde i virkeligheden; U1 og U3 rammer mest hjælpere.
3. **Pointjagt i udbrud (#2757, S1).** A: pointjægere kan gå i udbrud på kuperede etaper og tage den
   indlagte spurt. B: ingen motorændring nu; vent på S0-målingen af spurtfinalen. Anbefaling B:
   den største målte årsag er hvem der vinder de flade dage, og den skal måles (S0) før der
   designes; S1 rammer kun ekstrapointene.
4. **Rutemix for pointtrøjen (#2757, S2).** A: generatoren giver alle etapeløb mindst én flad etape og
   længere løb flere (minimum pr. løbslængde er privat). B: ingen ændring. Anbefaling A for løb uden flade
   etaper (der kan en sprinter aldrig vinde trøjen); effekten på resten er lille i målingen.
5. **Favoritter (#6939).** A: bygges nu som frontend-PR med billede. B: venter på v3. Anbefaling A:
   uafhængig af motoren.

6. **Forspring på flad (#6912).** A: P2 udvides til flad (spurterhold kontrollerer tidligere, G2 også
   på flad og rullende); det ændrer P2's linje om at jagt-gulvet på flad beholdes. B: P2 uændret;
   kun filmen forklarer store forspring. Anbefaling A: det er netop på flad, spillerne ser de store
   tal, og hypotesen bekræftes i koden før byg.
7. **D3-bjergetaper uden topankomst (#6486).** A: vent på testporten med alle S5-D3-ruter og vælg
   derefter D1 (motor) eller D2 (generator) efter hvor bredt hullet ligger. B: byg D1 nu. Anbefaling
   A: grundlaget er én rute af hver type.
8. **Nye gates til tænd-gaten (G16-G19).** A: G16-G19 lægges til tænd-gaten for v3 med private bånd
   for de tilvalg ejeren siger ja til. B: de måles og vises, men blokerer ikke tændingen. Anbefaling A;
   et fravalgt tilvalg får ingen gate.

Kun #6814 kræver ingen ny beslutning: det følger løbsfilm-designet §3A, og dets §7 punkt 2 (v3) er
besvaret som anbefalet.

## 5. Verifikation

- Motor-tilvalgene: TIER FULL som P6/P8 (`scripts/verify-local.ps1`, hele backend `node --test`,
  s5MotorBench, tourDryRun-tests), testporten G1'-G15 og de godkendte af G16-G19 på S5- og S4-ruter med P0-feltet, v1/v2
  bit-identitet.
- #6939: frontend-tests, lint, typecheck, snapshots i alle tre Playwright-projekter, skærmbillede.
- Private før/efter-tal skrives i `balance-internals/6804-tilvalg/` ved siden af denne baseline.
- **Ejeren ser det før tænding (tænd-gaten 22/10, uændret):** Tour-prøvekørsel mod den gamle motor,
  Fable som uafhængig dommer, og 3 udvalgte løbsfilm på preview, valgt så de viser tilvalgene
  (en bjergetape med bjergjæger i udbrud, et etapeløb med udgåede, en flad etape med kontrolleret
  forspring). v3 er én samlet motorpakke bag én revision, så de udvalgte film på preview er
  ejerens validering af pakken; der er ingen separat staging-runde for motoren.
- #6939: ejeren ser etapesiden på preview (Android-bredde) før merge.

## 6. Risiko

- B1, B2 og S1 ændrer pointfordeling, som spillerne ser i klassementerne; derfor bag slukket revision og
  ejer-beslutning.
- U1 kan tage en kaptajn ud af et løb; G17 holder kaptajner under hjælperne.
- D1 (hvis valgt) kan gøre bjergetaper uden topankomst for lukkede i alle løb; G5 (topankomster uændret) og loftet fra #6456
  i begge retninger fanger det.
- Simuleringen er på S4-ruter; S5-ruterne har færre flade etaper i en del løb, så #2757 og #6912
  kan se anderledes ud. Første testport med P0 på S5-ruterne opdaterer baselinen.
