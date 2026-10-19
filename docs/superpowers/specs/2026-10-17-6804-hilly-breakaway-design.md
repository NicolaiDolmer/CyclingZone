# #6804 Kuperede udbrudssejre: design (S5, bag s5_profiles_v2)

Status: design, intet bygget. Refs #6804 #6748 (punkt 3) #6156.
Hard rule 17: ingen vaegte, taerskler eller maalte andele i denne fil. Baseline og
kalibrering ligger privat i `balance-internals/6804/`.
Hard rule 36: baseline er maalt (s5MotorBench, scope all, s5_profiles_v1) foer foerste PR.

## 1. Problem

Ejerens definition: kuperet = bakker; lange stigninger = bjerg. Paa kuperede etaper
(bakke-, mur- og stigende-spurt-afslutninger, og flad spurt efter bakker) uden for
Grand Tours vinder morgenudbruddet langt sjaeldnere end i virkeligheden. I virkeligheden
er en kuperet etape i et etapeloeb eller et kuperet endagsloeb en klassisk udbrudsdag.

Maalt baseline (tal privat): problemet er bekraeftet og er staerkest i etapeloeb.
Moenstret:

- Kuperet profil med nedkoerselsafslutning: udbruddet vinder ofte (i endagsloeb meget
  ofte).
- Kuperet profil med bakke-, mur-, stigende- eller flad spurt-afslutning: udbruddet
  vinder naesten aldrig, og i etapeloeb uden for GT praktisk talt aldrig.
- Rullende profil: udbruddet vinder aldrig (jagt-gulvet paa aabent terraen).
- Brosten/klassiker: udbruddet vinder aldrig (uden for scope, noteret).
- Udbruddet dannes altid; det hentes typisk sent (inden for finalens sidste del), dvs.
  feltet koerer det jaevnt ind over hele dagen, ikke i et sent sammenbrud.

## 2. Rod-aarsag (motoren, read-only gennemgang)

