# #5267 prøvepakning: kan alle fire divisioner få lige mange løbsdage uden at ødelægge noget?

> Read-only dry-run (`buildTierMaterializationPlan`) mod prod-kataloget for
> sæson 4: 28 løbsdatoer, første løbsdag 28/9. Intet er skrevet til prod, intet `--apply`.
> Løbsnavne er udeladt — repoet er offentligt — så løbene hedder A, B, C … i den rækkefølge
> de optræder, præcis som i 18/9-rapporten. Hele prøvekalenderen ligger maskinlæsbart i
> [`2026-09-19-5267-proevepakning/`](2026-09-19-5267-proevepakning/) (`d1.json` … `d4.json`).
>
> **HISTORIK, IKKE GÆLDENDE (opdateret 20/9).** Denne rapport måler "måde A" (træningsdage
> kun i hullerne) og forsøget med synkroniserede etapeløbs-blokke (R13). Ejeren valgte 20/9
> den jævne fordeling i stedet, og **begge veje er fjernet fra koden** — tallene her kan
> derfor ikke genskabes med den nuværende `proevepakning5267.mjs`, og JSON-filerne i
> `2026-09-19-5267-proevepakning/` er skrevet af en tidligere udgave af værktøjet (deres
> nøgler matcher ikke det scriptet skriver i dag). De bliver stående som det målte grundlag
> for valget. Den gældende kalender: [`-jaevn.md`](2026-09-19-5267-proevepakning-jaevn.md).

## 0. Kort svar

**Ja på det første, nej på det andet.**

1. **Alle fire divisioner kan få 140 løbsdage, og det koster ingenting.** Ingen gate går rød.
   Løbene, etaperne og overlappet er nøjagtig som før — inklusive Division 4's tre etaper
   pr. rigtig dag. Det er 18/9-rapportens punkt 1-3 og 5, og det virker.
2. **Etapeløbene kan IKKE synkroniseres i blokke.** Det var forslaget der skulle give en
   jævn træningsrytme, og det er målt strukturelt umuligt i tre af fire divisioner. Prøver
   man alligevel, falder overlappet under gulvet i Division 3 og 4. Prøvepakningen holder
   derfor nedfaldsplanen: naturlig pakning, træningsdage i hullerne.

Prisen står i punkt 2: træningsdagene ligger i få, store klumper. Division 3 har **23
kalenderdatoer i træk uden en eneste træningsdag**. Det er et spørgsmål til dig, ikke en
teknisk detalje — §4.

## 1. Hvad der blev lavet om

Før i dag var "lige mange løbsdage" bygget som en **regel inde i selve pakningen**: så snart
der var sat et mål, gik pakkeren i gang med at lede efter en HELT ny placering af alle løb,
for at skaffe plads til de tomme løbsdage. Det var roden til alt det der gik galt 18/9 —
overlappet faldt i alle fire divisioner, fordi løbene blev spredt tyndt ud.

Nu gør den to ting efter hinanden i stedet:

1. **Find den naturlige pakning.** Præcis den pakning spillet har kørt med siden #4236.
   Ingen ændring, ingen ny søgning.
2. **Læg træningsdagene i hullerne.** En tom løbsdag lægges kun dér hvor intet løb er i
   gang. Den arver kalenderdatoen fra den løbsdag den lægges foran, så antallet af etaper
   den dato er uændret.

Det betyder at målet **pr. konstruktion ikke kan flytte et løb**. Der er en test der siger
netop det: løbenes indbyrdes placering skal være identisk med og uden mål.

## 2. Resultatet pr. division (mål 140)

