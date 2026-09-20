# Sæsonskiftet 27-28/9: ærligt overblik pr. område

**Dato:** 19/9 2026 · **Type:** read-only gennemgang. Intet bygget, intet merget, ingen prod-skrivning.
**Formål (ejeren, ordret 19/9):** *"Jeg har brug for, at være mere indover de næste 10 ting der produceres, for at vide at vi rent faktisk vælger de rigtige ting og den rigtige rækkefølge i forhold til det sæsonskifte der snart sker."*

**Dette dokument anbefaler ikke en top 10.** Det stiller kortene op, så du kan vælge selv.

**Tidsregnskab:** i dag er 19/9. Skiftet er 27-28/9. Det er **8 dage**, heraf 2 weekender.
S3 har 9 løbsdage tilbage (22 af 31 kørt, målt 19/9).

**Kilder:** GitHub (issues + PR'er, læst 19/9 eftermiddag), `docs/MASTERPLAN.md`, `docs/NOW.md`,
`docs/CALENDAR_RULES.md` §2c/§2d, `docs/TRAINING_RULES.md` §13.3,
`docs/audits/2026-09-19-5405-s4-kalender-synlig.md`, specs fra september,
`docs/FEATURE_REGISTRY.yml`. Flag-tilstande nedenfor er **registrets tal**, ikke aflæst i prod.

---

## Tabel: alle 14 områder

| # | Område | Status i dag | Skal være klar 27/9? | Mangler dig? | Omfang (skøn) |
|---|---|---|---|---|---|
| 1 | S4-kalenderen genereret og synlig | Bygget, ikke kørt | **Ja** (frist 21/9) | **Ja** — go pr. kørsel | S |
| 2 | Kalenderens kvalitet (bjergdage, katalog) | Kører | Nej | **Ja** — godkend nye løb | M |
| 3 | Træningsdagenes form og tal (A/B) | Kører, ikke merget | **Ja** | **Ja** — afstemning + tal | M |
| 4 | Træning pr. løbsdag live (B4/B3/flag) | Bygget, skal rettes | **Ja** (ejer-løfte 28/9) | Nej | M |
| 5 | Resten af træningen (program 7×5, skader, D1-D3, Åbnere) | Ikke startet | Nej | **Ja** — A/B på Åbnere | L |
| 6 | U23/junior-ryttere (generator + population) | Delvist bygget | **Ja, hvis U23 med** | **Ja** — skal U23 med? | L |
| 7 | U23/junior-kalender og trup-flader | Ikke startet | **Ja, hvis U23 med** | **Ja** — samme valg | L |
| 8 | Graduation Day | Ikke startet | **Ja** (frist var 20/9) | **Ja** — udskyd eller byg | M |
| 9 | Inaktive managers: parkering + tilmelding | Delvist bygget | **Ja** | **Ja** — godkend listen | M |
| 10 | Mandatet-flip | Bygget, 2 ting mangler | Nej, men bedst nu | **Ja** — flip-go | S |
| 11 | Race engine v4-flip | Ikke klar | Nej | Nej (først senere) | L |
| 12 | Mail til managers inden sæsonslut | Bygget, tekst mangler | **Ja** (send inden 24/9) | **Ja** — tekst + send-go | S |
| 13 | Quad9: spillere låst helt ude | **Brand**, måling kører | **Ja** | **Ja** — DNS-test + valg | M |
| 14 | Selve cutover-kørslen + drejebogen | Ikke startet | **Ja** | **Ja** — du klikker | M |

**Kan ikke undværes:** 1, 3, 4, 9, 12, 13, 14.
**Kan lande efter skiftet uden skade:** 2, 5, 11 — og 6+7+8 hvis du beslutter at U23 venter til S5.

---

## 1. S4-kalenderen genereret og synlig for managers

**Hvad det er.** Sæson 4's løbsprogram skal ligge i databasen og kunne ses på kalendersiden, så managers kan kigge på den og sige til, før sæsonen går i gang.

**Status i dag: bygget, men ikke kørt.** Alle tekniske forhindringer er væk i dag:
- Undersøgelsen er merget (#5406) og siger: sæson-vælgeren på kalendersiden virker allerede for en sæson med status `upcoming`, og ingen baggrundsmotor rører den. Der kræves nul frontend-arbejde for at vise den.
- Hullet hvor en manager kunne gemme holdudtagelse i næste sæsons løb er lukket (PR #5407, merget 19/9).
- Kalenderen siger nu ærligt "din division afgøres ved sæsonskiftet" i stedet for at markere de forkerte løb som dine (PR #5408, merget 19/9).
- Reglen om regenerering er ændret efter dit svar 19/9 og er nu håndhævet i kode: S4 må laves om, så længe sæsonen ikke er aktiv (PR #5409, CALENDAR_RULES §2c).
- Tørkørslen mod prod har **0 blokerende fund** (målt 19/9 eftermiddag, uden `--uniform-tilt`).

**Det der mangler er én kørsel.** Sæson 4-rækken findes ikke i databasen endnu (målt 19/9).

**Mangler:**
1. Dit go til at køre `--apply` (CALENDAR_RULES §2d: golden diff → tørkørsel → apply, eget go pr. kørsel).
2. Et valg af løbsdags-tallet, fordi `--race-days` er et argument til kørslen (se område 3).
3. Post-verifikation efter kørslen.
4. Rettelse af §2d's kommando-eksempel, der stadig nævner `--uniform-tilt` og gav falske alarmer i formiddags.

**Hvis det ikke er klar til 27/9:** spillet går ikke i stykker — kalenderen bliver bare genereret ved selve skiftet, som den plejer. Men tre ting sker: (a) dit eget krav om at se den senest mandag 21/9 falder, (b) managers kan ikke reagere før skiftet, og (c) **bestyrelsens årsmøde er tavst dødt lige nu**: uden en S4-række springer mandat-motoren alle hold over uden at fejle højlydt, og ved skiftet ville 237 hold stå med et afsluttet mandat og intet nyt (#4838).

**Hvem gør hvad:** ejer-beslutning (løbsdags-tallet) → ejer-handling (go pr. kørsel) → byggearbejde er nul.
**Afhænger af:** område 3 (tallet). Intet andet.
**Omfang:** S (skøn) — under en halv dag, det er en kørsel og en efterkontrol.

---

## 2. Kalenderens kvalitet: bjergdage i D2/D3 og kataloget bag dem

**Hvad det er.** Hvor mange af sæsonens afgørende dage der bliver afgjort i bjergene. Målet er 12 % pr. division; D2 rammer 9,8 % og D3 7,1 %. Spilleren mærker det som en sæson hvor klatrerne får for få chancer.

**Status i dag: kører.** Undersøgelsen (PR #5412, åben) viser at D4 ikke er kilden, og at årsagen er en forsyningsgrænse i det klasse-bånd D2 og D3 deler: der findes simpelthen ikke nok bjergrige etapeløb i kataloget. Ét bytte kan bringe D3 i mål, men koster enkeltstarter, og begge divisioner samtidig er umuligt med dagens katalog.

Efter dit svar 19/9 (*"Kan vi lave en permanent og langsigtet forbedring her på nogen måde?"* og *"1 - Ja husk at tage udgangspunkt i virkeligheden"*) kører to spor lige nu: et udkast til 2-3 nye bjergrige etapeløb med virkelige forbilleder (PR #5414, udkast) og en forsynings-kontrol der advarer i CI når kataloget ikke kan opfylde et terræn-mål (PR #5413, udkast).

**Mangler:**
1. Du godkender de konkrete nye løb og deres navne, før noget lægges i kataloget.
2. Forsynings-kontrollen skal gøres færdig og merges.
3. En ny tørkørsel der viser om bjergandelen faktisk kom i mål.

**Hvis det ikke er klar til 27/9:** ingenting går i stykker. Bjergandelen er et kvalitetsmål, ikke en korrekthedsfejl, og gaten kan ikke blokere. S4 kan køre med 9,8/7,1 %, og nye katalog-løb kan lande til S5. **Men:** ny-genererer man S4 efter et katalog-tilskud, mens sæsonen stadig er `upcoming`, er det tilladt (§2c). Så der er faktisk en vej til at få det med, hvis sporene bliver færdige inden 27/9.

**Hvem gør hvad:** ejer-beslutning (godkend løb og navne) → byggearbejde.
**Afhænger af:** ingenting. Men den kan kun nå ind i S4, hvis område 1 endnu ikke er låst.
**Omfang:** M (skøn).

---

## 3. Træningsdagenes form og tallet: hvor mange løbsdage får hver division

**Hvad det er.** Hvor mange dage om året en rytter har, hvor han enten kører løb eller træner. Alle divisioner skal have lige mange, så en D4-manager ikke trænes langsommere end en D1-manager. Løbsdage uden løb er rene træningsdage.

**Status i dag: kører, og PR #5169 er ikke merget.** Historikken er lang, så her er hvor den står:
- Tallet **140 er låst** (ejer 15/9, TRAINING_RULES §13.3). Det spørgsmål er lukket.
- Din realisme-regel er låst 18/9: en løbsdag er én dato, ét løb ELLER træning, et etapeløb binder rytteren fra første til sidste etape, og alle divisioner får lige mange løbsdage.
- Prøvepakningen 19/9 viser at **lige mange løbsdage holder**: overlap 56/79/50/50 % mod gulvene 45/55/40/40, og D4 rammer præcis 3 etaper pr. dato som du besluttede 3/9.
- Skitsen med synkrone etapeløbs-blokke, som du 19/9 kaldte *"umiddelbart godt"*, er **strukturelt umulig** i D1, D3 og D4. Det er regnestykket, ikke en mangel: antallet af samtidige etapeløb går ikke op i divisionens etaper pr. dag. Koden findes bag et slukket flag.
- Det eneste åbne er **hvor træningsdagene lægges**: måde A (i hullerne, hvor der er plads) eller måde B (jævnt fordelt, 5 pr. dato). Begge er prøvepakket og grønne. Løbenes placering er identisk i A og B. Materialet til afstemningen ligger klar i `docs/audits/2026-09-19-kort/afstemning-*`.

**Mangler:**
1. Du poster afstemningen (A eller B) i Discord og aflæser svaret.
2. PR #5169 bygges færdig efter svaret og merges.
3. Udmeldingen om 1-99-skalaen, som du selv satte til senest 21/9.

**Hvis det ikke er klar til 27/9:** dette er den mest blokerende af alle. Løbsdags-aksen er argumentet `--race-days` i kalender-kørslen (område 1) OG deleren i træningsmotoren (område 4). Uden et valg kan S4-kalenderen ikke genereres i den nye form, og træningen kan ikke tændes. Alternativet er at S4 kører på gammel form med ulige løbsdage — teknisk fint, men det bryder løftet fra 6/9 og 15/9.

**Hvem gør hvad:** ejer-handling (post afstemningen, den er skrevet) → ejer-beslutning (aflæs svaret) → byggearbejde.
**Afhænger af:** ingenting. **Alt andet på kalender- og træningssiden afhænger af denne.**
**Omfang:** M (skøn) — afstemningen tager tid i kalenderen, ikke i kode.

---

## 4. Træning pr. løbsdag live: B4, B3 og flaget

**Hvad det er.** I dag trænes der én gang pr. kalenderdag, og manageren får 25 % ekstra for selv at klikke. Efter omlægningen trænes der pr. løbsdag, samlet efter dagens sidste løb, uden bonus for at klikke. Spilleren mærker: klikket betyder "kør nu" i stedet for "kør bedre", og træningsrapporten kommer om aftenen.

**Status i dag: fundamentet er merget, overbygningen skal rettes.**
- Fundamentet (#5205) er merget 15/9, bag flaget `training_tick_per_race_day`, som er **slukket**.
- **B4 (PR #5264) er åben og skal rettes før merge.** Gennemgangen 18/9 fandt tre brud mod din egen realisme-regel: en rytter på en hviledag i et etapeløb falder igennem til en almindelig træningsdag (regel 3), en rytter der kørte løb kan få træning oveni fordi detektionen hænger på et andet slukket flag (regel 2), og rene træningsdage giver slet intet tick (regel 4). PR'en har desuden konflikter mod main.
- **B3 (PR #5281) er åben og klar**, men merges bevidst samme dag som flaget tændes, fordi den fjerner bonussen fra formlen.

**Mangler:**
1. B4 rettes: bindingen skal læses fra `race_entry_days`, ikke fra dagens resultater.
2. B4's afhængighed af det andet slukkede flag fjernes.
3. Tick på rene træningsdage.
4. Flip-dagen: merge B3, tænd flaget, verificér.

**Hvis det ikke er klar til 27/9:** ingenting går i stykker, fordi alt ligger bag et slukket flag — men dit eget løfte falder. Ordret 6/9: *"skiftet til det nye træningssystem senest sker til sæson 4 starten"*. Og der er en pointe i timing: tændes det midt i en sæson, skifter træningens tempo for alle hold midtvejs. Ved et sæsonskifte er det en ren linje.

**Hvem gør hvad:** rent byggearbejde, indtil flip-dagen, hvor du giver go.
**Afhænger af:** område 3 (løbsdags-aksen er deleren i motoren).
**Omfang:** M (skøn).

---

## 5. Resten af træningen: ugeprogram 7×5, skader, belastning, Åbnere

**Hvad det er.** Fem ting du godkendte 6/9 og 15/9, som ikke er begyndt: programmet pr. løbsdag skal være 7 ugedage × 5 løbsdage = 35 celler i stedet for 7 (§13.3 punkt 8), skadesvarighed skal måles i løbsdage i stedet for kalenderdage (punkt 7), belastning Let/Normal/Hård på samme session (#4852), holdpas rollefordelt (#4853), træthedsgrænse (#4854), Åbnere som femte dagstype (#5238), rekalibrering af vagter og økonomi-akse (#4848) og tests + hjælpetekst + patch note (#4849).

**Status i dag: ikke startet.** Alle otte issues er åbne med `claude:todo`. Ingen PR'er. Ugeprogrammet 7×5 har ikke engang et eget issue — det står kun som beslutning 8 i TRAINING_RULES §13.3 og kræver en migration af 27 holds eksisterende planer.

**Mangler:**
1. Ugeprogram 7×5 skal have mockup først, derefter issue, derefter byg (migration af eksisterende planer).
2. Skadesvarighed i løbsdage (hænger sammen med B4).
3. #5238 Åbnere kræver et A/B-svar fra dig, før noget kan bygges.
4. D1-D3 (#4852-#4854), A4 (#4848), A5 (#4849).

**Hvis det ikke er klar til 27/9:** **ingenting.** Det er den ærlige vurdering. Alt dette ligger oven på løbsdags-tick'et og kan lande i uge 1-3 af S4 uden at noget går i stykker eller ser forkert ud. Undtagelsen er skadesvarighed: tændes B4 uden den, vil en skade blive vist i kalenderdage mens træningen regner i løbsdage, og de to tal vil ikke stemme for spilleren. Det er kosmetisk-forvirrende, ikke ødelæggende.

**Hvem gør hvad:** ejer-beslutning (A/B på Åbnere, godkend mockup af 7×5) → byggearbejde.
**Afhænger af:** område 3 og 4.
**Omfang:** L (skøn) — flere dage. MASTERPLAN's "bølge 5, træning færdig (28/9)" er ikke realistisk med 8 dage.

---

## 6. U23- og junior-ryttere: generatoren og populationen

**Hvad det er.** For at U23- og juniorhold kan køre løb, skal der findes ryttere i den alder. De skal fødes med troværdige evner, og der skal være nok af dem til at fylde felterne.

**Status i dag: fundamentet er merget, selve generatoren er ikke bygget.**
- `riders.squad` og trup-lofterne er live (#5279, merget).
- Senior-læserne bruger ét delt trup-prædikat (#5396, merget) — **men det kræver at en backfill køres, og den er ejer-gated og ikke kørt.**
- Rytterfødsel uden PCM-stats er live (#5278, merget).
- U23-fødselsbåndet, variant A, er merget (#5401).
- Den synlige generator-test du krævede 15/9 er leveret (#5368) — **men punkt 2 mangler**: sammenligningen med 10 eksisterende prod-ryttere side om side er ikke lavet, fordi rapporten kører uden databaseadgang.
- **Spec A6 (U23-rytterpopulationen) er ikke bygget.** Specen selv estimerer 10 timer for A6 alene og 44-50 timer for hele fase A.
- Arketype-prioren (#5327 / PR #3512) er ikke færdig; PR'en er et udkast med konflikter og har ikke bevæget sig siden 4/9.

**Mangler:**
1. Beslutning: skal U23 overhovedet med i S4? (se område 7)
2. A6-generatoren bygges.
3. Backfill af `riders.squad` køres (dit go).
4. Genererings-kørslen mod prod — en engangshandling ved cutover, der kræver dit go.

**Hvis det ikke er klar til 27/9:** hvis U23-kalenderen alligevel ikke kommer med, sker der ingenting. Hvis U23-kalenderen kommer med **uden** ryttere, går det i stykker synligt: der vil være U23-løb uden køreligt felt. Specens egen hårde gate C1 siger netop dette — hvert U23-løb skal have køreligt felt i 100 % af simulerede løbsdage, ellers skæres divisioner væk.

**Hvem gør hvad:** ejer-beslutning (skal U23 med) → ejer-go (backfill + generering) → byggearbejde.
**Afhænger af:** område 7's beslutning.
**Omfang:** L (skøn).

---

## 7. U23- og junior-kalender og trup-fladerne

**Hvad det er.** Egen løbskalender pr. trup, egen udtagelse og taktik, egen pyramide med op- og nedrykning, Youth races-siden, standings og præmie-gren. Spilleren mærker det som en klub med tre hold i stedet for ét.

**Status i dag: ikke startet.** #4619, #4620, #4621 og epic #2492 er alle åbne med `claude:todo`. Ingen PR'er på selve kalenderen eller fladerne. Specen fra 15/9 deler arbejdet i fase A (skal være klar **før** S4-genereringen, 44-50 timer), fase B (klar ved cutover hvis U23-løb skal køre fra dag 1, ca. 36 timer) og fase C (uge 1 af S4).

Du besluttede 15/9 (§13.3 punkt 5) at U23-kalenderen bygges **med** i S4-cutover. Risikoen blev flagget allerede dengang som *"13 dage, nul buffer"*. Der er nu 8 dage, og fase A er ikke begyndt.

**Mangler:**
1. Hele fase A (kalenderakse pr. trup, pakker pr. trup, dry-run, scorecard).
2. Hele fase B (udtagelse trup-bevidst, AI-fyld, standings, præmie-gren, Youth races-siden).
3. Seks åbne beslutninger til dig, som specen selv lister (§10).
4. Visuel godkendelse fra dig på fladerne, før noget merges.

**Hvis det ikke er klar til 27/9:** ingenting går i stykker, hvis man **ikke** forsøger. U23-fladerne findes ikke i dag, og spillerne savner ikke noget de aldrig har haft. Går man halvvejs — kalender uden ryttere, eller ryttere uden flader — bliver det synligt forkert. **Dette er det største enkelte stykke arbejde i hele overblikket, og det er det eneste sted hvor min læsning siger: det når ikke 27/9.**

**Hvem gør hvad:** ejer-beslutning (med eller udskudt) → byggearbejde.
**Afhænger af:** område 3 (løbsdags-aksen deles med senior) og område 6 (ryttere).
**Omfang:** L (skøn) — specens eget tal er 80+ timer for fase A+B.

---

## 8. Graduation Day

**Hvad det er.** Ritualet hvor en årgang skifter trup: listen over ryttere der er vokset ud af deres hold, trænerens vurdering, og valget mellem at rykke dem op, sælge dem eller slippe dem.

**Status i dag: ikke startet.** #2491 er åben med `claude:todo`. Du besluttede 15/9 valg A: listen åbner **7 dage før sæsonskiftet**, altså ca. 20/9, med frist ved selve skiftet. Det er i morgen. MASTERPLAN har det stadig i bølge 6 markeret "ikke startet".

**Mangler:**
1. Selve siden (T1-skabelon, YOUTH_RULES §2.6).
2. Default-kæden ved skiftet (op hvis plads og råd, ellers sælg, ellers slip).
3. Fog-gate på trænerens vurdering, EN+DA, hjælpetekst, patch note.
4. Beslutning fra dig: skal den udskydes til S5, når U23-trupperne alligevel ikke er der?

**Hvis det ikke er klar til 27/9:** her skal man være præcis. Graduation Day giver kun mening, hvis der **er** en U23-trup at rykke op i. Kommer område 6+7 ikke med, er Graduation Day tom. Falder den helt væk, kører default-kæden ved skiftet alligevel via den eksisterende akademi-logik (≤ 22 i dag), og spilleren mærker det som i dag: ryttere forsvinder ud af akademiet uden ceremoni. Det er ikke ødelagt, det er bare uden oplevelse.

**Hvem gør hvad:** ejer-beslutning først (udskyd eller byg) → byggearbejde.
**Afhænger af:** område 6 og 7. Uden dem er den meningsløs.
**Omfang:** M (skøn).

---

## 9. Inaktive managers: parkering, tilmeldingsknap og assistent-besked

**Hvad det er.** Managers der ikke har logget ind i 30 dage får deres hold parkeret uden for divisionerne ved skiftet, så der bliver plads til nye spillere i D3. Holdet er urørt, og en "tilmeld dig næste sæson"-knap melder dem tilbage.

**Status i dag: delvist bygget.**
- Definitionen og rapporten er bygget (#4592's første del): `managerActivity.js`, `dormantTeamsReport.js`, SQL-skabelon og en linje i cutover-preflighten.
- Tilmeldingsknappen (#452) er bygget og ligger bag flaget `season_signup_enabled`, som registret markerer **dormant, sat til at tændes ved S4-cutover**.
- **Selve parkeringen (del 2) er ikke bygget**, bevidst: du skal se kandidatlisten først.
- Beskeden når assistenten udtog holdet, og valget af `assistant_selection_mode` ved cutover (#4759), er ikke begyndt og har ingen aktivitet.

Tallene fra målingen 2/9: 96 menneskehold i D3, heraf 17 aktive (login ≤ 7 dage) og 64 sovende (login > 30 dage).

**Mangler:**
1. Rapporten køres frisk, og du godkender kandidatlisten.
2. Parkeringen bygges (den rører pulje-bevidst AI-fyld).
3. Flaget `season_signup_enabled` tændes ved cutover + patch note (den er bevidst ikke skrevet endnu).
4. Dit valg af `assistant_selection_mode`: `proactive`, `late_fill` (24 t) eller `opt_in`.

**Hvis det ikke er klar til 27/9:** ingenting går i stykker, men hele begrundelsen falder. D3 forbliver fyldt med 64 sovende hold, nye spillere lander i D4 hos AI-hold, og tilmeldingsknappen bliver liggende usynlig endnu en sæson. Det er den direkte modsætning til at tilgang og fastholdelse er flaskehalsen.

**Hvem gør hvad:** ejer-beslutning (godkend listen, vælg assistent-mode) → byggearbejde → ejer-go ved flip.
**Afhænger af:** område 14 (parkeringen sker i selve cutover-kørslen).
**Omfang:** M (skøn).

---

## 10. Mandatet-flip (bestyrelsens mandatmodel fra beta til alle)

**Hvad det er.** Bestyrelsen giver holdet et mandat med mål for sæsonen, tillid der stiger og falder, og bonustilbud. I dag ser kun beta-testere det.

**Status i dag: bygget, i beta, to forudsætninger mangler.** Registret siger `board_mandate_model_enabled` = **beta**.
- Klar: hjælpetekst + patch note (#4855, lukket), bonustilbud-fejlen (#4856, lukket), Sponsors-siden ud af Board (#4843, merget), Boardroom-siden (#4844, merget).
- Mangler: backfill af de 2 hold uden bestyrelsesrelation (#4857, åben, kræver dit go til `--apply`).
- Mangler: **sæson 4 skal være i databasen** (#4270). Uden den efterlader skiftet 237 hold med et afsluttet mandat og intet nyt (fundet i #4838). Det er samme årsag som i område 1: mandat-motoren slår den kommende sæson op på nummer og springer holdet over, hvis rækken ikke findes.
- Nyt 18/9: egomadsen fandt manglende ord i Mandat-fladen i beta (*"der er noget visningshalløj der ikke fungerer"*), som du selv kaldte en fejl med "speaks". Det bør være rettet og verificeret på EN+DA før flip.

**Mangler:**
1. Backfill af de 2 hold (dry-run vist dig → dit go).
2. S4-rækken i databasen (område 1).
3. Oversættelses-/visningsfejlen rettet.
4. Dry-run af mandat-forslaget vist dig → flip-go.

**Hvis det ikke er klar til 27/9:** hvis flaget bliver i beta, sker der ingenting galt — beta-testere ser det, resten gør ikke. **Men hvis S4-rækken ikke findes ved skiftet, går det i stykker for alle 237 hold**, uanset flaget. Det er den vigtige kobling: område 1 skal ske, og den skal ske før skiftet.

**Hvem gør hvad:** ejer-go (backfill + flip) → lidt byggearbejde (visningsfejlen).
**Afhænger af:** område 1.
**Omfang:** S (skøn), hvis område 1 er på plads.

---

## 11. Race engine v4-flip

**Hvad det er.** Den nye løbsmotor der beregner etapen undervejs i stedet for på én gang. Spilleren ville mærke rigtigere løb og, senere, muligheden for at følge et løb live.

**Status i dag: ikke klar.** Registret siger `race-engine-v4` = **dormant, off i prod**. v3 kører S3 færdig og er låst fallback.
- Kalibreringspakken før flip (#4914) er åben; nogle punkter er grønne (felt-sammenhæng 88 % inden for båndet), M12 all_out/grupetto og 5-seed-gaten er ikke lukket.
- TTT- og passage-følgesagerne (#4915) er åbne, herunder TTT i S4-kalenderen.
- Hjælp-sektionen om løbsdag er hardkodet skjult og skal flippes i samme PR (#4948).
- "Følg løbet live" (#4916) er efter flip.

**Mangler:**
1. Kalibreringspakken lukkes (#4914).
2. TTT-følgesagerne (#4915).
3. Hjælp-sektionen (#4948) + dit go på teksten.
4. Flip-go fra dig — og efter reglen fra 27/6 er gen-tænding af en live løbsmotor **kun dit kald**.

**Hvis det ikke er klar til 27/9:** ingenting. v3 kører videre, som den har gjort i tre sæsoner. Det eneste argument for at flippe ved et sæsonskifte er at motorskift midt i en sæson er værre. Men et flip uden færdig kalibrering er værre end begge dele.

**Hvem gør hvad:** byggearbejde → ejer-go.
**Afhænger af:** ikke noget andet område, men det er det tungeste tilbageværende.
**Omfang:** L (skøn).

---

## 12. Mail til managers før sæsonslut (varsling + win-back)

**Hvad det er.** En mail til managers hvis hold er på vej til at blive parkeret ved sæsonskiftet, så de når at logge ind, plus en genaktiverings-mail til dem der allerede er væk.

**Status i dag: sendestien er bygget, teksten er ikke godkendt, ingen mail er sendt.** PR #5247 er merget: script, segment og flag findes. Segmentet blev målt til 92 den 14/9 — det er ikke et aktuelt sendetal, og de 125 fra briefen er ikke automatisk kontaktbare.

**Nyt siden MASTERPLAN blev skrevet:** dit direktiv 18/9 ordret: *"Der skal laves en winback mail til managers, hvis hold snart bliver inaktivt i forbindelse med sæsonskiftet. Der altid automatisk sendes inden sæsonen afsluttes"*. Det er en **varsling før parkering**, ikke kun en win-back bagefter — og den skal være automatisk. Det står ikke i MASTERPLAN i dag.

**Mangler:**
1. Du retter teksten færdig (udkast skrevet 17/9).
2. Frisk samtykke- og suppressions-kontrolleret liste.
3. Dry-run vist dig → separat send-go. Planlagt vindue: 21.-24/9.
4. Den automatiske varsling før sæsonslut skal bygges (det er nyt arbejde, ikke det merget).

**Hvis det ikke er klar til 27/9:** ingenting går i stykker, men parkeringen (område 9) bliver noget der sker for folk uden varsel. Det er præcis den slags der giver en dårlig historie, og det er en engangs-mulighed: efter skiftet kan mailen ikke længere være en varsling.

**Hvem gør hvad:** ejer-handling (tekst + send-go) → byggearbejde (den automatiske varsling).
**Afhænger af:** område 9 (hvem der bliver parkeret).
**Omfang:** S (skøn) for udsendelsen, M for den automatiske varsling.

---

## 13. Quad9: spillere kan slet ikke nå spillet

**Hvad det er.** Spillere hvis internetudbyder eller sikkerhedsopsætning bruger Quad9 som DNS, kan **ikke** nå API'et. Alt i spillet fejler uden fejlbesked, og de forsvinder stille. Bekræftet reproduceret: hele `up.railway.app`-zonen fejler på Quad9, mens `cyclingzone.org` er ren.

**Status i dag: brand, måling kører.** Målingen (#5324) er merget 17/9 og har kørt siden. MASTERPLAN siger "aflæs Sentry 19/9" — det er i dag, og der er ikke skrevet noget på #5323 siden 17/9.

**Fælden:** Railway beder om et CNAME til `<hash>.up.railway.app`. Det peger lige ind i den zone der fejler, så et naivt `api.cyclingzone.org` retter formentlig **ingenting** for netop de brugere det handler om. Vej A er en Vercel-rewrite, hvor browseren aldrig slår et Railway-navn op.

**Mangler:**
1. Aflæs målingen i Sentry (hvor mange er ramt).
2. DNS-test: `nslookup api.cyclingzone.org 9.9.9.9` efter opsætning, før flytning — det er din handling.
3. Valg mellem Vercel-rewrite og custom domain.
4. Selve flytningen: DNS, `VITE_API_URL`, CSP, ALLOWED_ORIGINS.

**Hvis det ikke er klar til 27/9:** det har ingenting med sæsonskiftet at gøre — det er lige galt hver dag. Men det er den eneste post på hele listen hvor spillere **allerede nu** er låst helt ude, og hvor en ny spiller der lander på forsiden ved et sæsonskifte ikke kan komme i gang. Det taler for at tage den før alt andet på listen.

**Hvem gør hvad:** ejer-handling (DNS-test, DNS-record) → ejer-beslutning (vej) → byggearbejde.
**Afhænger af:** ingenting.
**Omfang:** M (skøn).

---

## 14. Selve cutover-kørslen og drejebogen

**Hvad det er.** De to timer hvor S3 lukkes og S4 åbnes: afslut sæson, op- og nedrykning, kontraktudløb, pension, løn, sponsorer, form-nulstilling, overførsel af træningsplaner, generering af startfelter. Det er her tingene faktisk kan gå i stykker for alle på én gang.

**Status i dag: ikke startet, og drejebogen er fra forrige skifte.** Den nyeste er `SEASON_CUTOVER_RUNBOOK.md` for S2→S3 den 23/8, og den bygger oven på S1→S2-checklisten. **Der findes ingen S3→S4-drejebog.** Preflight-scriptet (`scripts/preflight-season-cutover.ps1`) findes og er indgangen.

Kendte åbne sager der rammer netop denne kørsel:
- **#4159** (høj): `game_day`-aksen må aldrig kunne skrives skævt igen — DB-trigger, lane-packer-fix og en **transition-gate**. Dit eget krav fra 24/8. Åben.
- **#4153**: sæsonlønnen trækker ny-sæson-løn for ryttere der pensioneres i samme skifte. Målt til 26 hold / 103.700 i S2→S3. Åben — det gentager sig i S3→S4, hvis den ikke rettes.
- **#3467**: 1 døgns offseason-buffer ved skiftet (spillerforslag). Åben, ikke besluttet.
- **#2901**: REVOKE af anon-rettigheder på 47 RLS-låste tabeller — eksplicit **efter** cutover.

**Mangler:**
1. En S3→S4-drejebog skrevet på den nye virkelighed (parkering, tilmeldingsflag, evt. U23, mandat-flip).
2. Preflight kørt frisk tæt på dagen, ikke ugen før.
3. Beslutning på #4153 (ret nu eller accepter endnu en gang).
4. Verificeret backup før kørslen — det er det eneste rigtige sikkerhedsnet.

**Hvis det ikke er klar til 27/9:** dette er den ene post hvor "ikke klar" betyder at spillet kan gå i stykker for alle. Tidligere skifter har haft tomme mellemrum uden aktiv sæson, forkerte puljer og manglende kalender. Drejebogen er dyr at undvære.

**Hvem gør hvad:** byggearbejde (drejebog + #4159) → **ejeren klikker selv** de destruktive skridt, og ser tilstanden live før hvert af dem.
**Afhænger af:** alle de områder der skal med i kørslen (1, 6, 7, 9, 10).
**Omfang:** M (skøn) for drejebogen alene; kørslen er en aften.

---

## (a) Afhængigheds-rækkefølge: hvad SKAL komme før hvad

```
13  Quad9                      (uafhængig, men spillere er låst ude NU)
     |
 3  Træningsdagenes form A/B  ── du poster afstemningen
     |        \
     |         \____________________________
     |                                      \
 1  S4-kalenderen genereres  (--race-days)   4  Træning pr. løbsdag (deler)
     |            \                              |
     |             \                             5  Resten af træningen
10  Mandatet-flip   2  Katalog-forbedring        (kan lande efter)
     |                (kun hvis før apply)
     |
 6  U23-ryttere ─── 7  U23-kalender + flader ─── 8  Graduation Day
     |                    (alle tre eller ingen af dem)
     |
 9  Inaktive managers ─── 12  Varslingsmail (skal sendes FØR skiftet)
     |
14  Cutover-kørslen  (alt ovenfor lander her)
```

**De fire hårde låse:**
1. **Område 3 før område 1 og 4.** Løbsdags-tallet er et argument til kalender-kørslen og deleren i træningsmotoren. Intet af de to kan gøres færdigt uden.
2. **Område 1 før område 10.** Uden S4-rækken i databasen står 237 hold uden mandat efter skiftet. Det er ikke "pænere med" — det går i stykker.
3. **Område 9 før område 12.** Du kan ikke varsle folk om parkering, før du har godkendt hvem der parkeres. Og mailen skal sendes før sæsonen slutter, ellers er den ikke en varsling.
4. **Område 6 før 7 før 8.** Ryttere før kalender før ritual. Hvert enkelt uden de foregående er synligt tomt.

**Én blød, men vigtig:** område 2 kan kun nå med i S4, hvis den bliver færdig **inden** kalenderen genereres — eller hvis du er villig til at regenerere bagefter (hvilket §2c nu tillader, så længe sæsonen ikke er aktiv).

---

## (b) Ting i MASTERPLAN Bane 1 der efter min læsning IKKE kan nås til 27/9

| Hvad | Hvor i MASTERPLAN | Hvorfor ikke |
|---|---|---|
| **Bølge 4's U23-kalender pr. trup** (`pakker pr. trup`, `generator A6`, `AI U23/junior-ryttere`, `C1`) | Bane 1, punkt 4 | Specens eget estimat for fase A alene er 44-50 timer, og fase A er ikke begyndt. Fase B er yderligere ca. 36 timer. Der er 8 dage, som også skal rumme kalender, træning, mandat og selve cutoveren. Risikoen blev flagget allerede 15/9 som "13 dage, nul buffer" — nu er det 8. |
| **Bølge 6, trup-flader** (U23/junior-sider, udtagelse, standings, Youth races, præmie-gren) | Bane 1, punkt 6 | Samme årsag. Ikke startet, ingen PR'er, og den kræver visuel godkendelse fra dig på hver flade før merge. |
| **Graduation Day senest 20/9** | Bane 1, punkt 6 | Fristen er i morgen, og der er ikke skrevet en linje kode. Den er desuden meningsløs uden U23-trupperne ovenfor. |
| **Bølge 5, "træning færdig (28/9)"** | Bane 1, punkt 5 | Otte åbne issues, ingen startet, ét af dem (#5238 Åbnere) venter på en beslutning fra dig, og ugeprogrammet 7×5 har ikke engang et issue. B4 alene skal rettes først. Det der KAN nås er tick'et (område 4), ikke hele bølgen. |
| **Bølge 7's v4-flip** | Bane 1, punkt 7 | Kalibreringspakken (#4914) og TTT-følgesagerne (#4915) er åbne, og et motorskift uden færdig kalibrering er værre end at vente. Registret har den som dormant. |
| **#3512 / #5327 arketype-prior** | Bane 1, punkt 4 | PR'en er et udkast med konflikter og har ikke bevæget sig siden 4/9. Den er en forudsætning for U23-populationen, ikke for senior-S4. |

**Det der efter min læsning godt KAN nås:** område 1 (S4 genereret og synlig), 3 (afstemning + merge), 4 (træningstick'et), 9 (parkering + tilmelding), 10 (mandat-flip), 12 (mailen), 13 (Quad9) og 14 (drejebogen). Det er otte områder — cirka de ti ting du bad om at vælge imellem.

---

## (c) Ting der hænger på skiftet, men IKKE står i MASTERPLAN

1. **Selve cutover-drejebogen.** Den nyeste er fra 23/8 (S2→S3). Der findes ingen S3→S4-version, og MASTERPLAN har ingen post for den. Den er forudsætningen for område 14.
2. **#4159 — `game_day`-aksen og transition-gaten.** Dit eget krav fra 24/8, `priority:high`, åben, nævnes ikke i Bane 1. Den handler præcis om at kalender-aksen ikke må skrives skævt ved et skifte.
3. **#4153 — lønnen trækkes for ryttere der pensioneres i samme skifte.** Målt til 26 hold / 103.700 i forrige skifte. Åben. Den gentager sig automatisk 27/9, hvis den ikke rettes.
4. **Den automatiske varsling før sæsonslut** (dit direktiv 18/9). MASTERPLAN har kun #2760 som "win-back … send-go inden 24/9". Varslingen før parkering er nyt arbejde og står ingen steder.
5. **De tre nye PR'er fra i dag:** #5412 (undersøgelse af bjergdage), #5413 (forsynings-kontrol) og #5414 (nye bjergløb). De er oprettet efter MASTERPLAN sidst blev rørt.
6. **Backfill af `riders.squad`.** #5396 er merget, men det delte senior-prædikat kræver både `squad=senior` OG `is_academy=false`, indtil backfillen er kørt — og den er ejer-gated og ikke kørt. Den skal køres før U23 giver mening.
7. **Mandat-fladens manglende ord i beta** (egomadsen 18/9). Ingen issue, kun en kommentar på #4859. Bør rettes før flip.
8. **#3467 — 1 døgns offseason-buffer.** Spillerforslag, åben, ikke besluttet. Den er direkte et sæsonskifte-spørgsmål.
9. **#5283's punkt 2.** Generator-rapporten er leveret, men sammenligningen med 10 rigtige prod-ryttere mangler. Det var din betingelse 15/9 før nye ryttere genereres.

---

## (d) Hvor MASTERPLAN eller NOW er forældet i forhold til GitHub

| Sted | Står der | Virkeligheden 19/9 |
|---|---|---|
| `NOW.md` "Åbne PR'er: #5410 #5281 #5264 #5169 #3512" | #5410 er åben | **#5410 blev merget kl. 14:04** i dag. Og tre nye er åbnet siden: #5412, #5413, #5414. |
| `NOW.md` "🎯 Next action" punkt 4 | "#5410 tekst-vagt: ejer-billede før merge" | Merget. Punktet er overhalet. |
| `NOW.md` "Standing context": "Alt live 28/9" om trupperne | U23/junior live 28/9 | Ikke realistisk, jf. (b). Linjen lover noget der ikke kan holdes. |
| `MASTERPLAN.md` Bane 1, punkt 6 | "Graduation Day (#2491, senest 20/9)" markeret ⚪ under en bølge der ikke er startet | Fristen er i morgen. Enten flyttes fristen, eller også skal den op foran. |
| `MASTERPLAN.md` 🔴 Brand | "aflæs Sentry 19/9" | Er ikke gjort. Ingen aktivitet på #5323 siden 17/9. |
| `MASTERPLAN.md` Bane 1, punkt 2 | "🔵 træningsdesign (18/9: realisme-regel låst; K2-prøvepakning → #5169 om …)" | K2 er siden **afvist som strukturelt umulig** i D1/D3/D4 (prøvepakning 19/9). Kun måde A/B er tilbage, og de venter på en afstemning. |
| `MASTERPLAN.md` Bane 1, punkt 4 | "#5272" står som åben opgave | **Merget 17/9** (PR #5347), men virkningen afhænger af #5169. |
| `CALENDAR_RULES.md` §2d | Kommando-eksemplet nævner `--uniform-tilt` | Gav falske blokerende fund i formiddags. Skal rettes. |
| `FEATURE_REGISTRY.yml` | Har intet felt for `training_tick_per_race_day` | Flaget styrer hele træningsomlægningen og findes ikke i registret. `race-engine-v4` har heller intet `flag:`-felt, kun en note. |
| `MASTERPLAN.md` Bane 1, punkt 1 | "✅ Bølge 1: #4851 score" | #4851 er stadig **åben** (mærket `claude:done`, men ikke lukket). Samme mønster på #5269, #5272, #5283, #5376 og #452. |

---

## Hvad der venter på dig lige nu, samlet

1. **Post afstemningen om træningsdagene** (område 3). Materialet er skrevet og klar. Alt på kalender- og træningssiden står stille indtil svaret.
2. **Aflæs Quad9-målingen og tag DNS-testen** (område 13). Spillere er låst ude i dag.
3. **Go til at generere S4-kalenderen** (område 1). Og beslut om du vil vente på katalog-forbedringen (område 2).
4. **Beslut om U23 skal med i S4 eller udskydes til S5** (område 6+7+8). Det er det valg der frigør mest tid til alt andet.
5. **Godkend parkerings-kandidatlisten** (område 9) og **ret mailteksten færdig** (område 12), så varslingen kan sendes 21.-24/9.
6. **Vælg `assistant_selection_mode`** ved cutover (område 9).
7. **Go til mandat-backfill og flip** (område 10), når S4-rækken findes.