1. **Terraen-mapping: "udbrudsdagen" findes ikke laengere i S5.** Foer S5 kunne en
   kuperet etape vaere maerket med finaletypen `breakaway`, som gav lav jagt-interesse
   og en egen flugt-finale (`finale.ts` `fieldFinaleTypeBehindBreakaway`). S5's
   taksonomi har bevidst fjernet `breakaway` som afslutning (`stageProfileTypes.js`:
   "udbrud er motoradfaerd", #6368), og `s5Profiles.ts` omdoeber en gammel
   `breakaway`-dag til terraenets finale. Den motoradfaerd der skulle erstatte den
   (#6368, `lateAttack.ts`) er det sene soloangreb fra feltet, ikke et morgenudbrud
   der holder. Resultat: enhver kuperet S5-dag jages som om afslutningen med sikkerhed
   tilfalder feltets bedste finisher.

2. **Jagt-modellen (official_times_v3-grenen, `stageWinChaseForceV3`) er terraen-blind.**
   Etapeinteressen er jagtgruppens bedste ryttere paa afslutningens evne gange
   afslutningens vaegt. Paa kuperet terraen med en spurt-afslutning bruges samme
   vaegt som paa en flad massespurt, og ved bakke/mur samme vaegt som en ren
   punch-finale. Feltet rummer altid gode spurtere og puncheurs, saa interessen er
   naesten altid positiv og stor. Der er intet led for at:
   - det koster mere at jage over bakker (laeet er mindre, spurternes hold
     traettes, og spurterne selv er i tvivl om de overlever bakkerne),
   - ingen enkelt holds interesse paa en kuperet dag er stor nok til at kontrollere
     hele dagen alene (i virkeligheden venter holdene paa hinanden).

3. **Lukningen er lineaer over hele jagt-strækningen, uden daempning paa kuperet.**
   Under official_times_v3 er kuperet bevidst sat til at jage uden daempning foer
   finalen (bjerg og hoejfjeld beholder den kontrollerede jagt). Naar netto-fordelen er
   positiv, lukkes hullet med en fast rate pr. km over resten af etapen; et langt
   jagt-stykke henter derfor ethvert realistisk forspring. Udfaldet er et knivsaeg paa
   fortegnet af netto-fordelen, praecis den fejl #5813 fjernede paa flad/rullende med
   jagt-gulvets eksplicitte "feltet kommer for sent"-lodtraekning. Kuperet har hverken
   gulvet eller en tilsvarende eksplicit chance.

4. **Etapeloeb laegger klassements-jagt oveni.** I etapeloeb tilfoejer GC-reaktionen
   (gcThreat, lad-gaa-bremsen og "jag" der bremser som en reaktion paa kuperet,
   #6457) jagt-kraft og lofter lad-gaa-fasen. Endagsloeb har den ikke, hvilket
   forklarer at forskellen er stoerst i etapeloeb.

5. **Finale-modellen** afgoer ikke problemet: udbruddet er typisk allerede hentet foer
   finalen. Den forstaerker det kun paa mur/bakke, hvor et lille restforspring
   aedes af puncheurs i finalen (det er realistisk og skal bevares).

## 3. Krav (kvalitative; maal og taerskler privat)

- K1 Paa kuperede etaper uden for GT vinder udbruddet inden for virkelighedens interval
  (privat anker), maalt pr. afslutning og separat for endagsloeb og etapeloeb.
- K2 Bjerg, hoejfjeld, flad og GT-etaper flytter sig ikke ud af deres nuvaerende
  benchmark-dom (gatens del 4 og vindertype-dommen staar uaendret).
- K3 Udbrudssejren er fortjent: udbruddets kollektive evne (flugt-evner) og antal skal
  stadig paavirke chancen monotont; et farligt udbrud (klassementstrussel) faar stadig
  mindre plads end et harmloest.
- K4 Holdordrer bevarer deres retning: "jag" kan kun oege jagten, "lad gaa" aldrig
  skabe et forspring alene (mor-spec §5).
- K5 Naar udbruddet hentes, afgoeres etapen fortsat af den rigtige ryttertype
  (puncheurs paa bakke/mur, spurtere paa stigende/flad spurt).
- K6 Skala-invariant (#4707) og deterministisk pr. seed. Alt bag `s5_profiles_v2`;
  `s5_profiles_v1` er bit-identisk.

## 4. Mulighed A: "Udbrudsdag" som eksplicit lodtraekning (jagt-gulv for kuperet)

Udvid jagt-gulvets mekanik (#5813) til kuperet profil under s5_profiles_v2: i etapens
sidste del overtager feltet jagten og koerer hullet ned mod et maal ved stregen; med en
eksplicit, privat kalibreret chance pr. afslutning (og pr. endags-/etapeloeb) kommer
feltet for sent, og et udbrud med et reelt forspring holder. Foer gulvet daempes den
lineaere jagt paa kuperet (som bjergets kontrollerede jagt), saa hullet lever til
gulvet tager over.

- Fordele: lille diff, genbruger en kendt og testet mekanik; andelen bliver direkte
  maalbar og styrbar; ingen knivsaeg.
- Ulemper: sejren afhaenger mest af en lodtraekning, mindre af hvem der sidder i
  udbruddet og hvordan holdene jager (svagere K3); "gulvet" er strukturelt og ikke
  fysisk, og et udbrud af svage ryttere kan holde lige saa ofte som et staerkt.

## 5. Mulighed B: Terraen-bevidst jagt-interesse og jagt-omkostning (anbefalet)

Goer jagt-modellen terraen-bevidst under s5_profiles_v2:

1. **Etapeinteressen afhaenger af terraen + afslutning.** En spurt- eller
   bakkeafslutning paa kuperet profil vaegtes lavere end samme afslutning paa flad
   profil (feltets favorit er mindre sikker paa at vinde, og holdene ved det).
2. **Jagt-omkostningen paa bakker.** Jagtens lukning pr. km skaleres med terraenet
   (op ad bakke lukker et felt mindre pr. indsats end paa flad), og de hold der jager
   betaler mere traethed for det (genbrug `applyChaseCost`), saa en hel dags jagt paa
   kuperet koster spurternes/puncheurernes hold noget i finalen.
3. **Kollektiv tilbageholdenhed.** Interessen fordeles pr. hold (den findes allerede i
   `interestByTeam`); paa kuperet terraen kraeves at flere hold deler jagten foer den
   virker fuldt, saa en dag hvor kun et hold har interesse ikke kontrolleres hele vejen.
4. **Daempet jagt foer finalen paa kuperet** (samme knap som bjerg), saa lukningen
   koncentreres i finalen og ikke er lineaer over hele dagen.
5. Etapeloebets klassements-jagt bevares, men "jag bremser som reaktion" paa kuperet
   (#6457) gaelder kun ved en reel klassementstrussel i udbruddet, ikke ved et harmloest
   udbrud.

- Fordele: udfaldet afhaenger af hvem der sidder i udbruddet, hvor mange hold der vil
  jage og terraenet (staerk K3/K4); laver ingen lodtraekning; giver rige loebsfilm
  ("feltet tøvede").
- Ulemper: stoerre diff, flere knapper at kalibrere; risiko for at knivsaegget blot
  flytter sig. Derfor kraever B en eksplicit sikkerhedsventil: hvis kalibreringen ikke
  kan naa K1 uden at bryde K2, kombineres B med A's lodtraekning paa en lille, privat
  restandel.

## 6. Anbefaling

**B**, med A's lodtraekning som reserve-ventil. Rod-aarsagen er at kuperede dage jages
som flade/rene finaler over hele dagen; B retter det i jagt-modellen hvor fejlen sidder,
og holder sejren fortjent (K3). Rullende og brosten roeres ikke i denne PR (egen
maaling, eget issue), da rullende bevidst ligger under jagt-gulvet.

## 7. Testporte (skal bestaas foer PR er klar)

1. `s5MotorBench --scope=all` under s5_profiles_v2: udbrudsandel pr. kuperet afslutning
   og pr. endags-/etapeloeb inden for det private anker (K1). Tal i balance-internals/6804/.
2. Samme bench: gatens del 4 og vindertype-dommen uaendret for alle afslutninger (K2);
   fixturen `s5MotorBench.json` gaelder fortsat for v1.
3. Bit-identitet: alle eksisterende motortests under s5_profiles_v1 groenne uden
   fixture-aendringer (K6).
4. Kontrakt-tests: monotoni i udbruddets flugt-evne og antal; "jag" oeger, "lad gaa"
   skaber aldrig forspring; skala-invarians (K3, K4, K6).
5. tourDryRun paa kommende kuperede S5-loeb (read-only): vindertyper efter indhentning
   som foer (K5), og ingen klassementsfoerer skabt af et udbrud etape efter etape.
6. Sammenligning mod gammel motor og virkelighed (ejer 8/10): udvalgte kuperede
   etapeloebs-etaper og endagsloeb gennemgaaet med ejeren foer flagget overvejes.

## 8. Filer (forventet, ingen bygget)

- `backend/lib/engine/v4/mechanics/breakaway.ts` (jagt-interesse, lukning, gulv-reserve)
- `backend/lib/engine/v4/tuning.ts` (nye knapper bag s5_profiles_v2, kommentarer uden tal)
- `backend/lib/engine/v4/mechanics/timeModel.ts` (evt. daempning pr. profil)
- tests ved siden af + `backend/scripts/dev/s5MotorBench.mjs` (`--revision` til v2)

## 9. Risiko

Motor-aendring bag slukket revision (s5_profiles_v2), saa ingen spillerpaavirkning foer
ejer-go paa taending. Stoerste risiko: GT-kuperede etaper og bjerg flytter sig (K2), og
at sejren skifter fra fortjent til tilfaeldig. Begge dækkes af testport 1-2 og 4.

## Åbne review-fund (Codex 19/10), løses i bygge-PR'en før første motorændring

- **P2 Account for one-day reactions in the root cause:** Under the S5/v3 lineage, `gcReactionSetup` explicitly handles `gcContext.status === "one_day"`, selects a `oneDayProtectedRider`, and can feed a `winner_ahead` reaction into the same chase signal used by `stageWinChaseForceV3`. Therefore one-day races do have this additional reaction path, so its alleged absence cannot explain the measured stage-race split; compare the actual one-day and standings signals before basing the design on this distinction.
- **P2 Define a change beyond the existing threat guard:** This proposed step already describes current behavior: `letGoBrakingTeams` rejects a chase-order brake when threat severity is `none`, and the existing #6457 test explicitly verifies that an otherwise identical harmless breakaway is not braked. Unless “reel klassementstrussel” is given a narrower, testable definition, implementing this item is a no-op and cannot address the measured regression.
- **P2 Cite the race-engine SSOT:** This is a new race-engine/tactics design, but its metadata cites only issues and never explicitly cites `docs/RACE_ENGINE_RULES.md`. The repository contract says every new design document in this area must cite that SSOT and is not approved for build without it, so add the canonical reference and clarify that the implementation PR will update the rule there.
- **P2 Record the required local-PG17 baseline:** The stated baseline is `s5MotorBench`, whose own header documents that it runs offline with no database, so this line does not demonstrate the local-PG17 baseline required before the first motor PR. Record a read-only local-PG17 measurement (without publishing protected balance values) before treating hard rule 36 as satisfied.
- **P2 Declare the verification tier:** Although this section lists useful test gates, it never assigns the explicit test tier required as part of the design, so the implementation has no authoritative answer about which preflight/e2e suite is mandatory. Add the tier to this verification plan before marking the design ready to build.
