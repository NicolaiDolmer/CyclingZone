# Økonomi-designkritik: værdi, løn og pengekredsløb

**Dato:** 2026-08-14 · **Form:** designkritik + revideret spec
**Forholder sig til:** [`2026-08-14-vaerdi-og-loen-fundament-design.md`](2026-08-14-vaerdi-og-loen-fundament-design.md) · [#3449](https://github.com/NicolaiDolmer/CyclingZone/issues/3449) · [#3393](https://github.com/NicolaiDolmer/CyclingZone/issues/3393) · [#3360](https://github.com/NicolaiDolmer/CyclingZone/issues/3360)

> **Ejerens bestilling, ordret:** *"Giv dette grundig kritik og gennemgå om du rent faktisk synes det er godt spildesign... Det er vigtigt, at vi laver et verdensklasse design... ikke små dårlige quickfixes, men rent faktisk en langsigtet fantastisk løsning."*

**Målegrundlag:** alt er målt read-only mod prod (Supabase-projekt `ghwvkxzhsbbltzfnuhhz`) den 14/8 2026, eller læst i kildekoden på den angivne sti. Populationen "menneskehold" er 199 hold: `user_id` sat, ikke AI, ikke bank, ikke testkonto, ikke frosset. Hvor noget ikke er verificeret, står der **ikke målt**.

---

## 1. Dommen, først

**Nej, ikke som det står.** Fundamentet er rigtigt tænkt på to punkter og forkert på det ene punkt der bærer hele resten: designet vil lade markedet bestemme værdierne, men koden forbyder markedet at sige at en rytter er mere værd end modellen påstår, og 90 % af al handel foregår med banken til en pris modellen selv dikterer. Der findes **23 handler i hele spillets historie** hvor to spillere har budt en pris op fra en anden spillers udbud (målt: `auctions`, status completed, `seller_team_id` sat, `current_price > starting_price`, 22/6 til 8/8), og det er hele evidensgrundlaget for "spillerdrevne værdier".

Delvist betyder konkret:

| Del | Dom |
|---|---|
| Beslutning 2, kun søndag | **Holder.** Uændret. Den er rigtig og bør stå |
| Beslutning 4, lønnen er rytterens egenskab | **Holder som princip.** Det er den stærkeste enkeltbeslutning i dokumentet |
| Lønkurvens konkave form (#3393) | **Holder, målt.** Den fjerner 8/9 af alders-inversionen. Se §3.6 |
| Beslutning 1, marked sætter struktur og sim sætter niveau | **Falder.** Uenigheden er ikke et niveauskift, den er en trend hen over fordelingen. Se §3.4 |
| Beslutning 3, de to gates | **Falder.** Gate 1 bliver grøn af netop den deflation den skal forhindre. Gate 2's dom afhænger af hvilket tidsvindue man vælger. Se §3.2 og §3.3 |
| Erkendelsen af hvad værdimodellen ER | **Mangler helt.** Værdimodellen er spillets største pengedræn og samtidig en pengekilde. Den behandles i dag som en prisseddel. Se §3.5 |

Den korte version af hvad der skal ske: **lås markedet op før du giver det vægt, og giv det så vægt dér hvor der faktisk er evidens, rytter for rytter, i stedet for efter en kalender.**

---

## 2. Hvad andre spil gør

Kun det der er relevant for os. Fem punkter.

### 2.1 Hattrick viser ikke et værdital, den viser sammenlignelige salg

Hattrick har kørt siden 1997 med ét fælles auktionsmarked. Værktøjet til prisdannelse hedder Transfer Compare og viser hvad *lignende* spillere faktisk er solgt for ([Transfer compare](https://wiki.hattrick.org/wiki/Transfer_compare), [Transfers](https://wiki.hattrick.org/wiki/Transfers)). Der er ingen officiel pris at anke imod, og derfor heller ingen cirkularitet.

Deres anti-flip-mekanik er en **hastighedsafgift**, ikke en flad kurtage: sælger beholder 83 % ved 0 dage i klubben, stigende til 93 % efter ca. 106 dage. Agenthonoraret starter på 12 % og falder over 16 uger til 2 % (samme kilde).

Deres egen diagnose i [Roadmap 2021](https://wiki.hattrick.org/wiki/Roadmap_2021:_Chat,_Mobile,_Achievements,_Economy) er ordret vores situation: der genereres for meget kontant, spillerne opbevarer formue i spillere i stedet for penge, og mange valg bliver automatiske fordi kapital er rigelig.

### 2.2 EA FC beviser at en ren tabelværdi er shippable

Værdi i FIFA/EA FC er ikke gemt i databasen. Den beregnes ud fra en opslagstabel over OVR, plus additive modifikatorer for alder, restpotentiale, position og kontraktlængde ([playervalues.ini](https://github.com/xAranaktu/FIFA-18---iniToCT/blob/master/ORG_INIFILES/playervalues.ini), [Live Editor FAQ](https://github.com/xAranaktu/FIFA-20-Live-Editor/wiki/Frequently-asked-questions)). Grundtabellen er log-lineær: ca. **×1,219 pr. OVR-point** over OVR 50 til 95.

Pointen for os: verdens mest spillede fodboldmanager har **nul markedsfeedback i værdien** og det generer ingen. Et sim-forankret tal er ikke en fejl der skal rettes. Det er en legitim destination.

### 2.3 Baseball skiller produktion fra omregningskurs, og bruger tre kurser, ikke én

WAR-økonomien er to trin der holdes adskilt: forventet produktion, og en dollars-per-win-kurs estimeret empirisk fra faktiske kontrakter. FanGraphs' 2026-opgørelse måler at **ét samlet tal er dårligere end tre bånd**: MAE 9,7 mio. USD mod 8,5 mio., ca. 12 % bedre, fordi et samlet tal *"masks important market differentiation"* ([What Are Teams Paying For A Win In Free Agency? 2026 Edition](https://blogs.fangraphs.com/what-are-teams-paying-for-a-win-in-free-agency-2026-edition/)). Kurserne: 6,74 mio. i 0-1-båndet mod 12,84 mio. i 2+-båndet.

Det er den direkte modprøve mod beslutning 1. I et marked med rigtige penge og professionelle købere tør man ikke antage at "niveauet" er én skalar.

### 2.4 Et NPC-bud til fast pris er en pengepumpe, ikke en pris

Zachary Booth Simpsons GDC-oplæg om Ultima Online er primærkilden: NPC-butikker der køber til fast pris trykker penge on demand, og det gav hyperinflation ([The In-game Economics of Ultima Online](https://dergigi.com/assets/files/UO-Economics.pdf)). RuneScapes High Level Alchemy er samme mekanik brugt bevidst: den konverterer en genstand til 60 % af dens listede værdi og fungerer dermed som et **hårdt prisgulv** på hver eneste handelsvare ([RuneScape Wiki](https://runescape.wiki/w/High_Level_Alchemy)).

Vores bank-gulv i `backend/lib/auctionRules.js:110` er nøjagtig den mekanik. Se §3.1.

### 2.5 Rigtig cykelsport prissætter en afkøbning som restlønnen

UCI's reglement forbyder transferbetalinger ved kontraktudløb (art. 2.15.120: *"All transfer payment systems are prohibited"*) men kræver en trepartsaftale midt i kontrakten (art. 2.15.123a). Sanktionen ved ulovligt brud er **restlønnen på kontrakten, minimum 6 måneders løn**, med solidarisk hæftelse.

Det giver os en principiel og genkendelig buyout-formel der ikke skal opfindes. Se §5.6.

---

## 3. De indvendinger der overlevede modprøven

Rangeret efter hvor meget de ændrer designet.

### 3.1 Markedet er forbudt at sige at en rytter er mere værd end modellen påstår

Det her er den vigtigste, og den er en enkelt kodelinje.

`backend/lib/auctionRules.js:96-113`, `getAuctionStartPriceIssue`:

```js
if (isOwnRider) {
  if (price < 0 || price > value) return { code: "own_price_out_of_range", riderValue: value };
} else if (price < value) {
  return { code: "below_value_floor", riderValue: value };
}
```

Egen rytter: udbudsprisen må **maksimalt** være modellens værdi. Bankens og AI'ens ryttere: udbudsprisen skal **mindst** være modellens værdi. Markedet er klemt fast om modellen fra begge sider.

Ejerens egen sætning er *"if managers are paying more for french riders, the values should pick up on that."* Med den regel kan managere **ikke** betale mere. En manager der mener hans franske rytter er 3 gange sit tal værd, har ingen måde at udtrykke det på.

**Målt, hele historikken** (`auctions`, status completed, `current_bidder_id` sat):

| Slags | Handler | Sum af priser | Median | Clearet til præcis startpris |
|---|---:|---:|---:|---:|
| Bank-/AI-salg | 1.037 | 67.505.415 | 13.771 | 736 |
| Spiller-til-spiller | 113 | 3.936.973 | 14.882 | 90 |
| **I alt** | **1.150** | **71.442.388** | | **826 (71,8 %)** |

Og af de 1.150 var kun 324 konkurrenceprissatte (prisen steg over startprisen). Krydset med sælgertype:

> **Spiller-til-spiller OG konkurrenceprissat: 23 handler. Nogensinde.**
> Samlet volumen 985.912 CZ$, median 21.058, 12 af dem i de seneste 30 dage.

Dertil: 2.090 af 3.240 afsluttede auktioner (64,5 %) fik **aldrig et bud**.

**Scenariet i tal.** En manager ejer Andrea Riva, 22 år, den dyreste spillerejede rytter. Han vil sælge. Han må ikke udbyde ham over 23,1 mio. Rigeste menneskehold har ikke råd alligevel. Der er 0 sammenlignelige konkurrencehandler i hans værdibånd. Uanset hvad markedet mener om Riva, kan det ikke komme til udtryk. Modellen har ikke bare første ord, den har det eneste ord.

**Hvorfor loftet findes.** Jeg fandt ingen kommentar eller guard i `auctionRules.js`, `auctionEngine.js` eller `auctionFinalization.js` der nævner kollusion eller hvidvask (grep på collusion/launder/hvidvask/snyd: 0 hits). Kodekommentaren siger *"ingen kunstig inflation over rytterens Værdi"*. Men loftets **reelle** job er anti-kollusion: uden det kan to spillere flytte 50 mio. mellem sig via en værdiløs rytter. Det skal løses, ikke ignoreres. Se §5.3.

### 3.2 Gate 1 bliver grøn af den deflation den skal forhindre

Gate 1 er kontanter delt med samlet rytterværdi. Målt 14/8: 126.946.670 / 359.851.182 = **35,3 %**.

Tælleren er kontanter. Nævneren er modellens eget output. Falder værdierne 50 % uden at der kommer en krone ind i spillet, går gaten fra 35,3 % til 70,6 %. **Gaten belønner altså præcis det udfald designet er bange for.** Spec §2.2 beskriver selv doom-loopet ("lavere værdier giver lavere lønninger, hvilket frigiver kontanter") og bruger så en måling der bliver grønnere for hver omgang i loopet.

En gate hvis nævner er den ting den skal godkende ændringer af, er ikke en gate.

Dertil kommer at definitionen ikke er entydig. Kritikken målte fire forsvarlige definitioner af samme størrelse: 50,4 %, 35,3 %, 84,6 % og 12,4 %, afhængigt af om man tæller akademiryttere, frie agenter og AI med. Alle fire er reproduceret. Spec §3.2 siger ikke hvilken.

### 3.3 Gate 2's dom afgøres af et vilkårligt valg af tidsvindue

Verificeret i to uafhængige kørsler:

| Kørsel | Markedsmodel MAE | v4 MAE | Vinder |
|---|---:|---:|---|
| 6/8 (`backend/scripts/marketValueModelV1.draft.json:120-139`) | 56.118 | 119.571 | marked, faktor 2,1 |
| 10/8 (spec §2.1) | 38.176 | 28.968 | v4, faktor 1,3 |

Modprøven fandt en skarpere version: **samme dag, samme data, samme to modeller, fortegnet skifter alene ved at ændre vinduets længde.** Parret log-forskel, positiv betyder markedsmodellen er bedst:

| Vindue | n | Forskel | SE |
|---|---:|---:|---:|
| 7 dage | 48 | -0,244 | 0,139 |
| 14 dage | 83 | -0,193 | 0,097 |
| 21 dage | 132 | -0,043 | 0,080 |
| 30 dage | 185 | **+0,370** | 0,084 |

Og dommen afhænger også af metrikken: i 6/8-kørslen vandt v4 i log-rum (0,8797 mod 0,9144) mens markedsmodellen vandt i kroner (56.118 mod 119.571). Samme kørsel, samme holdout.

Spec §3.2 skriver gaten som *"markedsmodellens MAE mod simuleringsmodellens"* uden at fastsætte hverken vindue eller metrik. De to valg **er** afgørelsen.

**Vigtigt forbehold, som modprøven fik ret i:** kritikkens argument om at "signalet er 25 gange mindre end støjen" er statistisk ugyldigt. De 31x er variation i *niveauet* af én models fejl; gaten læser en *parret* forskel på de samme salg, hvor den fælles variation går ud. Målt på de seneste 205 salg er forskellen ca. 2,5 gange større end sin egen standardfejl. Gate 2 er altså ikke ren støj. Den er bare underspecificeret, og den måler stadig et univers hvor 71,8 % af handlerne clearer til modellens eget anker.

### 3.4 Én skalar kan ikke bringe markedsstrukturen op på simuleringens kroneniveau

Beslutning 1 siger: tag markedets rangorden, gang med et k så totalen matcher simuleringen. Modprøven forsøgte tre gange at vælte indvendingen mod det og fejlede alle tre gange.

Medianforholdet mellem v4 og markedsmodellen, pr. decil af den samlede evne O (støj midlet ud):

| O-decil | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| median k | 0,33 | 0,45 | 0,53 | 0,67 | 0,99 | 1,52 | 1,11 | 0,65 | 1,52 | **2,61** |

Spændet er **7,9 gange** og trenden er monoton nok til ikke at være støj. Anvendt på populationen med ét fælles k = 2,93:

| Gruppe | n | I dag | Efter beslutning 1 | Faktor |
|---|---:|---:|---:|---:|
| Under median | 1.570 | 3.995 | 24.465 | **6,12x** |
| Over median | 1.098 | 25.367 | 53.057 | 2,09x |
| p85-95 | 312 | 141.417 | 196.524 | 1,39x |
| Top 5 % | 156 | 1.115.252 | 604.132 | **0,54x** |

Bunden seksdobles, toppen halveres. Vælger man i stedet et k der varierer med evne, alder eller type for at redde det, har man givet markedet niveauet, og beslutningen er kollapset til sig selv. Det er samme erfaring som FanGraphs måler i §2.3.

**Forbehold:** koefficienterne stammer fra `backend/scripts/marketValueModelV1.draft.json` reproduceret i SQL, ikke fra scriptets egen kørsel (jeg må ikke køre scripts i denne opgave). To uafhængige reproduktioner gav aggregeret forhold 5,00 og 2,93. Retningen er robust, det absolutte niveau er **ikke verificeret**.

### 3.5 Værdimodellen er spillets største pengedræn og samtidig en pengekilde, og det er ikke erkendt nogen steder

Det her er den indvending der ændrer mest ved hvordan ejeren bør tænke om opgaven.

Målt på hele `finance_transactions`, hele ledgerens levetid (22/6 til 14/8):

| Post | Beløb | Andel af alle dræn |
|---|---:|---:|
| **Rytterkøb, netto** (`transfer_out` minus `transfer_in`) | **-56.156.700** | **53,3 %** |
| Faciliteter, køb | -18.572.000 | 17,6 % |
| Akademi-signeringer | -10.972.608 | 10,4 % |
| Upkeep | -10.680.000 | 10,1 % |
| **Løn** | **-3.241.445** | **3,1 %** |
| Scouting-rejser | -2.079.000 | 2,0 % |
| Akademi-drift | -1.730.000 | 1,6 % |
| Admin-justeringer | -890.631 | 0,8 % |
| Facilitets-upkeep | -774.500 | 0,7 % |
| Staff (løn + fratrædelse) | -226.164 | 0,2 % |
| **Sum af ægte dræn** | **-105.323.048** | 100 % |

Og prisen på rytterkøb er **modellens eget output**, fordi bankens udbudspris ikke må være under `market_value`.

Samtidig er modellen en **kilde**: `backend/lib/economyEngine.js:814` krediterer ved tvangssalg `credit = rider.market_value` direkte til holdets saldo via `creditTeam(..., "forced_debt_sale", ...)`. Pengene skabes ud af ingenting, til modellens pris.

Det betyder at et søndags-sweep ikke er en kosmetisk opdatering af en prisseddel. **Det er pengepolitik.** Hæv værdierne, og bankens ryttere bliver dyrere, hvilket destruerer flere penge. Sænk dem, og drænet skrumper. Det er præcis den mekanik UO-papiret i §2.4 advarer imod.

Ingen af de fire beslutninger nævner dette. Enhver ændring af værdiniveauet skal fra nu af regnes igennem på drænet, ikke kun på prissedlen.

### 3.6 #3393 er ikke en lønreform, det er et nyt dræn på ca. 26 mio. pr. sæson

Alders-inversionen som #3393 løser er **ægte og reproduceret** (løn som andel af markedsværdi, menneskehold, 14/8):

| Alder | n | Gns. værdi | Løn i dag | Løn under #3393 |
|---|---:|---:|---:|---:|
| 17-20 | 1.106 | 191.969 | **0,68 %** | 7,79 % |
| 21-23 | 497 | 165.040 | 1,24 % | 6,68 % |
| 24-26 | 668 | 47.086 | 3,66 % | 14,25 % |
| 27-29 | 660 | 30.446 | 5,79 % | 16,08 % |
| 30-32 | 395 | 26.258 | 6,99 % | 16,03 % |
| 33+ | 223 | 16.096 | **13,87 %** | 19,79 % |

Inversionen går fra faktor **20,4x** til **2,5x**. Formen virker. Den skal beholdes.

Men den samlede lønsum går fra 5.988.024 til 32.100.178, en faktor **5,36**, altså **+26,1 mio. CZ$ pr. sæson** i nyt dræn. Det ville flytte løn fra 3,1 % af alle dræn til den næststørste post i spillet. Det kan sagtens være rigtigt, men det er en pengepolitisk beslutning der i dag ligger gemt i en retfærdighedsfix.

Per division, mod målt indtægt (28 dage, alle kilder undtagen transfers og lån):

| Div | Hold | Lønsum #3393 | Målt indtægt, 28 d | Løn som andel |
|---|---:|---:|---:|---:|
| 2 | 48 | 19.667.279 | 44.216.400 | 44,5 % |
| 3 | 96 | 8.206.240 | 51.477.216 | 15,9 % |
| 4 | 55 | 4.226.659 | 7.629.600 | **55,4 %** |

D3 er for løs, D4 er stram. Én global `anchorSalary` på 15.000 rammer ikke tre divisioner der er så forskellige. Se §5.5.

### 3.7 Division 1 har nul menneskehold

Målt: D1 består af 24 hold, **alle AI**. D2: 48 menneskehold. D3: 97. D4: 55 menneskehold plus 144 AI.

Det gør enhver gate der er formuleret mod "topdivisionens median-sponsor" (G4 i #3393) til en reference mod en division uden spillere. Og `SPONSOR_INCOME_BY_DIVISION[1] = 600000` samt `UPKEEP_BY_DIVISION[1] = 440000` (`backend/lib/economyConstants.js:28,51`) er i praksis ubrugte konstanter. Det er ikke en fejl i værdidesignet, men det er en fejl i alt der kalibreres mod D1.

---

## 4. De indvendinger der faldt

Så de ikke skal genopdages. Alle er efterprøvet.

| Påstand | Hvorfor den falder |
|---|---|
| "Hvert holds bogførte formue falder 80 % på én søndag" | Kræver k=1,00 anvendt råt. Tre spærringer forhindrer det: 75/25-blandingen, støtte-guarden (`w_rider = global_weight × min(1, count_nearby/K)`) og ±25 %-ugeloftet (`weekly_cap.recommended: 0.25`) |
| "G4 brydes i det sekund nogen vinder den 74-mio.-rytter på auktion" | En fri agent kan ikke listes under fuld værdi (`auctionRules.js:110`). 73.984.921 CZ$ er 58,3 % af alle kontanter i spillet. Ingen kan købe ham |
| "Søndagsopdateringen femdobler hans lønbyrde" | Løn er **frossen ved signering**. `riders.salary` er `is_generated: NEVER`, og `economyConstants.js:221` siger ordret at løn er frossen (#1309). En værdiændring rører ikke eksisterende kontrakter |
| "Signalet er 25 gange mindre end støjen" | Sammenligner en parret difference med variansen i et niveau. Målt er forskellen ca. 2,5x sin egen standardfejl. Se §3.3 |
| "Lønformlens kalibrering har holdbarhed målt i dage" | 93 % af driften er flere ryttere, ikke en løbsk formel: Σ lønsum +13,5 %, ejede ryttere +12,6 %, **løn pr. rytter +0,8 %** |
| "G2 er allerede flippet til rød" | Falder på en oversete variabel: 928 af 3.549 ryttere har `contract_end_season = 2` og frigives i Phase 5c **før** payroll i Phase 6 (`backend/lib/seasonTransition.js`). Efter kontraktudløb: D2-medianens net +10.096, altså tyndt grøn |
| "Søndags-sweepet straffer styrke, altså doktrinbrud" | Mekanismen sporer **alder**, ikke sportslig styrke. Korrelation med værdivægtet alder +0,764, med potentiale -0,666. Og ingen har betalt for den værdi der fjernes: Riva blev købt af banken 25/6 for 347.840 CZ$ og er mærket til 23,1 mio. Det er en urealiseret opskrivning, ikke et tab |
| "Markedsdata er censureret, derfor kan den ikke bruges" | Falder i sin bærende form. Censuren gør data **skæv og tynd**, ikke ubrugelig. Den korrekte konsekvens er at vægte efter evidens (§5.2) og at fjerne censuren (§5.3), ikke at opgive projektet |

---

## 5. Det reviderede design

### 5.0 Diagnosen i én sætning

Ét tal forsøger at gøre tre uforenelige job: **prisseddel** (hvad spilleren ser og kan sælge for), **pengepolitik** (bankens udbudspris, som er 53 % af alle dræn) og **lønberegning**. Derfor kan man ikke ændre det ene uden at ødelægge de to andre. Løsningen er ikke en bedre model. Det er at skille de tre job ad.

### 5.1 Tre tal i stedet for ét

| Tal | Kilde | Bruges til | Bevæger sig |
|---|---|---|---|
| **Ankerværdi** | Simuleret præmiepotentiale (v4, uændret) | Lønberegning, formueopgørelse, tvangssalgs-kredit | Kun ved sæsonovergang eller modelrevision |
| **Værdi** (vist) | Blanding af anker og marked, vægtet pr. rytter efter evidens | Det spilleren ser på rytterkortet | Søndag, med kvittering |
| **Bankens udbudspris** | Selvstændigt pengepolitisk håndtag | Bankens og AI'ens auktioner | Justeres bevidst af ejeren, målt mod drænet |

Det er den ene ændring der gør resten mulig. Lønnen skrider ikke når markedet flytter sig, og bankens dræn kan justeres uden at omskrive alles formue.

### 5.2 Evidensvægt i stedet for kalender: Bühlmann-kredibilitet

Erstat den globale 75/25-blanding med en vægt der er **forskellig for hver rytter** og styret af hvor meget markedsevidens der findes for netop ham:

```
Z_i   = n_i / (n_i + K)                        K = 12
Vaerdi_i = (1 - Z_i) * Anker_i + Z_i * Marked_i
```

`n_i` = antal **kvalificerede** handler blandt sammenlignelige ryttere (±5 O-point, ±3 år) i de seneste 180 dage. Kvalificeret betyder: spiller-til-spiller, mindst to forskellige budgivere, og prisen steg over startprisen.

Det er ikke en opfindelse. Det er Bühlmann-kredibilitet, standardformen `Z = n/(n+k)`, hvor `k` afvejer procesvarians mod parametervarians, og hvor `Z → 0` ved tynde data trækker skønnet mod kollektivet ([Loss Data Analytics, kap. 9](https://openacttexts.github.io/Loss-Data-Analytics/ChapCredibility.html), [Bühlmann Credibility, SMU](http://www.mysmu.edu/faculty/yktse/NAM/NAM_S7.pdf)). Støtte-guarden i `marketValueModelV1.draft.json` har allerede den rigtige form. Forslaget her er at gøre den til **hovedmekanismen** i stedet for en fodnote, og at fjerne den globale kalenderblanding der ligger ovenpå.

**Hvad det giver i dag, målt:** med 23 kvalificerede handler i hele historikken er `n_i` nul eller nær nul for stort set hele populationen. `Z ≈ 0`. Værdierne rykker sig altså **næsten ikke** ved første søndag.

Det er ikke en fiasko. Det er systemet der siger sandheden: *der er endnu ikke evidens.* Og det er den eneste version af "fully dynamic" der kan holde, fordi vægten stiger af sig selv når handlerne kommer, uden at nogen skal fastsætte en tærskel eller vælge et tidsvindue.

**Niveau-normalisering: udgår.** Fordi `Z ≈ 0` er der ingenting at normalisere. Efterhånden som `Z` vokser, flytter markedet værdien dér hvor der er evidens og lader den stå hvor der ikke er. Summen driver naturligt. Det er ærligere end at gange en skalar på.

> **Afviger fra beslutning 1 og 3.** Beslutning 1 sagde at markedet sætter strukturen og simuleringen sætter kroneniveauet. Målingen i §3.4 viser at det ikke kan lade sig gøre med én skalar, og at enhver skalar der varierer med evne giver markedet niveauet alligevel. Beslutning 3's to gates udgår helt, fordi evidensvægten gør dem overflødige: der er ikke længere et trin der skal godkendes, kun en vægt der bevæger sig når data kommer. **Ejeren kan afvise dette** og beholde kalenderblandingen; prisen er at hvert trin skal godkendes på en måling der skifter fortegn med tidsvinduet (§3.3).

### 5.3 Lås markedet op, det er den egentlige opgave

Uden det her er §5.2 en tom formel, fordi `n_i` aldrig vokser.

**a) Fjern loftet på egen-rytter-udbudspris, erstat med et kollusionsværn.**

`auctionRules.js:110` skal ikke bare slettes, den skal erstattes:

```
udbudspris paa egen rytter:  0 <= pris <= 5 x Vaerdi        (i dag: <= 1 x Vaerdi)
salg over 3 x Vaerdi:        markeres til gennemsyn, taeller ALDRIG som evidens
evidens kraever:             mindst 2 forskellige budgivere
```

Loftet på 5x giver rigelig plads til at markedet kan sige "denne franske rytter er mere værd end I tror", som er ejerens egen sætning, og holder samtidig en bundet grænse mod pengeoverførsel via værdiløse ryttere. To-budgiver-kravet gør et kollusivt par ude af stand til at flytte modellen uanset hvad de betaler hinanden.

**b) Banken skal sælge på rigtig auktion, ikke til dikteret pris.**

Erstat gulvet `pris >= Vaerdi` med en reserve:

```
bankens reserve = 0,25 x Ankervaerdi
```

Det konverterer 1.037 døde observationer til prisdannelse. Med 126,9 mio. i kontanter der jagter udbuddet, sætter konkurrencen prisen, hvilket er det økonomisk rigtige svar, og det er præcis hvad Hattrick gør (§2.1).

**c) Vagt på drænet, fordi det her er pengepolitik.**

Reserven sænker potentielt spillets største dræn. Derfor skal den kobles til en måling, ikke sættes og glemmes:

```
maal:   netto rytterkoeb-draen holdes inden for 40 til 65 % af alle draen
maaling: rullende 28 dage, vises i admin ved siden af sweepet
handling: under 40 % -> haev reserven i trin paa 0,05. Over 65 % -> saenk den
```

Basislinjen i dag er 53,3 % (§3.5). Det er midt i båndet, hvilket er heldigt: det betyder at målet er at *bevare* nuværende dræn, ikke at ændre det, mens man skifter fra dikteret pris til opdaget pris.

### 5.4 Erstatningsdræn hvis reserven sænker banken for meget

To kandidater, i prioriteret rækkefølge. Byg dem **ikke** før §5.3c viser at drænet faktisk falder.

**1. Tidsbaseret transferskat (Hattrick-modellen, §2.1).** Sælger beholder 83 % ved salg samme uge, stigende lineært til 93 % efter 15 uger. Det er samtidig et anti-flip-værn og et dræn der skalerer med handelsvolumen, altså præcis dér hvor pengene er.

**2. Ægte løbende facilitets-upkeep.** Målt: `facility_purchase` -18.572.000 over 397 transaktioner og løbende, mod `facility_upkeep` -774.500 over 61 transaktioner på **én dato** (26/7). Faciliteter er i dag et engangsdræn med ca. 4 % årlig driftsomkostning. Et byggeri der ikke koster noget at eje, er en engangsskat, ikke en løbende beslutning.

### 5.5 Lønnen

Behold formen. Skift grundlaget og kalibreringen.

```
loen = A x (Ankervaerdi / 100.000) ^ 0,55        gulv 250, intet loft
```

Tre ændringer mod #3393 som den står:

**a) Grundlaget er Ankerværdien, ikke den viste Værdi.** Så flytter markedsstøj aldrig nogens lønbudget. Det bevarer beslutning 4 ordret (lønnen er en egenskab ved rytteren) og gør den samtidig stabil. Uden det her ville et lille marked kunne omskrive alles økonomi.

**b) `A` kalibreres, den hardkodes ikke.** `A = 15_000` er i dag en konstant i `backend/lib/economyConstants.js` mens `calibrateAnchorSalary()` allerede findes i `backend/lib/salaryBasis.js` og ikke bruges af `salaryBasisRecompute.js`. Regel:

```
ved hver saesonovergang: vaelg A saa samlet loensum = 35 % af MAALT indtaegt
                         forrige saeson, pr. division vejet efter trupvaerdi
```

Målt i dag med A = 15.000: D2 44,5 %, D3 15,9 %, D4 55,4 % (§3.6). Et mål på 35 % ville sænke A for D2 og D4 og hæve det for D3. Alternativt fastholdes ét globalt A og man accepterer spredningen; det er et valg for ejeren (beslutning 5).

**c) Intet loft, men lønnen skal stå på auktionskortet før man byder.** Doktrinen siger at spilleren skal kunne stole på det han ser. I dag står prisen på rytterkortet og regningen gør ikke. Vis den projicerede sæsonløn ved siden af buddet, opdateret live mens buddet stiger.

### 5.6 Buyout efter UCI-princippet

Fra §2.5: en afkøbning koster cirka det rytteren stadig har til gode.

```
buyout = resterende sæsoner x sæsonloen,  minimum 0,5 x sæsonloen
```

Det er genkendeligt fra rigtig cykelsport, det er trivielt at forklare i UI'et, og det gør lønnen til en reel forpligtelse man kan regne på inden man byder, i stedet for en fælde.

### 5.7 Søndagskvitteringen

Ændrer værdien sig, skal spilleren se hvorfor, i klar tekst. Minimum:

```
Vaerdi 24.100 (+3 %)
  Anker (simuleret praemiepotentiale)   23.400
  Marked (4 sammenlignelige salg)       31.200
  Vaegt paa marked                      25 %
```

Med `Z` synlig bliver "fully dynamic" noget spilleren kan **se** nærme sig, i stedet for en annonceret nedskrivning han ikke kan forudse. Det er samme princip som trænings-kvitteringen i #3709.

### 5.8 Doktrin-tjek: straffer det her styrke?

Bindende krav, gennemgået punkt for punkt.

| Element | Straffer det styrke? | Begrundelse |
|---|---|---|
| Fjern listeloftet (5.3a) | **Nej** | Kan kun hæve priser. Udvider hvad de stærke kan få for deres ryttere |
| Bankreserve 25 % (5.3b) | **Nej** | Gør ryttere billigere at erhverve for alle. Rører ikke eksisterende værdier |
| Evidensvægt Z (5.2) | **Nej, ved konstruktion** | Evidens kræver sammenlignelige handler. For eliteryttere findes de ikke (top 10 % af ryttere ejer 79,3 % af al trupværdi, målt), så `Z = 0` og toppen forbliver sim-forankret. Ingen ugentlig kværn på de dyreste, som §4-fundet ellers advarede om |
| Lønnen på ankerværdi (5.5a) | **Nej** | Konkav kurve betyder at de dyreste betaler en **mindre** andel af værdien: 7,79 % for 17-20-årige mod 19,79 % for 33+ |
| Buyout = restløn (5.6) | **Nej** | Symmetrisk, gælder alle, og er lavere end i dag for de fleste |
| **Tidsbaseret transferskat (5.4.1)** | **Tættest på grænsen** | Den beskatter handel. Men den rammer **hastighed**, ikke styrke, og satsen er identisk for et D4-hold og et topholdt. Den er struktur, ikke handicap. **Anbefaling: byg den ikke før §5.3c viser at drænet faktisk er faldet.** Det er den ene beslutning her jeg vil have ejerens eksplicitte ja til |

Ingen mekanik i designet kobler en spillers **resultater** til hans omkostninger eller til værdien af hans aktiver. Ingen karantæne, intet handicap, ingen progressiv sats efter placering. Den bedste kan fortsat vinde, og det er fortsat legitimt at købe sig stærk.

---

## 6. Løn og økonomi som helhed

Ejeren bad om at løn og økonomi tænkes ind i løsningen frem for at behandles for sig. Her er hele kredsløbet, målt.

### 6.1 Hvor pengene kommer ind

`finance_transactions`, hele ledgerens levetid 22/6 til 14/8, alle hold:

| Kilde | Beløb | Transaktioner | Note |
|---|---:|---:|---|
| Præmiepenge | +68.456.400 | 9.296 | Største kilde, 48,4 % af alt nyt |
| Sponsor, sæsonudbetaling | +58.305.302 | 156 | Én dato (26/7) |
| Bonus | +8.130.000 | 64 | |
| Sponsor, løbsdag | +6.218.354 | 3.758 | |
| Sponsor, resultatbonus | +299.740 | 10 | |
| Sponsor, signeringsbonus | +100.800 | 4 | |
| **Ægte kilder i alt** | **+141.510.596** | | |
| Lån modtaget | +29.560.266 | 102 | Ikke en kilde, det er gæld |
| Tvangssalgs-kredit | (ikke separat opgjort) | | `market_value` skabt af ingenting, `economyEngine.js:814`. **Ikke målt** som beløb |

### 6.2 Hvor pengene forsvinder

Se tabellen i §3.5. Kort: rytterkøb 53,3 %, faciliteter 17,6 %, akademi 10,4 %, upkeep 10,1 %, **løn 3,1 %**.

### 6.3 Er balancen sund?

Ugevis, kun menneskehold, ægte kilder mod ægte dræn:

| Uge | Kilder | Dræn | Heraf rytterkøb | Netto |
|---|---:|---:|---:|---:|
| 22/6 | 377.844 | -13.330.159 | -10.660.905 | -12.952.315 |
| 29/6 | 4.024.650 | -16.688.230 | -15.846.211 | -12.663.580 |
| 6/7 | 5.303.100 | -9.234.315 | -6.681.576 | -3.931.215 |
| 13/7 | 6.487.875 | -8.028.926 | -2.816.100 | -1.541.051 |
| 20/7 | 67.796.727 | -30.524.638 | -6.048.821 | +37.272.089 |
| 27/7 | 9.515.181 | -21.085.805 | -15.107.434 | -11.570.624 |
| 3/8 | 15.564.844 | -14.737.454 | -8.668.120 | +827.390 |
| 10/8 | 7.149.019 | -4.956.532 | -2.448.233 | +2.192.487 |
| **I alt** | **116.219.240** | **-118.586.059** | **-68.277.400** | **-2.366.819** |

**Fire ting at læse ud af det:**

1. **Strømmen er stort set i balance.** Netto -2,37 mio. over otte uger. Det er sundt, og det modsiger en antagelse om at spillet er ved at inflatere.
2. **Derfor er de 126,9 mio. i kontanter i al væsentlighed seed-kapital**, ikke optjent overskud. Ledgeren dækker ikke startsaldi, så det er **ikke målt** præcist hvor meget der blev udstedt ved holdoprettelse. Det er den vigtigste manglende måling i hele dokumentet.
3. **Økonomien er sæsonpulserende, ikke kontinuerlig.** Uge 20/7 alene stod for 58 % af alle kilder, fordi sponsorudbetalingen er ét årligt beløb. Det gør enhver måling der bruger et 7-dages eller 28-dages vindue afhængig af hvor i sæsoncyklussen den falder. Det er en anden grund til at Gate 2 skiftede fortegn (§3.3).
4. **12,4 % af alle kontanter er lånte.** 29.560.266 modtaget mod 13.832.311 tilbagebetalt = 15.727.955 udestående, mod 126.946.670 i kontanter. Ingen menneskehold står i minus i dag (målt: 0 hold med negativ saldo), så gælden er tjenlig, men den er ikke ubetydelig.

### 6.4 De strukturelle skævheder i pengekredsløbet

| Skævhed | Måling | Konsekvens |
|---|---|---|
| Formuen er ekstremt koncentreret | Top 10 % af ryttere = 79,3 % af al trupværdi. Nederste halvdel = 2,2 %. Top 1 % = 116,6 mio. | Markedet kan aldrig prissætte det der betyder noget. Al handel sker i de 2,2 % |
| Værdien sidder i ungdom | 17-20-årige: 1.106 ryttere, 212,3 mio. = 59 % af al trupværdi | Enhver ændring af aldersprofilen i modellen er en omfordeling af over halvdelen af spillets formue |
| Én rytter dominerer | Dyreste rytter 73.984.921 = **58,3 %** af alle kontanter i spillet | Han kan ikke handles. Han er et tal, ikke et aktiv |
| D4 er sultet | Målt indtægt 138.720 pr. hold pr. 28 dage, mod D3's 536.221 og D2's 921.175 | 55 menneskehold i D4 har 15 % af D3's indkomst pr. hold. #3393 ville lægge 55,4 % af den indkomst i løn |
| D1 er tom for mennesker | 24 hold, 0 menneskehold | Alt der kalibreres mod D1 kalibreres mod ingenting |
| Faciliteter er et engangsdræn | 18,57 mio. i køb mod 0,77 mio. i drift | Bygninger er en skat, ikke en løbende beslutning |

### 6.5 Rækkefølgen der følger af det

Økonomien skal vokse før markedet kan prissætte den. Det stod allerede i spec §3.2 (*"økonomien skal vokse, ikke værdierne falde"*) og er stadig rigtigt. Men rækkefølgen er:

1. **Lås markedet op** (§5.3). Uden det er alt andet teori. Koster ingen penge.
2. **Mål drænet** i 28 dage (§5.3c). Ingen ændringer imens.
3. **Kalibrér lønnen** mod målt indtægt (§5.5b), ikke mod en konstant fra 5/8.
4. **Løft D4's indtægt** før du femdobler dens lønbyrde.
5. **Erstatningsdræn** kun hvis §5.3c viser det er nødvendigt.

Evidensvægten i §5.2 kræver ingen af trinene for at blive slået til. Den giver bare `Z ≈ 0` indtil trin 1 har virket, hvilket er det korrekte svar.

---

## 7. Beslutninger ejeren skal træffe

Én ad gangen. Anbefaling ved hver.

**1. Skal loftet på egen-rytter-udbudspris fjernes og erstattes med 5x-loft plus to-budgiver-krav for evidens?**
👍 **Anbefaling: ja.** Det er den ene kodelinje der gør ejerens egen sætning om franske ryttere mulig at opfylde. Uden den kan markedet aldrig sige at noget er mere værd end modellen tror. Kollusionsrisikoen er reel og løses af 5x-loftet plus to-budgiver-kravet, ikke af 1x-loftet.

**2. Skal banken sælge på rigtig auktion med reserve på 25 % af ankerværdien, i stedet for gulv = fuld værdi?**
👍 **Anbefaling: ja, med drænvagten i §5.3c koblet på fra dag ét.** Det konverterer 1.037 dikterede priser til opdagede priser. Men det rører spillets største pengedræn (53,3 %), så det må ikke ships uden målingen. Vil du hellere være forsigtig, så start med reserve 50 % og mål i 28 dage.

**3. Skal den globale 75/25-kalenderblanding erstattes af evidensvægt pr. rytter (Bühlmann, Z = n/(n+12))?**
👍 **Anbefaling: ja.** Det afviger fra beslutning 1 og fjerner beslutning 3 helt. Prisen ved at afvise: hvert trin skal så godkendes på en måling der skifter fortegn afhængigt af om man ser på 21 eller 30 dage (§3.3). Prisen ved at acceptere: værdierne rykker sig næsten ikke i starten, og det skal kommunikeres til spillerne som det det er, nemlig ærlighed om at der ikke er data endnu.

**4. Skal lønnens grundlag være Ankerværdien i stedet for den viste Værdi?**
👍 **Anbefaling: ja, klart.** Det er billigt, det bevarer beslutning 4 ordret, og det fjerner den præcise usikkerhed der holdt #3393 i draft. Uden det kan et marked med 23 handler omskrive alle 199 holds lønbudget.

**5. Skal `anchorSalary` kalibreres ved hver sæsonovergang mod målt indtægt, med ét globalt A eller ét pr. division?**
👍 **Anbefaling: ét globalt A, kalibreret hver sæson mod 35 % af målt indtægt.** Ét A pr. division ville bryde beslutning 4 (lønnen ville afhænge af hvem der spørger). Spredningen mellem D2 44,5 %, D3 15,9 % og D4 55,4 % løses derfor på indtægtssiden, ikke på lønsiden. Se beslutning 6.

**6. Skal D4's indtægt løftes før #3393 mergeres?**
👍 **Anbefaling: ja.** 55 menneskehold i D4 har 138.720 CZ$ pr. 28 dage mod D3's 536.221. #3393 ville lægge 55,4 % af den indtægt i løn. Det er ikke en straf for styrke, det er en straf for at være ny, og det rammer præcis de spillere der lige er kommet ind. Dette er den eneste beslutning her jeg vil kalde blokerende for #3393.

**7. Skal tidsbaseret transferskat bygges nu, eller først hvis drænet falder?**
👍 **Anbefaling: først hvis drænet falder under 40 % (§5.3c).** Det er det element i designet der ligger tættest på doktringrænsen (§5.8), og der er ingen målt grund til at bygge det endnu. Byg måleren, ikke skatten.

---

## 8. Hvad vi ikke ved

Ærligt. Det her bør måles før noget af ovenstående bygges.

| # | Hvad vi ikke ved | Hvorfor det betyder noget | Hvordan det måles |
|---|---|---|---|
| 1 | **Hvor meget startkapital der er udstedt.** Ledgeren dækker 22/6 og frem og forklarer kun -2,37 mio. af de 126,9 mio. i kontanter | Uden det ved vi ikke om økonomien er sund eller bare stor. Hele Gate 1-diskussionen hviler på et tal vi ikke kan gøre rede for | Sum af startsaldi ved holdoprettelse, eller `admin_adjustment` før 22/6 |
| 2 | **Betalingsvilje over modelværdi.** Aldrig observeret, fordi det er forbudt i kode | Det er hele grundlaget for "fully dynamic". Vi ved bogstaveligt talt ikke om nogen ville betale mere | Fjern loftet (beslutning 1), mål i 28 dage |
| 3 | **Om bankreservens elasticitet.** Hvad sker der med drænet ved reserve 25 % mod 50 % mod 100 %? | Det er 53,3 % af alle dræn der står på spil | A/B på et delsæt af bankauktioner, eller trinvis sænkning med måling |
| 4 | **Om de 23 handler er lav likviditet eller lav interesse.** 64,5 % af auktioner fik aldrig et bud | Hvis det er interesse, hjælper mere kontant ikke | Spørg spillerne. Krydstjek mod aktive sessioner pr. hold |
| 5 | **Hvad tvangssalgs-kreditten summer til.** `economyEngine.js:814` printer `market_value` | Det er en pengekilde ingen har opgjort | Sum `finance_transactions` hvor type = `forced_debt_sale` |
| 6 | **Om facilitets-upkeep er tilbagevendende.** Kun én dato i ledgeren (26/7) | Afgør om faciliteter er et engangs- eller løbende dræn | Følg til næste sæsonovergang |
| 7 | **v4's egen præcision mod simuleringen.** Jeg har ikke genkørt `riderValuationFitV4.js` | Ankerværdien bærer hele designet i §5.1. Vi har ikke efterprøvet ankeret selv | Kør fit-harnessen, sammenlign mod frisk sim-output |
| 8 | **Markedsmodellens absolutte niveau.** To reproduktioner gav aggregeret forhold 5,00 og 2,93 | Retningen i §3.4 er robust, størrelsen er det ikke | Kør `fitMarketValueModelV1.js` selv i stedet for at reproducere i SQL |

---

## 9. Kilder

**Prod-målinger 14/8, read-only** (Supabase `ghwvkxzhsbbltzfnuhhz`): `teams`, `riders`, `auctions`, `finance_transactions`, `information_schema`.

**Kode:** `backend/lib/auctionRules.js:96-113` (pris-gates) · `backend/lib/economyConstants.js:28,51,100,221` (sponsor, upkeep, gældsloft, lønfrysning) · `backend/lib/economyEngine.js:795-830` (tvangssalgs-kredit) · `backend/lib/seasonTransition.js` (fase-rækkefølge) · `backend/lib/salaryBasis.js` (`calibrateAnchorSalary`) · `backend/scripts/marketValueModelV1.draft.json` (koefficienter, støtte-guard, ugeloft).

**Eksterne:** [Hattrick Transfers](https://wiki.hattrick.org/wiki/Transfers) · [Hattrick Transfer compare](https://wiki.hattrick.org/wiki/Transfer_compare) · [Hattrick Roadmap 2021](https://wiki.hattrick.org/wiki/Roadmap_2021:_Chat,_Mobile,_Achievements,_Economy) · [FIFA playervalues.ini](https://github.com/xAranaktu/FIFA-18---iniToCT/blob/master/ORG_INIFILES/playervalues.ini) · [FIFA Live Editor FAQ](https://github.com/xAranaktu/FIFA-20-Live-Editor/wiki/Frequently-asked-questions) · [FanGraphs, $/WAR 2026](https://blogs.fangraphs.com/what-are-teams-paying-for-a-win-in-free-agency-2026-edition/) · [UO Economics, Simpson](https://dergigi.com/assets/files/UO-Economics.pdf) · [RuneScape High Level Alchemy](https://runescape.wiki/w/High_Level_Alchemy) · [Loss Data Analytics kap. 9, kredibilitet](https://openacttexts.github.io/Loss-Data-Analytics/ChapCredibility.html) · [Bühlmann Credibility, SMU](http://www.mysmu.edu/faculty/yktse/NAM/NAM_S7.pdf) · UCI Cycling Regulations Part 2 art. 2.15.120 og 2.15.123a (udgave E0425).