| | D1 | D2 | D3 | D4 |
|---|--:|--:|--:|--:|
| Løbsdage i alt | **140** | **140** | **140** | **140** |
| … heraf med løb | 80 | 56 | 56 | 56 |
| … heraf rene træningsdage | 60 | 84 | 84 | 84 |
| Løbsdage med mindst 2 løb | 56,3 % | 78,6 % | 50,0 % | 50,0 % |
| … gulvet (§1/#3329) | 45 % | 55 % | 40 % | 40 % |
| Etaper pr. kalenderdato (min–maks) | 5–5 | 4–4 | 3–3 | 3–3 |
| … kravet (TIER_DENSITY) | 5 | 4 | 3 | 3 |
| Længste stime uden en træningsdag | 16 | 11 | **23** | 11 |
| Etapeløbs-blokke | 3 | 4 | 3 | 8 |
| … heraf med mere end ét løb | 3 | 3 | 0 | 0 |
| Frie positioner på aksen | 4 | 5 | 5 | 10 |

### Alle gates, kørt med kalender-scorecardet

| Gate | D1 | D2 | D3 | D4 |
|---|:-:|:-:|:-:|:-:|
| §1b kvote eksakt 100 % | 🟢 | 🟢 | 🟢 | 🟢 |
| §1 mindste-overlap (#3329) | 🟢 | 🟢 | 🟢 | 🟢 |
| §1 overlap-cap (aldrig over) | 🟢 | 🟢 | 🟢 | 🟢 |
| §1d lige mange løbsdage (#4845) | 🟢 | 🟢 | 🟢 | 🟢 |
| §1e træningsrytme (#5267) | 🟢 | 🟢 | 🟢 | 🟢 |
| §2 løb hver kalenderdag | 🟢 | 🟢 | 🟢 | 🟢 |
| §3 plan-invarianter (GT-rygrad, whitelist, dedup) | 🟢 | 🟢 | 🟢 | 🟢 |
| §4 monument ikke i Grand Tours løbsdags-spænd (#4203) | 🟢 | — | — | — |
| §4 monument-afstand + spredning | 🟢 | — | — | — |
| §3 Grand Tours deler aldrig kalenderdato (#3472) | 🟢 | — | — | — |
| #4270 etaper pr. rigtig dag | 🟢 | 🟢 | 🟢 | 🟢 |
| Navnekollisioner | 🟢 | 🟢 | 🟢 | 🟢 |

D2-D4 har ingen monumenter og ingen Grand Tours — de gates findes ikke for dem.
§1e er grøn fordi loftet er sat efter den målte virkelighed; se §4 for hvad tallet betyder.

> **Det prøvepakningen IKKE har målt:** terræn-dækning (§5), komposition (§6/§6b), finale-bånd
> (§7b) og etaperækkefølge (§7). De regler måles på etape-PROFILER, og profiler findes kun i
> databasen — ikke i den katalog-fixture prøvepakningen kører mod. De er derfor hverken
> grønne eller røde her, de er **uvurderede**. Det er ikke et problem for konklusionen:
> ingen af dem afhænger af hvor på løbsdags-aksen et løb ligger, og prøvepakningen flytter
> pr. konstruktion ikke et eneste løb. Men de skal køres i det rigtige dry-run mod prod
> (`node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt`)
> før nogen bygger S4-kalenderen.

**Dette er identisk med kalenderens tal UDEN målet.** Det er hele pointen: overlap, etaper
pr. dato og løbenes placering er de samme tal som den naturlige pakning giver. Målet
tilføjer kun træningsdage.

## 3. Hvorfor synkroniserede etapeløbs-blokke ikke kan lade sig gøre

Forslaget fra 18/9: lad to etapeløb der kører samtidig starte OG slutte på de samme
løbsdage, i stedet for at kæde sig (løb A's sidste etape = løb B's første). Det ville give
huller til træningsdage, og hver løbsdag i blokken ville bære to løb at vælge imellem.

Det er bygget og målt. **Det virker kun i Division 2.**

| | Blokke i alt | … med 2 løb | Løbsdage med ≥2 løb | Gulv | Dom |
|---|--:|--:|--:|--:|---|
| D1 | — | — | — | 45 % | 🔴 ingen lovlig pakning fundet (2.000.104 søgeskridt brugt) |
| D2 | 10 | 6 | 75,9 % | 55 % | 🟢 holder — og stimen uden træning falder fra 11 til **3** datoer |
| D3 | 14 | 0 | **27,3 %** | 40 % | 🔴 mindste-overlap brækker |
| D4 | 15 | 0 | **35,5 %** | 40 % | 🔴 mindste-overlap brækker |

### Årsagen er aritmetik, ikke et søgebudget

Kør to etapeløb samtidig, og hver løbsdag i blokken bærer to etaper. Løbsdagene ligger i
træk (ejer-reglen 25/8), og hver kalenderdato skal have præcis sit antal etaper. En
kalenderdato der ligger helt inde i blokken skal derfor kunne deles op i hele blok-løbsdage:

> **antallet af samtidige etapeløb skal gå op i divisionens antal etaper pr. dag.**

| Division | Etaper pr. dag | Maks samtidige løb | Blokstørrelser der går op | Mulig? |
|---|--:|--:|---|---|
| D1 | 5 | 3 | 1 eller 5 | nej — 5 er over loftet |
| D2 | 4 | 3 | 1 eller 2 | **ja, 2** |
| D3 | 3 | 2 | 1 eller 3 | nej — 3 er over loftet |
| D4 | 3 | 2 | 1 eller 3 | nej — 3 er over loftet |

Kun D2's kombination (4 etaper om dagen, op til 3 samtidige løb) tillader en ægte blok. I de
tre andre kan et etapeløb kun køre alene — og når det ikke længere må kæde sig til det
næste, bliver halvdelen af løbsdagene til løbsdage med ét løb. Det er præcis det målte fald
til 27,3 % og 35,5 %.

Det kan ikke løses med et større søgebudget, et andet katalog eller en anden rækkefølge. Det
kan kun løses ved at ændre et af de to låste tal (etaper pr. dag eller maks samtidige løb),
og begge er ejer-beslutninger: #4270 (3/9, bekræftet 19/9) og overlap-cap'en (28/6).

**Derfor blev synkroniseringen slået FRA** (19/9), og **fjernet helt 20/9** da ejeren valgte
den jævne fordeling: koden findes ikke længere, heller ikke bag et flag. Det der står her, er
målingen der begrundede valget.

## 4. Det du skal tage stilling til: træningsrytmen

Kalenderen er rigtig. Rytmen er ikke god.

Træningsdagene kan kun ligge dér hvor intet løb er i gang, og i dagens kalender er der meget
få sådanne punkter, fordi etapeløbene kæder sig sammen. Her er hvor de 140 løbsdage landede
(kalenderdato 0 = 28/9, dato 27 = sidste løbsdag):

| Division | Datoer med træningsdage | Længste stime uden |
|---|---|--:|
| D1 | 0, 6, 10, 27 | 16 |
| D2 | 0, 12, 15, 18, 27 | 11 |
| D3 | 0, 24, 26, 27 | **23** |
| D4 | 0, 12, 14, 16, 18, 20, 22, 24, 27 | 11 |

En D3-spiller træner altså på sæsonens første dag, og så ikke igen før tre en halv uge
senere. D4 er til gengæld fin — den har flest huller, fordi den har flest korte etapeløb.

Tre veje, og valget er dit:

**A) Behold det som det er.** Kalenderen er korrekt og alle gates er grønne. Rytmen er
ujævn, men træningen er der — 84 træningsdage i D3, bare samlet i fire klumper.
*Fordel:* ingen risiko, klar til mandag. *Ulempe:* D3 føles tom i midten af sæsonen.

**B) Giv Division 3 og 4 én samtidig løbsdag mere (overlap-cap 2 → 3).** Så går blokke af 3
op i de 3 etaper om dagen, og synkroniseringen bliver mulig — det er den eneste ændring der
åbner den. *Fordel:* rytmen bliver jævn (D2's tal faldt fra 11 til 3 datoer).
*Ulempe:* tre samtidige løb i de laveste divisioner er en mærkbar ændring af hvor meget
manageren skal vælge imellem, og cap'en har været låst siden 28/6.

**C) Lad kalenderen være, og gør træningen mindre afhængig af rytmen.** Træningen behøver
ikke bruge sine ticks i samme øjeblik de falder. *Fordel:* rører ikke kalenderen fire dage
før sæsonskiftet. *Ulempe:* flytter problemet til trænings-systemet, som ikke er bygget til
det endnu.

**Min anbefaling: A nu, og beslut B eller C bagefter.** Kalenderen skal være synlig for
managers senest mandag, og A er den eneste af de tre der er færdig og verificeret i dag.
Rytmen kan rettes i sæson 5 uden at røre S4's resultater.

## 5. Metode

- `buildTierMaterializationPlan` mod den committede prod-katalog-fixture
  (`backend/lib/__fixtures__/racePoolCatalog.prod.json`), 28 kalenderdatoer, første løbsdag
  28/9, kvoter efter §1b (etaper pr. dag × løbsdatoer). Én repræsentativ pulje pr. division;
  alle puljer i en division er ens (#2276).
- Tallene for den naturlige pakning er identiske med 18/9-rapportens, som blev målt direkte
  mod prod. Det er kontrollen på at fixturen og prod siger det samme.
- Overlap måles som andelen af løbsdage MED løb der bærer mindst to forskellige løb.
- Frie positioner: position p er fri når intet løb spænder henover den.
- Stimen uden træningsdag måles på kalenderdatoer, ikke på løbsdage. Stimer i begge ender af
  sæsonen tæller med.
- Gatene er kørt med det rigtige kalender-scorecard (`scoreCalendarPlan`), samme kode som
  CI og `buildSeasonCalendar.js` bruger — ikke med en håndskrevet tælling.
- Ingen `--apply`, ingen skrivning, ingen migration. PR #5169 er ikke merget.

## 6. Dom

**bekræftet på lige mange løbsdage · afvist på synkroniserede blokke · åbent spørgsmål om
træningsrytmen**
