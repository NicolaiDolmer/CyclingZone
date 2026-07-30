# Beslutnings-ark 2026-07-30 — 75 ejer-gatede sager

> Hver sag: situation i klar tekst + valgmuligheder + min anbefaling (fed). Svar pr. nummer, fx `2884: C · 3120: A · 2699: vent`. Grundlag: klassifikationen af alle 474 + dagens verifikation. Refs #3154.

> **✅ De 15 "haster nu" er BESVARET af ejeren 30/7 aften:** #419=A · #1903=B (lukket — første ægte Founder!) · #2042=analytics-svar leveret (96 % var egne spillere; ~70 kolde sessioner/dag er reelle) · #2076=A (ejer-klik udestår) · #2622=egen session · #2650=flad nat-restitution afvist, design-samtale · #2675=egen session · #2699=udskudt · #2799=ejer bad om problemforklaring · #2813=best practice hurtigst muligt (plan på issuet) · #2853=samtale inden for få dage · #2889=3/8 · #2884=C · #2892=A (ejer-klik udestår — API utilgængeligt) · #3120=C (dry-run-tal → endeligt ja → modregning). Alle dokumenteret på issues. **De 60 resterende (denne måned + kan vente) er stadig ubesvarede.**

## 🔴 HASTER NU — blokerer aktivt arbejde eller spillere (15)

### [#419](https://github.com/NicolaiDolmer/CyclingZone/issues/419) — Discord: skal du invitere Carl-bot selv, eller er indbygget auto-mod nok?

Issuet kræver at DU, ikke Claude, inviterer to Discord-bots via login i browseren (Discord kræver OAuth-godkendelse fra en menneskelig konto-ejer). Status: den eneste merged PR på dette issue (20/6) leverer kun en instruktionsside med alle trin markeret 'din handling' — ingen bot er faktisk inviteret endnu. En tidligere audit (18/5) viser at Discords eget indbyggede auto-mod-filter allerede er sat op og dækker en del af det, Dyno-botten skulle løse (spam, invite-links, store bogstaver, forbudte ord). Carl-bot-delen (automatisk 'Beta-Tester'-rolle til nye medlemmer + velkomstbesked + reaction-roller) er derimod IKKE dækket af noget nativt og mangler helt. Du opgraderede selv issuet til høj prioritet 11/6, fordi internationale spillere er på vej og det hænger sammen med velkomst-flowet (#679).

- **A) Invitér kun Carl-bot nu (https://carl.gg/invite, ca. 5 minutter) og sæt auto-rolle 'Beta-Tester' + velkomstbesked op. Drop Dyno og luk den del af issuet som 'ikke nødvendig', fordi Discords indbyggede auto-mod allerede dækker det. ← anbefalet**
- B) Invitér begge bots som oprindeligt planlagt (Carl-bot + Dyno). Dyno giver lidt mere kontrol over auto-mod (egne ord-lister, dedikeret log-kanal) end Discords indbyggede filter, men er reelt overlap med noget der allerede virker.

_Hvorfor A: Carl-bot dækker et reelt hul — nye internationale spillere får i dag hverken automatisk rolle eller velkomstbesked, og det er tidskritisk ifølge din egen prioritering. Dyno duplikerer noget Discord allerede gør gratis; endnu en bot betyder mere overflade og flere tilladelser for meget lille ekstra gevinst i et lille community. 5 minutters arbejde fra dig lukker den vigtige del af issuet._

### [#1903](https://github.com/NicolaiDolmer/CyclingZone/issues/1903) — Var 25/7-købet dig selv, eller jeres første rigtige Founder-kunde?

25/7 kl. 17:45 blev det første CZ Pro-abonnement oprettet i databasen — betalingsflowet virker teknisk fint. Jeg har lige tjekket hvem det er: holdet hedder 'Équipe Lorraine Acier', manager 'Pierre Frison Noël', og databasens egen test-markering (is_test_account) står på FALSK — det ligner altså ikke en testkonto, og hverken navn eller mail matcher dig. Men kun du kan bekræfte det 100%, og issuet kan først lukkes helt når det er afklaret.

- A) Det var mit eget testkøb — så skal det annulleres i Alunta (det skal du selv gøre, jeg må ikke røre betalinger), og det tæller ikke med i jeres mål om 25 betalende på 30 dage.
- **B) Det var IKKE mig — jeres første rigtige, betalende Founder! Så lukker jeg issuet permanent, og det er værd at overveje en personlig tak til spilleren. ← anbefalet**

_Hvorfor B: Alle spor i databasen (holdnavn, managernavn, test-flag=falsk) peger væk fra en testkonto. Men det er en antagelse ud fra data, ikke et bevis — bekræft det, så I ved om I reelt har fået jeres første betalende spiller._

### [#2042](https://github.com/NicolaiDolmer/CyclingZone/issues/2042) — Cold trafik rammer login-væg på /riders og /races — den udskudte dato er passeret

Besøgende der klikker et delt link fra fx Reddit eller et Hattrick-forum til /riders eller /races ser i dag kun et login-felt, intet af spillet — og forsvinder. Det er faktisk jeres største indgangssider: /races havde 3.304 besøg, /riders 2.606, /auctions 1.110 på 4 uger, alle bag login. Kun forsiden er offentlig, så Google kan reelt kun indeksere én side af hele sitet. Af 134 nye brugere de sidste 30 dage kom 98 (73%) aldrig tilbage. Du udskød selv denne beslutning 23/7 til '27/7 eller senere' — den dato er nu passeret. Et lille delvist fix (login der husker hvor man var på vej hen) er allerede shippet. Den store løsning — vis rytterprofiler/løbskalender uden login — mangler stadig et design-svar fra dig.

- **A) Åbn de 4 trivielle sider (patch notes, regler, hjælp, roadmap) for udloggede nu — ingen datasikkerhedsafklaring nødvendig, kan bygges denne uge. Løser SEO-blokaden med det samme, men rører ikke de tre mest besøgte sider. ← anbefalet**
- B) Book en designsamtale om fuld offentlig preview af rytterprofiler + løbskalender — de sider der reelt driver bounce (3.304 + 2.606 besøg). Større arbejde, kræver en snak med dig først.
- C) Udskyd igen — men med en konkret ny dato denne gang, ikke bare 'senere'.

_Hvorfor A: A koster stort set intet at bygge og løser SEO-blokaden i denne uge. B er den rigtige langsigtede løsning på bounce-problemet, men kræver en designsamtale først (jeres egen regel om at store UX-ændringer starter med en snak) — gør derfor A nu, og book B som næste skridt i stedet for at lade begge stå stille endnu en uge midt i en retention-krise._

### [#2076](https://github.com/NicolaiDolmer/CyclingZone/issues/2076) — Sidste stykke af oppetids-overvågningen: vælg værktøj til backend-healthcheck

Sentry viser 3 uløste 'kan ikke nå serveren'-fejl (railway.app) i de sidste 24 timer. Alt andet i denne opgave er allerede gjort: Railway-login virker, Discord-alarm er koblet på Sentry, og der er en gratis oppetidsmonitor på selve cyclingzone.org (via Ping Puffin). Det eneste der mangler er en tilsvarende monitor på selve backend'ens healthcheck (…railway.app/health) — den der rent faktisk fanger et backend-nedbrud, som frontend-monitoren ikke ser. Det venter kun på at du vælger et værktøj, fordi jeres nuværende leverandør (Ping Puffin) koster ekstra for endnu en monitor.

- **A) Sæt en gratis UptimeRobot-monitor op nu: opret gratis konto på uptimerobot.com, tilføj en HTTP(s)-monitor på https://cyclingzone-production.up.railway.app/health, 5 min-interval, alarm til mail. Cirka 5 minutter, 0 kr/md. ← anbefalet**
- B) Betal for endnu en Ping Puffin-monitor på samme dashboard som frontend-monitoren — dyrere, men alt oppetidsovervågning samlet ét sted.

_Hvorfor A: Der er ingen funktionel forskel for jeres behov — begge løsninger pinger et endpoint og sender en alarm — så der er ingen grund til at betale for noget I kan få gratis. Eneste ulempe ved A er to dashboards i stedet for ét._

### [#2622](https://github.com/NicolaiDolmer/CyclingZone/issues/2622) — Auto-udtag af trupper for hele sæsonen — spørg spillerne (pollen ligger klar)

Spillet fylder automatisk 8.841 tilmeldinger til ALLE 173 kommende løb i sæsonen, ikke kun de nære — cirka 4.100 af de menneskestyrede tilmeldinger (40%) ligger på løb 5+ dage ude, hvor spillere har klaget ('hvorfor er min trup udtaget for hele sæsonen?'). Du besluttede 18/7 at spørge spillerne først via en poll, før noget kodes. Pollen (EN+DA) står allerede færdigskrevet i issuet, klar til copy-paste i #feedback-and-ideas — den mangler bare at blive postet.

- **A) Post pollen nu i #feedback-and-ideas (teksten ligger i kommentaren fra 18/7, kan justeres frit). ← anbefalet**
- B) Spring pollen over og besluk selv: gå direkte med Claudes anbefaling fra 18/7 — menneske-hold får kun autofyldt de næste 2 løbsdage, AI-hold uændret (de holder tynde felter fyldt).

_Hvorfor A: Du har allerede besluttet at spørge spillerne først — det er rigtigt, for det er en smagssag (agens vs. bekvemmelighed), ikke en fejl at rette. Et reelt spillersvar er billigere end at gætte forkert på noget spillere mærker hver dag._

### [#2650](https://github.com/NicolaiDolmer/CyclingZone/issues/2650) — Trætheds-genopladning kan ikke følge med — 63% af menneske-ryttere træner med straf

Prod-tal fra 18/7: AI-holdenes ryttere ligger i snit på 99,3 i træthed (nærmest permanent udkørte), og menneskestyrede ryttere ligger i snit på 76 — 63% af dem er over straf-grænsen (70), så de træner med reduceret effekt. Nattens restitution findes, men kan ikke følge med 3-løb-om-dagen-kalenderen plus træning. Det betyder at 'rotér din trup og hold stjernerne friske'-rådet fra Hjælp-siden reelt ikke virker for de fleste spillere, og forklarer en del af de igangværende 'ingen fremgang'-klager.

- **A) Prioritér nu: byg en styrket natlig genopladning (øget recovery-rate) fremfor at sænke løbs-/træningsbelastningen — mindst indgribende i løbsdesignet. Kører som altid en empirisk simulering mod den ægte population før noget ændres i produktion, mål: median-træthed 40-60. ← anbefalet**
- B) Vent — parkér issuet indtil videre. Trætheds-mætningen og de 63% træningsstraffede fortsætter, og skaderisikoen (som stiger ved høj træthed) forbliver som nu.

_Hvorfor A: Det her rammer kerneoplevelsen for de fleste aktive spillere lige nu og underminerer en strategi spillet selv lover i Hjælp — præcis den slags 'brænder nu'-issue der bør foran det lettere arbejde. Recovery-siden er den mindst risikable håndtag at skrue på først._

### [#2675](https://github.com/NicolaiDolmer/CyclingZone/issues/2675) — 16 ryttere mistede kompensation ved en fejl 18/7 — klar til at lukke sagen

Ved en fejl 18/7 fik 16 unge ryttere ikke kompensation da deres akademi-tilbud udløb (14 hold ramt, mest 1-2 bud hver). Al teknisk efterforskning er nu færdig: systemet kører korrekt (195 stemplede auktioner siden, 63 kompensationer matcher 1:1 med 1.154.136 CZ$ udbetalt til andre ramte managere). Af de 16 er 7 allerede solgt videre af markedet selv, 9 er stadig frie agenter. Claudes anbefaling fra 26/7-kommentaren venter stadig på din bekræftelse for at lukke sagen.

- **A) Godkend 'accepter' — bekræft (fx med et 👍) på 26/7-kommentaren, så lukkes sagen uden yderligere handling. Kompensationen var alligevel betinget af et salg, og næsten halvdelen har allerede fundet nye hold på egen hånd. ← anbefalet**
- B) Bed om manuel oprejsning — list de resterende (op til 16) på stemplede 24-timers auktioner, så de ramte managere får en kompensations-chance. Kræver en ny manuel prod-mutation i et system der lige har haft en hændelse.

_Hvorfor A: Effekten pr. manager er lille og engangs, markedet har allerede rettet halvdelen af skaden selv, og en ny manuel indgriben lige efter en hændelse er unødig risiko for meget lidt gevinst._

### [#2699](https://github.com/NicolaiDolmer/CyclingZone/issues/2699) — 164 akademi-ryttere har for højt livstidsloft — nedjustér nu?

164 unge akademi-ryttere (født 24/6-17/7) blev ved en fejl i den gamle rytter-generator født med et livstids-evneloft markant højere end normale unge talenter (median evneloft 70 mod dagens forventede niveau ~41). De er IKKE overpowered lige nu, men vil på sigt kunne blive uslåelige og sætte rekorder ingen andre kan slå. Alle 164 er allerede solgt til rigtige hold, som til sammen har betalt 2.127.531 CZ$ for dem; 86 af dem har desuden ingen ejer (team_id er tom). Et færdigt, verificeret dry-run-script (read-only, ingen ændringer, allerede merget til main) viser at en nedjustering til dagens generator rammer 157 af de 164 og at INGEN mister den evne rytteren rent faktisk har lige nu — kun det fremtidige potentiale sænkes.

- **A) Kør nedjusteringen nu på både de 164 solgte og de 86 ejerløse, uden kompensation. Ingen manager mister noget de rent faktisk bruger i dag (gulvet er urørt) — kun et fremtidigt loft de endnu ikke har nået. ← anbefalet**
- B) Samme nedjustering, men giv delvis refusion til de managere der har betalt for kohorten, fordi deres fremtidige videresalgsværdi falder markant. Mere retfærdigt over for spillere der købte i god tro, men kræver en ekstra finansiel prod-mutation oven i konverteringen og mere kompleksitet at få rigtig.
- C) Lad de 164 være urørte for nu og ret kun generatoren fremad (allerede sket 19/7, rammer ikke nye ryttere). Ingen ny mutation eller manager-reaktion i dag, men uovervindelige rekorder fra disse ryttere bliver en realitet på sigt, og andre spillere kan med rette føle det uretfærdigt.

_Hvorfor A: Ingen spiller mister noget de reelt har adgang til lige nu — kun et loft der aldrig burde have været der. Kompensation giver mest mening når man tager en realiseret fordel væk, ikke en spekulativ fremtidig en. Jo længere der ventes, jo flere ryttere når deres uslåelige loft, og jo dyrere bliver det at rette senere._

### [#2799](https://github.com/NicolaiDolmer/CyclingZone/issues/2799) — Ryttere er eksploderet op til 63× i pris siden 18/7 — retter vi det, eller lader vi toppen stå?

Værdimodel-opdateringen 18/7 fik toppen af markedet til at løbe løbsk: en rytter købt for 350.000 vises nu til 22 millioner (63×). På tværs af alle 7.014 ryttere er forholdet mellem top-1%-værdien og medianen 283× (median 7.088, p99 2 mio, max 83 mio); 8 ryttere er nu over 20 mio. Nye hold starter med 500.000 i startkapital. Flere spillere har i Discord kaldt afstanden uindhentelig. Sikkerhedsnettet der skulle forhindre chok kiggede kun på medianen (som var grøn) og fangede ikke halen.

- A) Kør en retroaktiv nedskalering af topværdierne nu (efter dry-run og at du selv har set live-tallene). Retter uligheden med det samme, men ændrer værdien på ryttere folk allerede ejer eller har handlet — for anden gang på under en uge, med risiko for endnu et tillidschok.
- **B) Lad den nuværende skala stå — den følger faktisk dit eget mandat fra 14/7 om at gøre de bedste ryttere svært-købelige i 3-4 sæsoner — men luk hullet i sikkerhedsnettet (tilføj kontrol på top-værdier og enkelt-rytter-spring, ikke kun medianen) og fremskynd en indhentnings-vej for nye hold (#1981), så afstanden bliver noget man kan arbejde sig op ad i stedet for en permanent mur. ← anbefalet**

_Hvorfor B: At ændre allerede handlede ryttere en gang til inden for samme uge er dobbelt-indgreb i en levende økonomi og risikerer et nyt chok oven i det første. Det respekterer også dit eget designvalg om svært-købelige stjerner. Det folk faktisk oplever er 'jeg kan aldrig indhente et etableret hold' — det løses bedre målrettet via en indhentnings-mekanik end ved at devaluere andres allerede ejede ryttere. Hullet i sikkerhedsnettet skal lukkes uanset hvad du vælger her._

### [#2813](https://github.com/NicolaiDolmer/CyclingZone/issues/2813) — CZ Pro sælges uden handelsbetingelser eller opsigelsesknap — og der er nu en betalende kunde

CZ Pro (49 kr./md.) sælges uden handelsbetingelser, uden oplyst fortrydelsesret og uden nogen måde for kunden selv at opsige i produktet — betaling sker uden at kunden ser eller accepterer vilkår. Der er nu 1 aktiv betalende kunde (verificeret i databasen lige nu, mod 0 for en uge siden) — risikoen er ikke længere teoretisk. Dansk/EU-forbrugerret kræver at pris, fortrydelsesret og opsigelse oplyses FØR aftalen indgås; uden det har kunden fuld 14-dages fortrydelsesret, som der ikke findes proces til at håndtere.

- **A) Sæt betaling på pause (skjul 'Videre til betaling') indtil et minimums-juridisk-grundlag er klar. Stopper indtægten midlertidigt for 1 kunde, men lukker den juridiske eksponering helt mens teksten skrives. ← anbefalet**
- B) Behold salget åbent og hastefærdiggør minimumsvilkår (handelsbetingelser + fortrydelses-tekst + accept ved checkout) hurtigst muligt uden at stoppe indtægten. Hurtigere resultat, men salget kører videre i mellemtiden med kendt juridisk hul, og den nuværende kunde har allerede betalt uden vilkår.

_Hvorfor A: Kun én kunde er ramt lige nu, så prisen for at sætte betaling på pause et par dage er lav — men eksponeringen rammer for hver ny betalende kunde fremover, og det er billigere at lukke hullet én dag før end at rydde op i en tvist bagefter. Du skal ikke selv skrive juraen — sig 'sæt betaling i bero', så skriver jeg minimumsteksten (betingelser, fortrydelse, opsigelse) klar til din godkendelse._

### [#2853](https://github.com/NicolaiDolmer/CyclingZone/issues/2853) — Send retentions-mails til nye spillere — mangler kun din godkendelse

E-mail-loopet der skal få nye spillere til at vende tilbage (velkomst-mail + dag1-mail + løbs-opsummering) er bygget og testet, men ligger dødt fordi flaget er slukket. Det er hovedhåndtaget mod at 73% af nye spillere aldrig kommer tilbage. Det eneste der mangler: du godkender ordlyden i de 3 mails (fuld tekst i PR #2728) og lægger 2 nøgler ind (RESEND_API_KEY + EMAIL_UNSUB_SECRET) i Infisical og Railway.

- **A) Godkend teksterne + læg de 2 nøgler ind nu — jeg flipper derefter flaget off→dry_run→on med verificering før nogen mail sendes for alvor. ← anbefalet**
- B) Vent — så fortsætter retentions-hullet med at koste nye spillere, uden nogen modforanstaltning i mellemtiden.

_Hvorfor A: Koden er allerede testet og klar; det er ren tekst-godkendelse plus 2 secrets der holder det hele tilbage — laveste omkostning, højeste gevinst i hele backloggen lige nu._

### [#2884](https://github.com/NicolaiDolmer/CyclingZone/issues/2884) — Skal auktioner vare længere end 1 time?

Auktioner varer i dag fast 1 time — en beslutning fra juni truffet før vi havde brugsdata. Med kun 8 daglige aktive spillere rammer det 1-times-vindue næsten ingen. Konkret: en rytter udbudt til under 1.000 med flere tusinde i optjent præmiepenge fik nul bud, og flere ryttere (bl.a. Rok Lewandowski, Daniel Bizimana, Iván Molina) er genudbudt 6-8 gange på to døgn uden at blive solgt.

- A) Fast længere varighed (8 eller 24 timer) — flere ser auktionen og usælgelige ryttere får et reelt marked, men markedstempoet bliver langsommere.
- B) Anti-snipe-forlængelse (bud i sidste minutter forlænger auktionen) — fjerner sidste-sekund-snigbud, men kan gøre varigheden uforudsigelig uden et loft.
- **C) Begge — start på 8 timer (admin-justerbar, ikke hardcoded) plus anti-snipe med et hard cap. ← anbefalet**

_Hvorfor C: Løser både at for få ser auktionen og at sene snigbud lukker andre ude; ved at gøre varigheden admin-konfigurerbar kan du skrue ned igen når spillerbasen vokser, uden ny deploy._

### [#2889](https://github.com/NicolaiDolmer/CyclingZone/issues/2889) — Svar spilleren om sæsonskiftets pengestrøm i Discord

En spiller spurgte 2 dage før sæsonskiftet 27/7 hvornår løn og sponsorpenge rammer hen over skiftet — ingen svarede, og skiftet (første lønudbetaling nogensinde, ~2,62 mio.) er nu kørt. Hjælpeteksten er allerede leveret i appen (help.json, en+da, PR #2941). Det eneste der mangler er selve svaret til spilleren valverde4ever i Discord-tråden.

- **A) Godkend denne tekst nu, så poster jeg/du den i tråden: "Hey, sorry for the slow reply! The season-change money order is now in the in-app FAQ (Help → FAQ → 'Season change & money'): sponsor contracts renew first, then payouts land, then wages/payroll are deducted, then contract expiries and pension/interest settle. Sorry this landed after your season already turned over — hope it helps for next time!" ← anbefalet**
- B) Spring svaret over — spørgsmålet er forældet nu hvor lønnen allerede er kørt, og andre kan finde svaret i FAQ'en selv.

_Hvorfor A: Andre spillere læser stadig tråden og vil have samme spørgsmål ved næste sæsonskifte; et kort svar koster 30 sekunder og lukker et åbent løfte issuet har ligget på siden 25/7._

### [#2892](https://github.com/NicolaiDolmer/CyclingZone/issues/2892) — Genaktivér 26 slukkede overvågnings-alarmer i Sentry

26 af 27 automatiske "er jobbet stadig i gang"-alarmer (cron-monitorer) i Sentry har været slukket siden 16/7 på grund af en nu-rettet kvote-fejl — kun ét job overvåges i dag. Jobbene kører faktisk fint (verificeret), men hvis ét af dem går i stå i morgen, opdager ingen det. Kodefixet der forårsagede kvote-problemet er allerede shippet (#2996), så det er trygt at tænde igen.

- **A) Gå til https://cycling-zone.sentry.io/crons/cyclingzone/ nu og genaktivér alle 26 monitorer (klik hver → Enable/Resume) — cirka 2 minutters arbejde, fuld overvågning tilbage med det samme. ← anbefalet**
- B) Genaktivér kun de 4 vigtigste (auto-prize, entry-generator, board-auto-accept, stall-watchdog) nu, og lad resten (email/heal-sweeps) stå slukket lidt endnu — mindre risiko hvis kvoten alligevel skulle være stram, men mindre dækning.

_Hvorfor A: Rodårsagen (kvote-brænding) er allerede lukket med en kode-guard, så der er ingen reel grund til at holde nogen slukket, og alt-eller-intet-klikket tager samme tid som at udvælge 4 af 26._

### [#3120](https://github.com/NicolaiDolmer/CyclingZone/issues/3120) — 4 ryttere kørte to løb samme dag ved en fejl og fik dobbelt point/præmie — retter vi det?

På grund af en nu rettet fejl (PR #3116) blev 4 ryttere fra Team Brutaliste (division 2) udtaget til to overlappende løb og kørte faktisk begge — holdet fik dermed dobbelt point- og præmieeksponering fra de 4 ryttere, og begge løb er allerede afviklet med udbetalte præmier. Vagtsystemet har bekræftet dagligt siden 28/7 at det stadig kun er disse 4 historiske par — ingen nye tilfælde er kommet til. Dette er øverst på din 'næste handling'-liste.

- A) Lad det stå — ingen mutation, men den uretmæssige dobbelt-gevinst forbliver permanent hos Team Brutaliste.
- B) Fjern det ene løbs resultater for de 4 helt — kræver genberegning af placeringer for HELE feltet i det løb, større risiko for nye fejl, rører spillere der intet har med fejlen at gøre.
- **C) Kompensér uden tilbagerulning — modregn kun den uretmæssige ekstra gevinst (point/præmie) hos de 4 ryttere/Team Brutaliste, uden at røre andre holds resultater. ← anbefalet**

_Hvorfor C: C retter den faktiske uretfærdighed uden B's store bivirkning (at forskyde placeringer for alle andre i feltet); at lade en dobbelt-gevinst stå helt urørt (A) sidder dårligt lige nu hvor fair-play/anti-cheat (#3131) er jeres højst prioriterede epic — selvom dette var en bug og ikke snyd._

## 🟠 DENNE MÅNED — S2-relevant (35)

### [#103](https://github.com/NicolaiDolmer/CyclingZone/issues/103) — Hvad sker der, hvis en spiller opfylder et flerårigt bestyrelsesmål tidligt?

cybersimon spurgte i maj om to ting: er den løbende plus/minus-scoring på flerårsmål tilsigtet, og hvad sker der hvis man opfylder et flerårigt mål FØR tid — bonus, eller kan man forhandle et nyt mål? bobby2106 svarede dengang at det ikke var afklaret. Claudes undersøgelse bekræfter nu i koden: den løbende scoring ER tilsigtet (fx et 3-årigt mål om 15 etapesejre giver et delmål på 5 efter år 1, og over/under det ændrer bestyrelsens tilfredshed løbende). Men tidlig-opfyldelse er slet IKKE håndteret — spilleren får ingen bonus og kan ikke forhandle, systemet kører bare uændret videre til planens år er gået. Sæson 2 er i gang nu, så manglen er allerede aktiv for spillere med flerårige mål.

- **A) Simpel engangsbonus ved 100%-tidlig-opfyldelse: én gang CZ$-udbetaling + et løft i bestyrelsestilfredshed når et flerårigt mål er opfyldt fuldt ud før tid. Ingen genforhandling — spilleren fortsætter resten af perioden på det opfyldte mål. ← anbefalet**
- B) Genforhandling: spilleren kan bytte et tidligt-opfyldt mål til et nyt/skarpere mål med højere payout ved planens udløb. Mere motiverende, men kræver ny UI (målvalg midt i en flerårsplan) og mere logik — betydeligt større opgave.

_Hvorfor A: A lukker hullet hurtigt uden ny UI — vigtigt fordi sæson 2 allerede kører med denne mangel live. B er mere spændende design, men bør vente til vi har data om hvor ofte tidlig opfyldelse faktisk sker. At lade det stå helt uændret risikerer at føles uretfærdigt for spillere der performer godt._

### [#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332) — Hvem overtager 'Fase 4'-driftsopgaven fra det nedlagte Manus-abonnement?

Issuet står stadig registreret med 'Manus' som ejer i selve teksten, men Manus-abonnementet blev opsagt i juni. Alt det reelle arbejde er allerede leveret af Claude: en incident-runbook, en cost-model, og en fungerende backup+restore-pipeline (senest kørt 18/6: 68 tabeller, 225.046 rækker, restore bevist med 0 afvigelser). Den eneste tilbageværende del er en 'rigtig' live-øvelse hvor man gendanner til et separat Supabase-projekt — første forsøg (15/5) strandede fordi produktion dengang kørte på gratis Supabase-tier uden backups/PITR. Det problem er løst siden (I opgraderede til Supabase Pro 10/6), så en ny øvelse kunne gennemføres nu — men den er ikke booket.

- **A) Ryd 'Manus'-ejerskabet op (registrér Claude/dig som reel ejer, da arbejdet allerede er lavet), og accepter den eksisterende backup-restore-verifikation (18/6, 0 afvigelser) som tilstrækkeligt bevis — luk issuet uden en ekstra live cross-projekt-øvelse. ← anbefalet**
- B) Samme oprydning af ejerskab, men book en dato hvor Claude gendanner produktion til et helt nyt Supabase-projekt (nu muligt med Pro-tier) — en mere realistisk krise-øvelse end den nuværende lokale test. Kræver ca. en times Claude-arbejde og et par minutters check fra dig.

_Hvorfor A: Den eksisterende restore-verifikation beviser allerede det vigtigste: at backup-filerne rent faktisk kan gendannes (0 afvigelser, alle nøgler intakte). En live-øvelse til et nyt projekt tilføjer marginal sikkerhed for en times arbejde og lidt ekstra Supabase-forbrug — ikke værd det for et solo-projekt lige nu. Vigtigste handling er at rydde 'Manus' væk som ejer, så fremtidige audits stopper med at flagge issuet som hængende på et opsagt abonnement._

### [#430](https://github.com/NicolaiDolmer/CyclingZone/issues/430) — Rekruttér 2 frivillige Discord-moderatorer

Issue #430 siger: vent til serveren har ≥50 aktive medlemmer + 4 ugers historik, find så 2 hjælpsomme spillere til moderator-rollen. Jeg tjekkede lige direkte via Discord: serveren har 62 medlemmer i alt (inkl. et par bots) og er 11 uger gammel (oprettet 14/5). Tærsklen ser tal- og tidsmæssigt ud til at være nået — men "aktiv" vs. "bare tilmeldt" kan kun du vurdere, det kan jeg ikke måle herfra.

- **A) Gå i gang nu — kig i #general/#feedback-and-ideas efter 2 spillere der allerede hjælper uformelt, DM dem med moderator-charteret der allerede er skrevet i issuet, book en 30-min onboarding-samtale hver. ← anbefalet**
- B) Vent stadig — 62 tilmeldte er ikke det samme som 62 aktive, og du vil se mere organisk aktivitet før du giver nogen en rolle.

_Hvorfor A: Tærsklen (50 medlemmer, 4 uger) er opfyldt både i tal og tid, og at rekruttere nu frigør din tid til det der reelt brænder (fx anti-cheat #3131) i stedet for at du selv skal svare på alt i Discord._

### [#680](https://github.com/NicolaiDolmer/CyclingZone/issues/680) — Luk TdF-launch-epic'en — kun ét under-issue mangler nu

23/7 sagde du at #680 ikke skulle lukkes før (1) den var omskrevet fra "kampagne op til en dato" til "løbende markedsføring", og (2) de 3 åbne under-issues havde fået et nyt hjem. Jeg tjekkede GitHub direkte i dag: der er nu kun ÉT åbent under-issue tilbage (#671, brand-minimum: farve/font/wordmark) — de to andre (inkl. #677) er lukket siden. #671 er desuden slet ikke tidsbundet til TdF længere — det er blevet jeres løbende UI-brand-oprydning (senest opdateret 19/7, koordineret med #2666+#481, 57 sider tilbage).

- **A) Gør det nu: jeg omskriver #680's tekst til en kort "løbende marketing-motion"-note (beholder UTM-konvention + kanal-kalender som du selv pegede på som genbrugelige), kobler #671 fri af epic'en (fortsætter uændret som sin egen opgave), og lukker #680. ← anbefalet**
- B) Vent til #671 også er helt færdig, og tag rewrite-beslutningen samlet på det tidspunkt.

_Hvorfor A: #671 har reelt intet med TdF-datoen at gøre længere — det er allerede sin egen levende brand-opgave. At holde epic'en åben for dens skyld er bare navnestøj i backloggen; at koble den fri og lukke epic'en nu er præcis den pointe du selv lavede 23/7 om dato-bundne kampagner._

### [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) — Rotér Supabase service-nøglen (sikkerhedshygiejne)

Service-nøgle-rotationen har hængt siden mindst 3 hændelser (#296, #620, en lækage til en transcript 30/5-2026) — nøglen ligger stadig spredt på 5 steder (Supabase, Infisical dev+prod, Railway, 8 GitHub Actions-workflows, lokal backend/.env). Seneste kontrol (via PR #872) fandt STADIG den gamle nøgle i flere gitignored env-filer. Ingen kendt aktiv lækage lige nu, men synk-scriptet og Infisical-forberedelsen er allerede bygget — det eneste der mangler er ét klik fra dig i Supabase-dashboardet.

- **A) Gør det nu: Supabase-dashboard → API keys → regenerér service_role-nøglen (sb_secret_*-format) → paste den ét sted i Infisical (prod) → sig til, så synker jeg den automatisk ud til Railway/dev/GitHub Actions med scriptet der allerede er bygget til formålet. ← anbefalet**
- B) Lad den stå — ingen kendt aktiv lækage, så det haster ikke akut; men nøglen er nu flagget 4 gange på tværs af sessioner uden rotation, og eksponeringsfladen (gamle env-filer, worktrees) vokser stille.

_Hvorfor A: Handlingen er ét klik + én paste — resten er allerede automatiseret. At udskyde en 2-minutters sikkerhedsopgave, der er dukket op 4 gange, er den slags "lille ting" der en dag bliver et rigtigt problem._

### [#720](https://github.com/NicolaiDolmer/CyclingZone/issues/720) — Kryptér disken på DolmerPC (pc'en med adgang til alle produktions-hemmeligheder)

DolmerPC er den bærbare der har login til Infisical (henter alle prod-hemmeligheder), Vercel/Railway-deploy-nøgler og snart betalingsdata via Alunta. Disken er ikke krypteret i dag — det automatiske tjek kunne ikke afgøre status (BitLocker-kommandoen fejlede), men maskinen kører Windows 11 Home, så det er 'Enhedskryptering' (ikke fuld BitLocker) du skal have fat i. Tager ca. 10 minutter.

- **A) Slå kryptering til nu: Indstillinger → Privatliv og sikkerhed → Enhedskryptering → Slå til. Gem recovery-nøglen i din password manager (ikke i klartekst på maskinen). ~10 min, lukker hullet permanent. ← anbefalet**
- B) Udskyd — men så kører maskinen videre med adgang til ALLE prod-secrets uden nogen beskyttelse hvis den bliver stjålet eller væk. Der er ingen god grund til at vente.

_Hvorfor A: 10 minutters arbejde lukker det sidste sikkerhedshul på den maskine der har nøglerne til hele produktionen. Ingen reel ulempe ved at gøre det nu._

### [#738](https://github.com/NicolaiDolmer/CyclingZone/issues/738) — McAfee eller Windows Defender — hvilket skal beskytte din pc?

Din pc har McAfee installeret (antivirus + WebAdvisor-browserudvidelse), og Windows' egen beskyttelse (Defender) står inaktiv fordi McAfee har overtaget. Samme maskine har adgang til alle produktions-hemmeligheder (jf. #720), så valget har reel betydning — ikke kun personlig smag.

- **A) Afinstallér McAfee (inkl. WebAdvisor-udvidelsen), kør på Defender — indbygget, gratis, intet abonnement der kan udløbe stille og efterlade dig ubeskyttet. WebAdvisor er desuden kendt for at proppe ekstra reklame-tracking ind i browseren. ← anbefalet**
- B) Behold McAfee hvis du aktivt betaler for og stoler på det — men så skal du selv sikre dig at abonnementet ikke er en udløbet trial der viser 'grønt' uden reelt at beskytte noget.

_Hvorfor A: Defender er indbygget, tester på niveau med McAfee i uafhængige tests, og fjerner både en tikkende trial-udløbsbombe og en uønsket browserudvidelse. Færre ting at holde styr på på en maskine med adgang til alle hemmelighederne._

### [#941](https://github.com/NicolaiDolmer/CyclingZone/issues/941) — Regnskabsprogram: valget er truffet (Dinero) — mangler kun selve opsætningen

Du valgte Dinero 4/6 og oprettede kontoen 11/6. Siden da er både CVR-registreringen (#407) og Alunta-betalingsflowet (#673) lukket og live. Det eneste der mangler er at sætte moms/kontoplan op i Dinero og koble det til CVR-nummeret og de betalinger der allerede kan komme ind via Alunta — en ren login-opgave i Dinero, som kun du kan gøre.

- **A) Log ind på Dinero nu og sæt moms + kontoplan op + kobl CVR/Alunta (ca. 30-60 min). Undgår at bogføring hober sig op mens Alunta allerede kan modtage betalinger. ← anbefalet**
- B) Vent til der er konkret omsætning at bogføre — men da Alunta har været live siden juli, risikerer du at samle et efterslæb op der er sværere at rydde op i bagefter.

_Hvorfor A: Alunta kan allerede modtage betalinger, og jo længere bogføringen venter, jo mere skal ryddes op bagud. Opgaven er hurtig og kun du kan udføre den (login-krav)._

### [#1276](https://github.com/NicolaiDolmer/CyclingZone/issues/1276) — Skal vi rense Git-historikken for filen med 8.699 rigtige rytternavne?

Filen scripts/WORLD DB 2026 Dyn_Cyclist.xlsx med 8.699 rigtige rytternavne fra Pro Cycling Manager (tredjeparts-IP) ligger ikke længere i repoets nuværende filtræ — det har jeg lige verificeret. Men den ligger stadig fuldt læsbar i git-historikken, og repoet er offentligt læsbart selvom koden er closed-source. Du besluttede allerede 11/6 at rense historikken (git filter-repo/BFG + koordineret force-push på tværs af klones/worktrees/åbne PR'er), men det er ikke sket endnu — 7 uger senere venter opgaven stadig.

- **A) Kør oprydningen nu i én dedikeret session (ingen natbølge/parallel session aktiv samtidig): historikken renses permanent, men alle aktive klones/worktrees skal re-klones bagefter. ← anbefalet**
- B) Accepter status quo videre — filen bliver i historikken, tredjeparts-IP-eksponeringen forbliver, men intet forstyrrer igangværende arbejde.

_Hvorfor A: Beslutningen er allerede truffet — det eneste der mangler er at sætte tid af. Jo længere den ligger, jo flere klones/worktrees skal koordineres senere, så gør det nu mens oprydningen stadig er overskuelig._

### [#1407](https://github.com/NicolaiDolmer/CyclingZone/issues/1407) — 15 minutters opsætning: gør SEO-måledata troværdige

GA4, Search Console og Bing er sat op, men nogle indstillinger mangler stadig — bl.a. om 'Page changes based on browser history events' er slået til i GA4. Er den ikke det, tæller spillet kun ét sideview pr. besøg (fordi appen er en SPA), og de tabte tal kan ikke rettes bagefter, kun fremadrettet. Derudover mangler Ahrefs-verificering og en kort ejerskabs-doc for hvilket værktøj der er 'sandheden' for hvad.

- **A) Brug de ~15 minutter nu: slå Enhanced Measurement til i GA4, sæt retention til 14 måneder, link GSC, verificér Ahrefs. Al data fra i dag og frem bliver pålidelig. ← anbefalet**
- B) Vent til efter S2 som oprindeligt planlagt. Hver dag der går uden korrekt opsætning er data der aldrig kan hentes tilbage — ikke kun en forsinkelse.

_Hvorfor A: Måle-fejl her er ikke til at rette bagefter, i modsætning til de fleste andre ejer-beslutninger. 15 minutter er billigt nok til at klare nu i stedet for at vente til efter S2 og miste flere ugers baseline-data._

### [#1461](https://github.com/NicolaiDolmer/CyclingZone/issues/1461) — Test din egen signup-mail, så vi kan stramme spoofing-beskyttelsen

DMARC har kørt i ren overvågningstilstand (p=none) siden 18/6 — seks uger uden reel beskyttelse mod at nogen forfalsker afsendere fra @cyclingzone.org. For at stramme til p=quarantine skal vi først vide at Resend-mails rent faktisk lander korrekt hos en almindelig modtager (fx Gmail) — ellers ryger login/reset-mails i spam og låser testere ude.

- **A) Lav en testtilmelding på cyclingzone.org nu med en gmail-adresse du selv tjekker, og bekræft at bekræftelses-mailen lander i Indbakken (ikke Spam). Tager 2 minutter — så kan DMARC flyttes til p=quarantine samme uge. ← anbefalet**
- B) Vent — behold p=none videre. Ingen ny risiko for testerne, men @cyclingzone.org forbliver forfalskeligt uden begrænsning indtil du tester.

_Hvorfor A: Det er en 2-minutters handling der låser en sikkerhedsforbedring op uden downside — jo længere p=none står, jo længere er domænet åbent for spoofing uden nogen reel gevinst ved at vente._

### [#1784](https://github.com/NicolaiDolmer/CyclingZone/issues/1784) — Sæt et budget-loft op i Vercel før I markedsfører bredere

CyclingZone er på Vercel Pro, som fakturerer ekstra hvis I overstiger 1 TB datatrafik eller 10 millioner sidekald/måned. I er på vej til at markedsføre til flere spillere, hvilket kan give en pludselig trafik-spike. Vercel har en indbygget budget-alarm ('Spend Management'), men jeg kan ikke sætte den op selv — det kræver login i jeres Vercel-dashboard, og der findes intet AI-værktøj til billing-siden.

- **A) Sæt loftet med KUN besked (mail/Discord ved fx 50/80/100%). Du får varsel ved en spike, men siden lukkes aldrig automatisk. ← anbefalet**
- B) Sæt loftet med auto-pause. Overskrider I loftet, lukker Vercel siden automatisk — stopper en løbsk regning 100%, men kan også slukke sitet midt i en marketing-succes.

_Hvorfor A: I skal netop til at markedsføre bredere — auto-pause kan lukke siden ned præcis når kampagnen virker og trafikken stiger. Start med besked, og skru til auto-pause senere når I kender jeres normale forbrug._

### [#1875](https://github.com/NicolaiDolmer/CyclingZone/issues/1875) — Gør PR-forhåndsvisninger klikbare med testdata (2 Vercel-indstillinger)

I dag kan en PR's automatiske forhåndsvisnings-side ikke bruges rigtigt — den kræver login mod jeres RIGTIGE database, som en forhåndsvisning normalt ikke har adgang til. Det har kostet jer testmuligheder 3 gange før (senest 25/7, hvor en etape-graf kun kunne vises med kunstig data lokalt hos Claude — ikke af dig på et rigtigt preview-link). Løsningen er allerede bygget og klar (#1867 er merged) — 2 indstillinger i Vercel, kun for forhåndsvisninger, rører ikke jeres rigtige side — den mangler bare at blive slået til.

- **A) Slå det til nu: Vercel → projekt cycling-zone → Settings → Environment Variables → scope 'Preview' → tilføj VITE_PREVIEW_MOCK=1 og VITE_SUPABASE_URL=https://preview-mock.invalid. Cirka 2 minutters arbejde, rører ikke produktion. ← anbefalet**
- B) Lad det ligge — fortsæt med at teste nye features via skærmbilleder eller lokalt hos Claude, uden selv at kunne klikke rundt i en rigtig PR-forhåndsvisning.

_Hvorfor A: Billigste fix mod et problem der har ramt jer 3 gange. Ingen risiko for produktion — det er et separat sikkerhedslag der gør det umuligt for en forhåndsvisning at ramme den rigtige database._

### [#1922](https://github.com/NicolaiDolmer/CyclingZone/issues/1922) — Træningsfokus-rework: klar til at bygges, eller vil du læse specen først?

I dag stiger næsten alle evner uanset hvilket træningsfokus du vælger (off-focus-evner vokser 0,97× — næsten lige så meget som det valgte fokus), så valget føles som pynt. Du flaggede det selv i Discord 25/6. Siden er der skrevet en fuld design-spec (11/7, revideret 15-16/7 efter to opfølgende ejer-runder på #2437 og #2486, begge nu lukkede), som besvarer alle de åbne spørgsmål fra dette issue. Trin 1 af rework'et (aldersstraffen der gjorde 19-20-årige 'dødfødte', #2262) er allerede shippet. Specen konkluderer selv direkte: 'Ingen udestående beslutninger blokerer Fase 1-2.' Næste skridt — fokus bliver en ægte trade-off i stedet for næsten-placeholder — kan altså bygges uden nye designvalg fra dig.

- **A) Giv grønt lys nu: sig at Fase 2 må bygges (fokus bliver ægte budget-allokering — vælger du ét fokus, får det al væksten, resten står stille). Ingen nye designvalg krævet, specen er allerede låst. ← anbefalet**
- B) Læs specen selv først (docs/superpowers/specs/2026-07-11-training-youth-depth-design.md, afsnit 3-4, ca. 10 min) og juster retningen hvis du er uenig i noget, før du giver grønt lys.

_Hvorfor A: Specen har allerede været igennem to ejer-godkendte revisionsrunder og Fase 1 er shippet uden problemer — der er intet nyt at tage stilling til, kun en godkendelse der mangler. At vente længere holder blot 'alt stiger uanset valg' kørende for spillerne uden grund._

### [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) — TdF-kampagnen blev aldrig postet — luk den til fordel for den løbende tracker?

Tour de France-kampagnen (3 post-udkast, creator-liste, UTM-plan, 7-dages kalender) blev skrevet klar til 4.-10. juli, men blev aldrig postet, og tidsvinduet inkl. uge-2-beats (14/7 og 21/7) er passeret. Du besluttede selv 23/7 at markedsføring skal være løbende frem for bundet til bestemte datoer — det gør denne type 'kampagne-op-til-dato-X'-issue forældet i sin nuværende form. Der findes allerede et åbent issue (#2236, 'Organic community outreach') som er sat op præcis som en løbende tracker med checkbokse og resultat-log — det virker som det naturlige hjem for arbejdet fremover.

- **A) Luk #2080 og flyt det genbrugelige (UTM-konventionen + kanal-kalenderen) ind i #2236 som en del af den løbende tracker. Ét sted at holde styr på markedsføring fremover, intet duplikeret. ← anbefalet**
- B) Behold #2080 som sit eget issue, men omskriv det fra 'TdF-kampagne' til en generel løbende markedsføringstracker, adskilt fra #2236.

_Hvorfor A: #2236 er allerede bygget som den løbende tracker (checkbokse, resultat-log, faste regler for tone og UTM) — at holde to parallelle 'løbende markedsføring'-issues åbne skaber bare forvirring om hvor status reelt er._

### [#2176](https://github.com/NicolaiDolmer/CyclingZone/issues/2176) — Auto-auktion på transferlisten: hvad sker der hvis ingen byder videre i de 30 minutter?

Du har allerede besluttet på Discord (15/7): sælger sætter en udbudspris og en højere "auto-accept"-pris; rammer en køber auto-accept-prisen, starter automatisk en 30-minutters åben auktion for alle andre hold. Det sidste hul før koden kan bygges færdig: hvad sker der, hvis ingen byder yderligere i de 30 minutter efter den udløsende bud?

- **A) Det udløsende bud vinder automatisk, hvis ingen overbyder inden tiden er gået — som en almindelig engelsk auktion, hvor højeste bud ved deadline vinder. Garanterer salget til den køber, der satte gang i auktionen. ← anbefalet**
- B) Auktionen kræver mindst ét ekstra bud for at gennemføre et salg. Ingen ekstra bud betyder intet salg, og rytteren lander tilbage på almindelig transferliste-listing.

_Hvorfor A: Den spiller der rammer auto-accept-prisen har afgivet et reelt, seriøst bud. At lade auktionen bortfalde uden salg straffer den mest engagerede køber uden grund — en garanteret vinder ved deadline er også standarden i rigtige engelske auktioner._

### [#2452](https://github.com/NicolaiDolmer/CyclingZone/issues/2452) — Skal det koste gebyr at sætte en rytter til salg for over 50% af hans værdi?

Du har bedt om et konkret gebyr-forslag for at stoppe useriøse "fantasi-priser" på transferlisten. I dag koster det intet at liste en rytter til enhver pris, hvilket fylder markedet med annoncer der aldrig sælger (relateret til #2400). Der findes ingen eksisterende model at bygge videre på — nedenfor to konkrete forslag.

- **A) Progressivt gebyr på den del af prisen der ligger over 50% af rytterens værdi (fx 10% af det overskydende beløb) — betales med det samme, når annoncen oprettes, uanset om rytteren rent faktisk sælges. Jo mere urealistisk prisen er, jo dyrere. ← anbefalet**
- B) Fast gebyr (skaleret efter rytterens værdi), som udløses hvis prisen overstiger 50%-grænsen — samme beløb uanset om man er 1% eller 500% over grænsen.

_Hvorfor A: A rammer hårdest de mest urealistiske annoncer (dem der reelt skaber markeds-støj) og er billigt for hold der bare ligger lidt over grænsen. B straffer en lille overskridelse lige så hårdt som en helt vanvittig pris — det matcher ikke det formål, du selv beskrev._

### [#2454](https://github.com/NicolaiDolmer/CyclingZone/issues/2454) — Potentiale på 1-99-skala: godkend de sidste detaljer, så byggeriet kan starte

Du har allerede besluttet (15/7): potentiale bliver 1-99 i databasen ligesom alle andre tal i spillet, men spilleren ser aldrig det ægte tal — kun talentspejderens usikre gæt, som gerne må være upræcist OG forskudt fra sandheden (fx en rytter med sandt potentiale 77 kan estimeres til "70-80" eller skævt til "75-85"). Det sidste, der mangler før koden kan bygges, er godkendelse af 3 mindre tekniske detaljer i selve estimat-modellen.

- **A) Godkend de foreslåede standardvalg nu, og lad byggeriet gå i gang: forskydningen trækkes tilfældigt (oftest tæt på sandheden, sjældnere skævt, aldrig "håbløst forkert"); intervalbredden styres af spejderens kvalitet + hvor meget rytteren er spejdet + rytterens alder; samme spejder giver samme estimat igen (kan ikke "reroll'es" frem til facit). ← anbefalet**
- B) Vent med at bygge til talentspejder-systemet (#1138) er mere udviklet, fordi nogle af parametrene (spejderkvalitet, uenighed mellem spejdere) reelt hænger sammen med det system — design begge samlet, når #1138 er klar.

_Hvorfor A: Kerne-beslutningen (1-99 med et usikkert, evt. skævt spejder-estimat) ligger allerede fast. At vente på et fremtidigt spejder-system er at lade en lille feature gidsel-tage en anden — fornuftige standardværdier kan sættes nu og finjusteres senere, når #1138 modnes._

### [#2645](https://github.com/NicolaiDolmer/CyclingZone/issues/2645) — Ryttere topper for tidligt (22 år) — skal toppen rykkes til 25-26?

To spillere (thelamba, smukkethomsen) klagede uafhængigt 18/7 over at 20-årige verdensklasse-talenter allerede 'nærmer sig deres loft' — kun 1-2 år med udvikling før de topper. Selve besked-fejlen (en rytter med evne 29 ud af 90+ fik vist 'nærmer sig loft') er allerede rettet og live (18/7). Tilbage står kernespørgsmålet: skal rytternes faktiske topalder flyttes fra ~22 til 25-26 år? Du skrev selv i tråden at du mindes loftet var 'planlagt til når de er 27 år', og kaldte den tidlige 22-års-effekt 'sjusk fra min side'.

- **A) Godkend at topalderen flyttes til 25-26 (nærmere din oprindelige hensigt om ~27). Claude bygger en empirisk simulering (nuværende kurve vs. senere top) med scorecard for karrierelængde, talent-værdi og markedseffekt, og lægger et konkret forslag frem før noget ændres i produktion. ← anbefalet**
- B) Behold nuværende topalder (~22) — de to spillerklager anses som forvirring fra den nu rettede besked-fejl, ikke et reelt designproblem.

_Hvorfor A: Din egen erindring om designet ('27 år') matcher ikke det spillerne oplever nu (~22), og to uafhængige spillere fandt selv frem til problemet uden at du bad om det — det er et stærkt signal. Simulering før ship holder det sikkert, men retningen bør besluttes nu._

### [#2680](https://github.com/NicolaiDolmer/CyclingZone/issues/2680) — Sluk unødvendige AI-forbindelser i kode-kanalen (sparer ~4.000 tokens/session)

En audit 19/7 fandt at dine kode-sessioner (Cowork/desktop) automatisk loader Ahrefs (~150 værktøjer), Microsoft Clarity, Google Calendar og Google Drive — ingen af dem bruges i kodearbejde — plus ca. 25 marketing-forbindelser der slet ikke er logget ind og derfor er ubrugelige her. Samlet fylder det ca. 4.000 tokens i hver eneste sessions-start. Det kan kun slås fra ved dine egne klik i connector-indstillingerne, ikke fra selve koden.

- **A) Slå Ahrefs/Clarity/Calendar/Drive fra i dev-kanalens connector-indstillinger nu (behold dem evt. i en separat marketing-kanal), og ryd samtidig op i de ikke-loggede-ind forbindelser. Et par minutters klik, sparer tokens i alle fremtidige sessioner. ← anbefalet**
- B) Lad det stå som det er — ingen risiko, men samme overhead fortsætter session efter session fremover.

_Hvorfor A: Ren opsparing uden ulempe — et par minutters klik betaler sig selv tilbage med det samme og for hver eneste session herefter._

### [#2688](https://github.com/NicolaiDolmer/CyclingZone/issues/2688) — Hvilke af 4 nye AI-arbejdsmetoder skal vi afprøve først?

En audit 19/7 foreslår 4 nye måder at bruge Claude på: (1) strengere fund-verifikation hvor flere uafhængige tjek skal godkende før noget rapporteres, (2) dommerpaneler der laver 3 uafhængige designforslag og lader dem konkurrere ved svære balance-beslutninger, (3) styre hvor meget 'tænkearbejde' Claude bruger pr. opgavetype (lidt til mekaniske opgaver, meget til kritiske), (4) flere AI'er der krydstjekker store pull requests som supplement til CodeRabbit. Forfatterens egen anbefaling er at starte med de to billigste.

- **A) Start med de to gratis/lav-risiko håndtag: (3) styr indsats pr. opgavetype med det samme, og (2) prøv dommerpanel-metoden som pilot på én allerede planlagt, afgrænset balance-beslutning (#2645B). ← anbefalet**
- B) Skru bredere op med det samme: sæt også (1) den fulde verifikations-pipeline til natbølger/audits og (4) multi-agent-review på store PR'er i gang parallelt. Bredere effekt hurtigere, men væsentligt dyrere pr. kørsel og sværere at fejlsøge når flere nye metoder kører samtidig.
- C) Afvis alle fire lige nu — behold det nuværende flow. Ingen ny omkostning eller kompleksitet, men heller ingen af de foreslåede kvalitetsgevinster.

_Hvorfor A: De to billige håndtag koster stort set ingenting og lærer os om metoderne virker, før vi binder os til de dyrere i stor skala._

### [#2798](https://github.com/NicolaiDolmer/CyclingZone/issues/2798) — Kan man regne sig til en ung rytters skjulte potentiale bare ved at se prisen?

Efter værdimodel-opdateringen 18/7 hænger en ung rytters markedsværdi direkte sammen med hans skjulte potentiale: to 18-årige med samme synlige evner, men forskelligt potentiale, får forskellig pris. I stedet for at scoute kan man altså bare sortere ryttere efter pris og se hvem der er talentet. To spillere har allerede opdaget og nævnt det i Discord (22/7). Det underløber scouting-usikkerheden I byggede og hærdede to gange (#1138, #1162).

- A) Tåg selve værdien for u-scoutede unge ryttere — vis et interval der indsnævres i takt med scouting, ligesom potentiale-estimatet i dag. Bevarer prisen som en del af gætte-legen, men kræver at prisen bliver personlig per manager (ligesom potentiale-estimatet), hvilket er et stort teknisk indgreb i auktioner, transferliste, watchlist, løn og AI-bud.
- **B) Regn en offentlig 'synlig værdi' kun ud fra alder, type og nuværende evner — potentiale indgår slet ikke i det tal spillerne ser. Den fulde værdi (med potentiale) bruges stadig internt til AI-bud og løn. Enklere og sikrere, fordi lækagen bliver umulig by design i stedet for noget der skal tætnes bagefter mange steder. ← anbefalet**

_Hvorfor B: B kan strukturelt ikke lække, fordi potentiale aldrig indgår i det tal spilleren ser. A kræver at gøre en global pris personlig og usikker per manager — langt mere kompliceret, og med flere steder hvor et nyt hul kan opstå, præcis den fejltype vi lige har fundet. Scouting-mekanikken lever videre fuldt intakt i potentiale-estimatet, den skal bare ikke duplikeres i prisen._

### [#2826](https://github.com/NicolaiDolmer/CyclingZone/issues/2826) — 7 ud af 161 nye brugere udfyldte hele tilmeldingen, men kom aldrig ind — faldt på e-mail-bekræftelsen

4,3% (7 af 161) af alle brugere har udfyldt hele tilmeldingen — inklusive holdnavn — men bekræftede aldrig deres e-mail og kom derfor aldrig ind i spillet. Alle 7 er fra de seneste 30 dage. Med 134 nye brugere på 30 dage svarer det til at vi taber cirka én motiveret spiller om ugen på et trin der ikke skaber værdi for dem — det er ikke tilfældige besøgende, de nåede hele vejen til sidste skridt.

- A) Fjern e-mail-bekræftelseskravet helt (Supabase kan tillade login uden bekræftelse) og bed om bekræftelse senere, når brugeren har en grund til at ville beholde sin konto. Fanger flest af de tabte spillere, men svækker et af de signaler vi bruger mod multi-konto/spam (#2776, #2226).
- **B) Behold kravet, men gør det lettere at komme igennem: tydeligere besked om hvor mailen er sendt hen, en synlig 'send igen'-knap, og en påmindelse et par timer efter (kræver at email_loop_enabled slås til). Bevarer fair-play-signalet fuldt ud, men fanger formentlig ikke alle 7 — nogle mails ryger i spam uanset UX. ← anbefalet**

_Hvorfor B: Én tabt spiller om ugen er et reelt, men lille lækage i en ellers velfungerende tragt — det er ikke stort nok til at ofre en fair-play-kontrol I byggede med vilje. Prøv den billige, reversible fix (bedre UX + påmindelse) først; falder tallet ikke efter et par uger, er der stadig belæg for at tage den hårdere vej A derefter._

### [#2856](https://github.com/NicolaiDolmer/CyclingZone/issues/2856) — Skal fejlagtigt uddelte holdklassement-point/præmier rettes bagudrettet?

En bug (allerede rettet fremadrettet) lod hold med under 3 gennemførende ryttere vinde holdklassementet. Bekræftet eksempel: "Wander Riders" vandt Tour de la Loire med kun 1 gennemført rytter og fik 53 point — foran 15+ hold der havde 6 gennemførende ryttere. Vi ved endnu ikke hvor mange løb der samlet er ramt. At rette det betyder at ændre allerede uddelte point og præmiepenge — en destruktiv handling du selv skal godkende, med en før/efter-liste at se på først.

- A) Kun fremad — historiske fejl (som Wander Riders-sagen, og eventuelt flere) står uændret; kun fremtidige løb er korrekte.
- **B) Fuld genberegning — jeg scanner alle historiske løb for hold der vandt uretmæssigt, laver en dry-run-liste (løb, hold, point/penge før og efter), du godkender listen, og så retter jeg. ← anbefalet**

_Hvorfor B: Med kun 41 aktive spillere om ugen er en synligt uretfærdig sejr som Wander Riders' noget spillerne lægger mærke til og husker — konkurrenceintegritet er værd at rette, og en dry-run-liste giver dig fuld kontrol før noget rent faktisk ændres._

### [#2877](https://github.com/NicolaiDolmer/CyclingZone/issues/2877) — Etape-data gået tabt ved 19 etaper — skal koden strammes op, og skal de repareres?

Når en etape kører, kan et efterfølgende databasekald (stillings-genberegning) time out fordi tabellen er vokset til 458.553 rækker. Når det sker, går rytternes køre-forløb, øjeblikke og styrt/uheld tabt for evigt for den etape — selvom resultater og præmier forbliver korrekte. Det er sket 19 gange i 14 løb. En anden rettelse (merged 25/7) gør det sjældnere fremover, men reparerer hverken de 19 allerede ramte etaper eller den underliggende sårbarhed i koden. To ting mangler beslutning: (1) skal koden strammes op så en fejlet stillingsberegning ikke kan rive etape-data med sig, og (2) skal de 19 etaper genskabes.

- **A) Kun arkitektur-fix (3 linjer, samme mønster resten af koden allerede bruger) — forhindrer gentagelse; de 19 etaper forbliver uden køre-forløb (kosmetisk hul på 2,6% af sæsonens etaper, ingen point eller penge påvirket). ← anbefalet**
- B) Arkitektur-fix plus gensimulering af de 19 etaper for at genskabe data — kræver forsigtig re-simulering der ikke må røre allerede udbetalte resultater; mere arbejde og reel risiko for lille gevinst.

_Hvorfor A: Fixet er billigt og risikofrit (matcher et mønster koden allerede bruger andre steder); de 19 tabte etaper er et rent kosmetisk hul uden effekt på point eller præmier — ikke værd at røre resultat-motoren for._

### [#2887](https://github.com/NicolaiDolmer/CyclingZone/issues/2887) — Gør sportsdirektørens 'senior-træning' meningsfuld — eller skær den væk

En spiller spurgte i Discord om senior-træningsstatten på sportsdirektøren overhovedet bremser rytteres aldersfald efter 26 år. Ingen ved svaret — heller ikke flere andre spillere der har spurgt samme sted i samme uge. Samtidig er udvalget af sportsdirektører så lille, at man tvinges til at ansætte nogen man ikke vil have. Ingen har endnu tjekket motorkoden for om statten reelt gør noget.

- **A) Claude undersøger motorkoden nu (billigt, kræver ingen af din tid) — virker statten intet, fjernes/forklares den i UI/hjælp; virker den, gøres effekten synlig. Samtidig udvides SD-udvalget denne måned, så ansættelse bliver et reelt valg. ← anbefalet**
- B) Lad issuet ligge i backlog til en roadmap-slot åbner. Spillerforvirringen fortsætter, men intet er reelt i stykker lige nu.

_Hvorfor A: Kode-tjekket koster stort set ingenting og afklarer om det er en tekst-fix eller en balance-opgave; spillerforvirringen er allerede dokumenteret 3 gange i Discord på én uge._

### [#2900](https://github.com/NicolaiDolmer/CyclingZone/issues/2900) — Sæt en volumen-alarm op i Sentry, så ét job ikke kan brænde kvoten igen

Et enkelt fejlende job brændte 11.992 events på ét døgn — 98% af 90 dages samlede Sentry-volumen — uden at nogen alarm reagerede på selve mængden (kun på nye fejltyper). Kodedelen af fixet er merged og testet (PR #2996, 4520/4520 tests grønt): jobbet kan ikke længere spamme på samme måde. Det sidste stykke — en alarm hvis det sker igen, plus evt. Sentry's indbyggede spike-beskyttelse — kræver klik i Sentry's UI, som ikke kan laves fra kode.

- **A) Opret en metric-alert i Sentry (Alerts → Create Alert → Metric Alert, betingelse ">200 events/time" på cyclingzone-projektet, samme Discord-modtager som den eksisterende fejl-alarm) + slå Spike Protection til under Settings hvis din plan har den — cirka 10 minutter samlet. ← anbefalet**
- B) Spring Spike Protection over (kan kræve plan-opgradering) og lav kun metric-alarmen — koden forhindrer allerede selve gentagelsen, så dette er et ekstra sikkerhedslag, ikke en nødvendighed.

_Hvorfor A: Kode-guarden fjerner den akutte risiko, men uden en alarm på selve mængden opdager du stadig ikke et nyt tilfælde før skaden er sket; 10 minutter nu er billig forsikring mod at miste hele overvågningen på ét døgn igen._

### [#2906](https://github.com/NicolaiDolmer/CyclingZone/issues/2906) — Mit Hold: sidste løft (gruppering, form, holdgennemsnit) kræver en designsnak

Du bad om et generelt løft af Mit Hold-siden 25/7. 3 af 4 punkter er allerede leveret (alle 15 evner synlige samtidig, rating-kolonne, lavere rækker — PR #2963). Det sidste og efter din egen vurdering mest værdifulde punkt — gruppering af ryttere efter rolle, markering af hvem der er i form/på vej ud af kontrakt, og sammenligning mod holdgennemsnittet — er ikke bygget, fordi det er ny funktionalitet der skal designes sammen med dig først, ikke bare implementeres.

- **A) Book en kort designsnak denne måned om de tre elementer (gruppering, form-markering, holdgennemsnit) — vi lander på retning sammen, så det kan bygges i næste slice. ← anbefalet**
- B) Udskyd — behold den flade tabel som den er nu, og tag punkt 4 op en anden gang uden fast tidsramme.

_Hvorfor A: Truppen er den side du besøger oftest, og du kaldte selv dette punkt mest værdifuldt; en kort samtale nu er billig og undgår at issuet bare cirkulerer done→todo igen, som det allerede har gjort én gang._

### [#2944](https://github.com/NicolaiDolmer/CyclingZone/issues/2944) — Styrt: skal et styrt koste hele resultatet, eller kun noget af det?

Flere spillere klagede 20-23/7 over at et styrt lige nu giver nul resultat totalt – uanset hvor langt rytteren var nået. friisisch skrev i #general at hele GC-kampen i division 3 forsvandt med ét styrt. Der er to adskilte klager: (1) styrt føles urimeligt binært – i virkeligheden mister en styrtet rytter typisk kun tid, men fuldfører løbet, og (2) flere styrt/skader er sket tæt på hinanden i samme periode. Intet er ændret i koden endnu; det er et åbent designvalg.

- A) Byg graduerede styrt-udfald (tidstab/skade i stedet for altid nul-resultat) – retter selve urimeligheds-følelsen, men er en balance-følsom ændring der først skal simuleres mod ægte spillerdata; realistisk et sæson 3-projekt.
- B) Behold den binære model, men tjek og evt. rekalibrer hvor tit styrt sker mod virkelige DNF-rater i pro-cykling – hurtig, lav-risiko rettelse af 'for hyppige', men løser ikke oplevelsen af at ét styrt kan afgøre en hel sæson.
- **C) Begge: kør frekvens-tjekket nu (lav risiko, hurtigt), og sæt graduerede styrt-udfald på roadmap til sæson 3 med sim-harness før det bygges. ← anbefalet**

_Hvorfor C: Frekvens-tjekket er billigt og kan berolige spillerne hurtigt uden at røre balance for alvor. Den store ændring – graduerede udfald – er den rigtige retning for en verdensklasse-følelse, men er for stor og balance-følsom til at rushes midt i en aktiv sæson; den hører til den næste gennemgang af løbsmotoren (#2768)._

### [#3049](https://github.com/NicolaiDolmer/CyclingZone/issues/3049) — Skal endagsløb (klassikere) have samme fulde taktikpanel som etapeløb?

En spiller (thelamba) bad 25/7 i Discord om at kunne styre roller og indsats pr. rytter i endagsløb, ligesom man allerede kan i etapeløb – i dag vælger spilmotoren selv hvornår ryttere skal ofre sig for en kaptajn, uden spilleren kan gribe ind. Ekstra relevant nu fordi bjergklassikere lige er kommet i division 2 og 3 (patch 23-24/7), så endagsløb ikke længere bare er en spurt-affære. Motoren understøtter allerede rolle-styring (samme datamodel, race_stage_roles) – det er kun UI'et der mangler for endagsløb.

- **A) Byg hele taktikpanelet til endagsløb (kaptajn + free-role + indsats) – genbruger eksisterende motor 1:1, giver spilleren fuld kontrol og samme mentale model på tværs af løbstyper. ← anbefalet**
- B) Byg kun free-role-delen (indsats-valg), uden kaptajn-styring – mindre UI-arbejde, men løser ikke thelambas kerneønske (retten til selv at vælge hvem der ofrer sig) og skaber en ny særregel at forklare i hjælp.

_Hvorfor A: Motoren understøtter det allerede, så ekstra-arbejdet er UI, ikke ny spillogik. Et halvt panel (B) skaber endnu en særregel spillerne skal lære, og giver dem stadig ikke det de rent faktisk bad om._

### [#3096](https://github.com/NicolaiDolmer/CyclingZone/issues/3096) — Skal rytterform nulstilles ved sæsonskifte, ligesom træthed allerede gør?

En spiller opdagede 27/7 at rytternes form (præstationsniveau) fulgte uændret med fra sæson 1 til sæson 2, mens trætheden korrekt blev nulstillet. Ingen har nogensinde besluttet dette — form blev bevidst holdt udenfor trætheds-projektet (#2910). Prod-tal for 2.669 menneskehold bekræfter: fatigue er pænt nulstillet (gennemsnit 5,5), men form er bredt spredt (gennemsnit 45,4, stddev 35,5) — altså rå S1-slutdata båret direkte videre. Bør afklares før S2→S3-skiftet 23/8.

- A) Behold nuværende adfærd: form bæres uændret over til næste sæson, ingen kodeændring — dokumentér det som et bevidst valg og forklar det i FAQ.
- **B) Dæmp form mod neutral (50) ved sæsonskifte, samme princip som træthed — kræver en lille dry-run-test mod rigtige S1-data først (samme proces som #2910), men giver alle et friskere, mere fair udgangspunkt hver sæson. ← anbefalet**

_Hvorfor B: Et sæsonskifte bør føles som en frisk start for alle; hvis form fra en tilfældig S1-fase hænger permanent ved, straffer det urimeligt nye/uheldige spillere ind i S2. Ændringen er billig at teste og passer ind i den proces I allerede bruger til balance-valg._

### [#3130](https://github.com/NicolaiDolmer/CyclingZone/issues/3130) — Spillere der forlader Discord-serveren tror stadig de får beskeder

Når en spiller forlader vores Discord-server, kan botten ikke længere sende DM'er til dem (Discord-fejl 50278: 'no mutual guilds'), men appens indstillinger viser stadig 'Discord tilsluttet'. Lige nu er det kun 1 tilfælde på 12 timer, men det er permanent og selv-forstærkende — hver spiller der forlader serveren bliver hængende for evigt, uden at nogen (spiller eller dig) får besked.

- **A) Auto-afkobl efter 3 permanente fejl på samme bruger — nulstil Discord-forbindelsen og vis 'Discord frakoblet — genforbind for at få beskeder'. Selv-helende, kræver en lille tæller + UI-tekst. ← anbefalet**
- B) Kun markér med et flag og en advarsel i indstillingerne, men lad koblingen stå — mindre kode, men spilleren skal selv opdage advarslen.
- C) Gør intet ved den enkelte bruger, tilføj kun en samlet Sentry-alarm hvis antallet vokser — billigst, men løser ikke spillerens oplevelse af at appen 'ikke virker'.

_Hvorfor A: Lav volumen i dag, men det er en stille, selv-forstærkende fejl der ligner en app der ikke virker for den ramte spiller — netop den slags der koster fastholdelse. Auto-afkobl er billigt at bygge og fjerner problemet permanent._

### [#3140](https://github.com/NicolaiDolmer/CyclingZone/issues/3140) — Skal der være en fridag mellem sæsonerne?

Sæsonen slutter søndag aften, næste starter mandag morgen — spillerne har reelt kun mandag formiddag til at planlægge hele den nye sæson (opstilling, sponsorvalg, kontrakter). Flere spillere har klaget i Discord ('kun mandag morgen føles ikke godt'). Det ramte samme uge som S1→S2-overgangen gav problemer (planner viste forkert kalender, #3018). Næste sæsonslut er 23/8, så en ændring skal være klar inden da.

- **A) Indfør 1 dags 'off-season'-buffer: kalenderen for næste sæson er synlig og planneren virker, men ingen løb køres den dag. AI-motorerne pauser. Koster: sæsonstart rykker 1 dag for alle. ← anbefalet**
- B) Behold nuværende hurtige overgang (ingen ekstra dag), men gør næste sæsons kalender/planner synlig allerede lørdag/søndag inden den gamle sæson faktisk slutter — mindre indgribende, ingen forsinkelse, men mindre luft til at handle.

_Hvorfor A: En dags luft mellem sæsoner er lavt-risiko, høj-værdi retention-arbejde — det løser rod-årsagen (ingen tid til at planlægge), ikke kun symptomet. Test det til 23/8-skiftet._

### [#3147](https://github.com/NicolaiDolmer/CyclingZone/issues/3147) — Skal sponsorpenge udbetales løbende i stedet for én sum ved sæsonslut?

Spillere ser sponsorpenge fra afviklede løb, men opdager at pengene tilsyneladende først udbetales ved sæsonens afslutning — flere har klaget i Discord, og det er et af ugens top-3 spillerønsker. Point og præmiepenge udbetales allerede løbende; sponsorpenge gør ikke, hvilket opleves uigennemsigtigt.

- **A) Skift til løbende udbetaling pr. kørt race-day, så det matcher point og præmiepenge. Løser rod-problemet og giver bedre feedback-loop + likviditet gennem sæsonen. Er en økonomi-ændring og skal køre gennem en balance-simulation før den shippes, jf. vores faste regel for balance-følsomme systemer. ← anbefalet**
- B) Behold klumpsum ved sæsonslut, men gør kadencen tydelig i UI/hjælp ('sponsorpenge optjenes nu, udbetales ved sæsonslut' + fremdrifts-indikator). Billig fix af forvirringen, men giver ikke spillerne den likviditet gennem sæsonen de faktisk beder om.

_Hvorfor A: Konsistens med point/præmiepenge er bedre spildesign og løser det spillerne rent faktisk efterspørger, ikke kun forvirringen om det. Kræver en balance-simulation før ship, men det er allerede vores standardproces for økonomi-ændringer._

### [#3152](https://github.com/NicolaiDolmer/CyclingZone/issues/3152) — Skal omdømme tages ud af sæsonslut-bonussen indtil den er synlig og retfærdig?

En spiller er bekymret for at bestyrelsens omdømme-mål trækker en eventuel sæsonslut-bonus ned, muligvis pga. en fejl i optællingen — du bad selv om at få det skrevet ned. Det hænger sammen med #2723 (42 ud af 67 hold har omdømme-mål de hverken kan se eller handle på) og en separat optælle-inkonsistens i bestyrelsens 5-års-plan. Næste sæsonslut, og dermed bonus-beregning, er 23/8.

- **A) Neutralisér omdømme-relaterede board-mål i bonus-beregningen midlertidigt — de tæller hverken positivt eller negativt — indtil #2723 (synlighed) og optælle-fejlen er rettet. ← anbefalet**
- B) Lad bonus-formlen stå som den er, og prioritér i stedet at rette #2723 og optælle-fejlen hurtigst muligt, så omdømme bliver retfærdigt inden 23/8 uden at ændre selve formlen.

_Hvorfor A: Man skal ikke straffes økonomisk af et mål man hverken kan se eller handle på, slet ikke når optællingen selv er i tvivl. B forudsætter at #2723 når at shippe og blive verificeret inden 23/8 — det er ikke sikkert. A er den sikre, fair løsning og koster kun en lille formel-justering._

## ⏳ KAN VENTE (25)

### [#17](https://github.com/NicolaiDolmer/CyclingZone/issues/17) — Lån: skal renter starte med det samme, og skal gebyret betales kontant?

To designspørgsmål om lån, rejst af bobby2106 på Discord 29/4: (1) skal lånerenter begynde at løbe fra dag ét, eller først ved næste sæson-start, og (2) skal lånegebyret trækkes kontant fra din konto med det samme, i stedet for at blive lagt oven i lånebeløbet (hvor gebyret så selv forrentes sammen med resten af gælden over tid). Ingen beslutning er truffet endnu — du skrev selv 11/6 at det skulle vente til en samlet gæld/økonomi-gennemgang sammen med #97 (håndhævelse af låneregler), når den nye relaunch-økonomi har mere data. Lav spilleffekt lige nu, ingen deadline presser.

- **A) Straks-renter + kontant gebyr: renter løber fra det øjeblik lånet tages, og gebyret trækkes fra kontantbeholdningen med det samme. Simplere at forklare og lukker en 'gratis lån lige før sæsonskifte'-taktik, men gebyret føles som en øjeblikkelig straf. ← anbefalet**
- B) Udskudte renter + gebyr lagt i lånet: renter starter først ved næste sæson-start (kort gratis periode), og gebyret lægges oven i lånebeløbet i stedet for at koste kontant — men gebyret forrentes derefter sammen med resten af lånet, en lidt skjult ekstraomkostning over tid.

_Hvorfor A: A er enklere at forklare i UI'en og lukker en potentiel udnyttelse. B's 'gebyr-i-lånet' skjuler en sammensat omkostning, hvilket er dårlig spiltransparens. Men dette er lav prioritet — rigtig handling nu er bare at bekræfte retningen, og lade selve implementeringen vente til den samlede økonomi-gennemgang du selv planlagde 11/6._

### [#355](https://github.com/NicolaiDolmer/CyclingZone/issues/355) — Skal vi frakoble ubrugte AI-værktøjer for at spare tokens?

Issuet foreslår at frakoble 7 AI-værktøjs-forbindelser der aldrig blev brugt i 66 sessioner (Microsoft Clarity, Google Drive, Gmail, Google Calendar, en dobbelt 'Control Chrome'-forbindelse, mcp-registry, computer-use) — det ville spare ca. 2.000-2.500 tokens hver gang en Claude Code-session starter i dette projekt. Et tjek af DENNE sessions egen værktøjsliste viser: Gmail og 'Control Chrome' er allerede væk, men Microsoft Clarity, Google Drive, Google Calendar, mcp-registry og computer-use er stadig forbundet. Bemærk: din globale opsætning lister Google Calendar og Drive/Box som bevidst forbundne værktøjer — de bruges muligvis i andre samtaler end CyclingZone, ikke kun her.

- **A) Frakobl kun de 3 uden nogen kendt brug (Microsoft Clarity, mcp-registry, computer-use) via claude.ai/settings/connectors — ingen downside, sparer ca. 1.000-1.200 tokens/session. Behold Google Calendar og Drive, fordi de er registreret som bevidst forbundne i din opsætning og formentlig bruges andre steder end CyclingZone. ← anbefalet**
- B) Frakobl alle 5 nu for fuld besparelse (~2.000-2.500 tokens/session) — men connector-indstillinger er konto-brede, så Calendar og Drive forsvinder fra ALLE dine Claude-samtaler, ikke kun CyclingZone, indtil du genforbinder dem manuelt.

_Hvorfor A: De tre uden kendt brug er et gratis valg — ingen grund til at de koster tokens hver session. Calendar og Drive bør ikke frakobles ud fra ét projekts session-data alene, når din egen opsætning viser de er forbundet med vilje — det er en beslutning der rækker ud over CyclingZone._

### [#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428) — Fast ugentlig rytme i Discord (recap/poll/ugens manager)

Issue #428 foreslår 3 faste ugentlige opslag i Discord-serveren (62 medlemmer i dag, tjekket direkte): mandag-recap, onsdag-poll, søndag "ugens manager". Jeg kan skrive skabeloner og sætte reminders, men selve opslagene skal du poste hver uge — det kan ikke automatiseres. Issuets acceptance-kriterie kræver 4 ugers fast cadence før det regnes som etableret.

- A) Commit nu til fuld cadence (alle 3 ugentlige opslag, ca. 30 min/uge i alt) — jeg laver skabeloner + kalender-reminders, du poster mandag/onsdag/søndag.
- B) Udskyd helt til der er mere plads i kalenderen (fx efter anti-cheat-epic #3131) — ingen ny ugentlig opgave nu, men de 62 medlemmer mister momentum uden faste opslag.
- **C) Start i lille skala: kun søndagens "ugens manager" (15 min/uge, mindst forpligtende) — spring mandag/onsdag over for nu. ← anbefalet**

_Hvorfor C: Tre faste ugentlige opslag er let at love og svært at holde som solo-founder midt i anti-cheat-arbejdet — en cadence der falder fra hinanden efter 2 uger skader mere end ingen cadence. Ét solidt ugentligt touchpoint er nok til at signalere "her er liv" og kan udvides senere._

### [#431](https://github.com/NicolaiDolmer/CyclingZone/issues/431) — Planlæg og afhold jeres første Discord Q&A (AMA)

Issue #431 beder om et planlagt AMA — live Q&A med dig som founder i Discord (62 medlemmer i dag). Skabelon til dato-valg, annoncering og spørgsmål-indsamling er allerede skrevet i issuet; det eneste der mangler er at du sætter en dato og afholder den ene time.

- **A) Sæt en dato nu (hverdagsaften, 19-20 DK-tid, ca. 1 uge ude) og opret Discord Event — jeg forbereder annoncerings-tekster + samler spørgsmål fra #feedback-and-ideas på forhånd. ← anbefalet**
- B) Udskyd til communityet er større — ingen dato sættes nu.

_Hvorfor A: 62 medlemmer er rigeligt til et første AMA — værdien ligger ikke i antal deltagere, men i at vise et rigtigt menneske bag spillet og få direkte input til roadmappet. At vente på "stort nok" community er en pseudo-grund til at udskyde noget der koster dig én time._

### [#748](https://github.com/NicolaiDolmer/CyclingZone/issues/748) — Discord-bot-token: den manuelle del er allerede udført — resten er kode-oprydning

Issuet bad om at du nulstiller Discord-bottens hemmelige nøgle i udviklerportalen. Det er allerede sket: i PR #1002 (3/6) roterede du token i Discord-portalen og opdaterede Railway, verificeret med en modtaget test-DM. Jeg tjekkede koden nu — .mcp.json og setup-scriptet indeholder ikke længere et råt token, de læser fra miljøvariablen, så env-injection-delen ser også ud til at være på plads. Der resterer kun to rene tjek uden ejer-handling: bekræfte at sikkerhedslaget er aktivt i en frisk session, og tilføje en automatisk test der fanger fremtidig config-drift.

- **A) Ingen handling fra dig — næste Claude Code-session udfører de to resterende tjek og lukker issuet selv. ← anbefalet**
- B) Hvis du vil have ekstra ro i maven: nulstil token i Discord-portalen én gang til i dag som en ren bekræftelse — men der er ingen kendt risiko der taler for det, kun ekstra arbejde med at synce Railway/lokalt miljø igen.

_Hvorfor A: Rotationen er allerede bevist gennemført og verificeret end-to-end; en ekstra nulstilling giver ingen sikkerhedsgevinst, kun risiko for at genskabe den samme Railway-out-of-sync-fejl der lige blev rettet._

### [#1033](https://github.com/NicolaiDolmer/CyclingZone/issues/1033) — Tabel-headers på løb/auktioner/stilling: skal de kunne sortere, eller skal de holde op med at ligne knapper?

På /races (world-fanen), /auctions og /standings ser kolonne-headers klikbare ud, som på jeres andre tabeller hvor sortering rent faktisk virker, men de sorterer ikke — brugere klikker forgæves. Kode-verificeret 3 steder: RacesPage.jsx, AuctionsPage.jsx (Alder + Sælger-kolonner) og StandingsPage.jsx (kun statisk sorteret på point). Der er ingen delt komponent, så valget bør gælde alle tre ens for ikke at forvirre.

- **A) Byg rigtig klik-sortering på alle tre tabeller. Mere arbejde (flere timer, ingen fælles komponent at genbruge), men det er en reel forbedring spillere med mange ryttere/bud/point rent faktisk vil bruge. ← anbefalet**
- B) Fjern knap-styling og sæt cursor-default, så headers ikke længere signalerer noget de ikke kan. Hurtigt (under en time), men løser ikke det underliggende behov.

_Hvorfor A: Det er et cykel-manager-spil fyldt med tal — spillere vil sortere efter pris/alder/point. At fjerne knap-styling er den billige udvej der bare skjuler manglen; byg sorteringen, det er kernefunktionalitet, ikke pynt._

### [#1283](https://github.com/NicolaiDolmer/CyclingZone/issues/1283) — Vil du bruge en session på at definere din egen founder-stemme?

AI-skrevet founder-tekst (fx roadmap-introen 10/6) rammer ikke din tone. For at rette det skal du selv skrive 2-3 eksempeltekster (fx en roadmap-linje, en Discord-annoncering) — det kan ikke uddelegeres, kun struktureres bagefter i TONE_OF_VOICE.md. 26/7-audit satte den lavest (P3) af de åbne ejer-beslutninger.

- A) Brug 20-30 minutter nu på at skrive founder-stemme-sektionen — Claude strukturerer den bagefter, og fremtidige AI-tekster rammer din tone med det samme.
- **B) Udskyd — behold den nuværende generiske tone indtil et konkret behov opstår (fx en stor announcement), og skriv da kun den ene tekst i farten. ← anbefalet**

_Hvorfor B: Lav-frekvens problem (kun bidt én gang) og laveste prioritet i din egen audit — brug tiden på økonomi-epic'en eller anti-cheat-epic'en i stedet. Tag den op når du alligevel skal skrive noget stort._

### [#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441) — Skal den store økonomi-redesign-session startes nu eller efter august?

Fase 1 (anti-inflations-rygrad: upkeep-sink, gældsbund, sponsor-clamp) er allerede merged. Facilities-fundamentet (bølge A1+A2) er også bygget og klar — kun selve flippet til spillerne mangler, sammen med klub-UI (bølge A3). Det der reelt mangler er den store design-session om 'rigtige sponsorer' med forhandlbare kontrakter — den kræver dine principper og er sat i MASTERPLAN til 'efter august'. I dag (30/7) blev anti-cheat-epic'en (#3131) samtidig sat som højt prioriteret.

- A) Start design-sessionen om forhandlbare sponsor-kontrakter nu, før august — fortsætter momentum, men tager fokus fra anti-cheat og fra at få Facilities-flippet (A3) helt i mål.
- **B) Følg den eksisterende MASTERPLAN-plan: vent til efter august, og få Facilities-flip + klub-UI + anti-cheat-epic'en i hus først. ← anbefalet**

_Hvorfor B: Du har en fungerende, selv-godkendt sekventering, og anti-cheat blev netop i dag sat højt — tilføj ikke et helt nyt stort spor oveni. Facilities er tæt på i mål og bør skydes i mål før noget nyt startes._

### [#1595](https://github.com/NicolaiDolmer/CyclingZone/issues/1595) — Gammel resultat-import-kode: slet den nu?

Fra dengang spillet brugte 'Pro Cycling Manager'-data til at sætte rytter-evner, ligger der stadig 5 kodefiler + 1 admin-side til manuel resultat-import — ubrugt i over en måned, ingen i UI'en peger på dem længere. 14 talkolonner pr. rytter (stat_ned, stat_bro, stat_fl osv.) bruges STADIG til at udregne 5 rytter-evner (bakkeklatring, brosten, positionering, aggression, taktik) og SKAL blive. Jeg anbefalede allerede 23/7 at slette kun import-koden og beholde tal-kolonnerne — men det er aldrig udført, og filerne står stadig urørte i repoet.

- **A) Godkend nu: jeg fjerner de 5 import-filer + admin-siden denne uge, tal-kolonnerne rører jeg slet ikke. Renere kode, ingen risiko for rytter-balance. ← anbefalet**
- B) Vent til den nye automatiske etape-motor har kørt en hel sæson problemfrit — behold import-siden som manuel nødløsning i mellemtiden.

_Hvorfor A: Der findes allerede en anden manuel rettelsesvej (godkend-resultat-siden), og død kode er en kendt fælde — en fremtidig AI-session kan fejlagtigt bruge den gamle import som skabelon for 'hvordan man gør'. Lav risiko, ingen data røres._

### [#1815](https://github.com/NicolaiDolmer/CyclingZone/issues/1815) — Discord-besked for hver etape i flerdages-løb, ikke kun til sidst

I dag sender spillet kun én Discord-besked når et flerdages-løb er helt slut. Boucles Mayennaises (4 etaper) kørte etape 1 den 23/6 kl. 22:05 med fulde resultater — men ingen Discord-besked, fordi kun den sidste etape udløser beskeden i dag. Spillere der følger et etapeløb dag for dag, ser altså intet i Discord før hele løbet er overstået.

- A) Kort besked pr. etape: kun etapevinder + top 3. Hurtigst at bygge, lav risiko for spam selv med mange samtidige løb.
- **B) Fyldig besked pr. etape: etapevinder + den samlede sammenlagte stilling efter etapen (som den 'gule trøje' i rigtig cykling). Mere som en ægte etapeløbs-oplevelse, men kræver at vi genberegner sammenlagt-stillingen ved hver etape og bygger en ekstra sikring mod dobbelt-afsendelse. ← anbefalet**

_Hvorfor B: Den daglige spænding om hvem der fører sammenlagt ER etapeløb — en besked uden stilling er kun en halv nyhed. Genberegningen laver vi allerede til slut-beskeden i dag, så det er en udvidelse af eksisterende kode, ikke noget nyt fra bunden._

### [#1996](https://github.com/NicolaiDolmer/CyclingZone/issues/1996) — Ryd op i det døde transfervindue-marked — to ja/nej-spørgsmål venter

Markedet er altid åbent (din beslutning 22/6), men gammel kode der stadig spørger til det afskaffede 'vindue' ligger tilbage. Del 1 er allerede rettet (PR #2151, merged) og fjernede risikoen for at spillere ser en falsk 'vindue lukket'-besked. Resten af oprydningen er sat på pause fordi den er filtret ind i to andre systemer: (1) beta-board-nulstillingen (#805) læser stadig den gamle vindue-tabel til at nulstille test-board-profiler ved sæsonskifte, og (2) endnu en cron (automatisk sæsonskifte) bruger sandsynligvis samme fejlbehæftede logik og er formentlig også reelt død. Ingen spillerrisiko lige nu — men der er en fælde: hvis nogen senere 'retter' koden tilbage til at læse den gamle tabel, lukker hele markedet for alle på én gang.

- **A) Svar her og nu, skriftligt, på begge spørgsmål: (1) bruger du stadig beta-board-test-mode? Hvis ja, flyttes nulstillingssignalet til et nyt sted i samme oprydning; hvis nej, fjernes det helt sammen med resten. (2) skal den anden, formentlig døde sæsonskifte-cron ryddes op i samme omgang, eller er det et separat issue? Så kan oprydningen bygges i næste session — med de sædvanlige ekstra tests for netop denne kode, ikke som natbølge-arbejde. ← anbefalet**
- B) Book i stedet den ~15-20 min fælles session der var planlagt 12/7, hvor I gennemgår begge spørgsmål i realtid før noget skrives.

_Hvorfor A: Begge spørgsmål er rene ja/nej-valg uden teknisk dybde — du behøver ikke sætte tid af til en session for dem. Selve kode-ændringen får stadig den forsigtighed denne del af koden kræver (dedikerede tests, ingen natbølge, pga. 2 tidligere hændelser i lignende kode), men beslutningen kan du træffe nu._

### [#2152](https://github.com/NicolaiDolmer/CyclingZone/issues/2152) — 'Deadline Day' er død kode efter transfervindue-afskaffelsen — fjern eller byg om?

Deadline Day hørte til det gamle transfervindue, som blev afskaffet i sommer. Admin kan i dag aldrig længere åbne et vindue, så den dato funktionen skulle trigge på (closes_at) bliver aldrig sat — Deadline Day kan reelt ikke aktiveres af nogen spiller eller admin via den normale vej. Ingen spillere ser eller bruger den i dag.

- **A) Fjern helt: endpoint, admin-UI-sektionen og spiller-visningen (TeamPage, RiderStatsPage, badge i menuen) ryddes ud i én PR. Mindre kode at vedligeholde, ingen mister noget der reelt virker i dag. ← anbefalet**
- B) Byg om: kobl "deadline-drama" fra det gamle transfervindue til noget nyt, fx sæson-afslutning eller en anden fast dato — hvis du stadig vil have den slags spænding som en fremtidig feature.

_Hvorfor A: Det er død kode ingen spiller ser eller mister noget ved at fjerne. Et nyt "deadline"-koncept er reelt en ny feature og bør designes fra bunden med en konkret idé bag sig — ikke arves fra gammel kode, der aldrig var bygget til formålet._

### [#2388](https://github.com/NicolaiDolmer/CyclingZone/issues/2388) — En lokal kvalitetstest for enkeltstarter er rød — skal kravet sænkes midlertidigt?

En lokal test der tjekker, om enkeltstarter (tempo-løb) vindes af de rigtige ryttertyper, viser 59% mod et krav på 60% — kun 3 sejre fra at bestå, ud af 300 simulerede løb. Hoved-testen, der faktisk afgør om kode kan merges (CI), er fortsat grøn og upåvirket — dette er en ekstra lokal test uden konsekvens for spillet lige nu. Motorens reelle niveau ligger omkring 62%, og med kun 300 løb svinger resultatet ±3 procentpoint af ren tilfældighed, så 60%-kravet har reelt ingen margin.

- **A) Sænk kravet til 55% for netop denne test-variant (kun tempo-løb, ikke hoved-testen) — matcher det niveau du allerede har accepteret andre steder i systemet. ← anbefalet**
- B) Fjern kravet helt for denne test-variant og gør den til ren rapportering uden bestå/fejl — ingen tal at vedligeholde, men mister også en tidlig advarsel hvis noget engang bryder helt sammen.

_Hvorfor A: A bevarer en reel alarm, hvis noget engang kollapser (fx falder til 45%), mens den fjerner den falske alarm der i dag udløses af helt normal tilfældig variation. B fjerner al sikkerhed uden grund._

### [#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582) — Tidsgrænse i løb (broom wagon) — hvor hårdt skal den ramme rytterne?

Du bad 16/7 om en realistisk tidsgrænse i race-motoren (ligesom i virkeligheden: for langsomme ryttere udgår af løbet), baseret på UCI's regler (typisk en procentdel af vinderens tid, afhængig af etapetype). Ingen kode er skrevet endnu — det eneste der mangler før design kan starte er hvor hårdt mekanikken skal ramme den ryttere der rammer grænsen.

- **A) Ren løbskonsekvens: rytteren får DNF (mister det løb, ingen point), men intet ekstra — ingen straf på moral eller kontrakt. ← anbefalet**
- B) Fuld konsekvens: DNF + påvirker også moral og kontraktforhandling, så en tidsgrænse bliver en straf der rækker ud over det ene løb.

_Hvorfor A: DNF alene giver den realisme du bad om, uden at åbne en ny, potentielt urimelig straf-mekanik — rytteren mister jo allerede løbet. Moral/kontrakt-effekt kræver mere systemarbejde og kan føles uretfærdigt for spillere med tynde trupper._

### [#2603](https://github.com/NicolaiDolmer/CyclingZone/issues/2603) — Mobil-layout-bug fra 17/7 — luk den, eller jagt det udløbne screenshot?

Du sendte et mobil-layout-screenshot 17/7, men billedet er udløbet på Discord og aldrig gen-uploadet, så vi ved ikke præcis hvilken skærm det var. Dagens housekeeping-sweep (30/7) fandt at søster-issuet #2165 — samme symptom (menu-skuffe overlappet af indhold), men MED et identificeret skærmbillede — er blevet lukket i dag som verificeret rettet af #2880 (en systemisk z-index-fix der rammer alle skærme hvor tabeller lå oven på mobil-menuen).

- **A) Luk #2603 nu som dækket af #2880-fixet. To andre spillere (snorkalot, thelamba) rapporterede uafhængigt samme mekanisme, og #2880 var en generel rettelse — sandsynligheden for at dit 17/7-screenshot var noget andet er lav. ← anbefalet**
- B) Giv navnet på skærmen (fx 'rytterprofil', 'kalender', 'ranglisten') så den kan verificeres eksplicit mod fixet, før den lukkes.

_Hvorfor A: Beviset peger stærkt på samme rod-årsag, screenshottet kan ikke genskabes, og spillet er levende — dukker fejlen op igen, rapporteres den igen. At blive ved med at vente på et 2 uger gammelt udløbet billede koster mere end det er værd._

### [#2670](https://github.com/NicolaiDolmer/CyclingZone/issues/2670) — Loft for udvikl-og-sælg-profit (250%): bekræft nu eller vent på rigtige tal?

Efter cutover 18/7 satte vi et loft på 250% profit på at udvikle og sælge unge ryttere, baseret på en PROJEKTERET ROI på 232%. Issuet beder om at re-måle den faktiske ROI ud fra ægte gennemførte salg og enten bekræfte eller stramme loftet — men der er endnu for få afsluttede udvikl-og-sælg-forløb til at måle på. Ægte data er tidligst klar omkring 1/8 (14 dage efter cutover).

- **A) Vent til efter 1/8 med at beslutte — så har vi 2 ugers rigtige salg at måle den faktiske ROI på, i stedet for at gætte. ← anbefalet**
- B) Beslut nu ud fra den projicerede ROI (232%) uden at vente — hurtigere afklaring, men risiko for forkert loft fordi vi endnu ikke har set hvordan spillerne faktisk handler.

_Hvorfor A: At sætte et balance-loft ud fra en projektion i stedet for ægte spilleradfærd er præcis den fælde vi selv har lært af (mål/simulér før du skruer). To ugers ventetid koster intet, mens en forkert justering nu skal rulles tilbage igen senere._

### [#2818](https://github.com/NicolaiDolmer/CyclingZone/issues/2818) — Endagsløb-punktløftet er allerede rettet — mangler kun din bekræftelse på at lukke sagen

Sagen bad om et valg mellem at bygge fuld pointlogik til endagsløb eller rette teksten så spillet ikke lover point det aldrig uddeler. Du traf allerede den beslutning 23/7: ingen bjerg- eller sprintpoint på endagsløb, kun etapeløb har klassementer — det er korrekt cykelsport. Fixet (PR #2821) er merged og verificeret i preview: et Monument-løb viser ikke længere 'SPRINT · 20p', mens etapeløb fortsat viser korrekt point på spil. Issuet står stadig åbent med needs-decision-labelen, selvom både beslutning og byggeri er i mål.

- **A) Bekræft at sagen er lukket — der er intet tilbage at vælge. Sig 'luk den', så fjerner jeg needs-decision-labelen og lukker #2818 med henvisning til PR #2821. ← anbefalet**
- B) Genåbn spørgsmålet og byg alligevel fuld pointlogik til endagsløb (den mulighed du selv afviste 23/7) — kræver ny spec, balance-dry-run og ugers arbejde, og går imod din egen begrundelse om at det ikke er korrekt cykelsport.

_Hvorfor A: Der er ikke noget reelt valg tilbage — du besluttede, og vi har allerede bygget og verificeret det. Dette er ren opfølgnings-hygiejne, ikke en ny beslutning._

### [#2885](https://github.com/NicolaiDolmer/CyclingZone/issues/2885) — Skal spillere kunne sælge uønskede ryttere til AI'en?

I dag er eneste vej ud af en uønsket rytter at en anden spiller byder — med 41 aktive spillere om ugen findes den køber ofte ikke. Samme ryttere genudbydes 6-8 gange på to døgn uden salg, og selv gode 16-årige ryttere får slet ingen bud på youth-auktioner. Der er 4 uafklarede designspørgsmål før noget kan bygges: hvor lav AI-prisen skal være (for ikke at underminere markedsværdien), om det kun skal virke mellem sæsoner, hvornår et forsøg tæller som reelt mislykket, og hvad der sker med rytteren bagefter.

- A) Byg det nu parallelt med #2884, med lav fast pris baseret på nuværende produktionsværdi (ikke markedsværdi), kun mellem sæsoner, og en økonomi-simulering før det går live.
- **B) Vent til #2884 (auktionsvarighed) er besluttet og har kørt et stykke tid — definitionen af "reelt mislykket forsøg" afhænger direkte af hvor længe en auktion varer, og længere auktioner kan i sig selv løse en del af salgsproblemet. ← anbefalet**

_Hvorfor B: At bygge en permanent AI-opkøbsmekanik (med reel exploit-risiko mod markedsværdien) før du ved om det simplere fix i #2884 løser salgsproblemet, er at bygge en løsning på et problem der måske forsvinder af sig selv — test rodårsagen først._

### [#2946](https://github.com/NicolaiDolmer/CyclingZone/issues/2946) — Skal akademi-ryttere kunne sælges direkte, uden at blive forfremmet først?

En spiller (knud_r_flink) spurgte 25/7 i Discord hvorfor akademi-ryttere ikke kan sælges direkte – i dag skal de først forfremmes til seniortruppen. Uklart om det er bevidst design eller en begrænsning. Kun ét spillerspørgsmål er registreret, men beslutningen påvirker to kendte problemer: akademi-overflow-talenter er allerede for stærke på auktion (#2699), og kontrakter nulstilles ved forfremmelse (#2881).

- **A) Behold nuværende flow (forfremmelse først), men forklar det tydeligt i UI/hjælp – akademiet fungerer bevidst som en beskyttet 'rugekasse' der tvinger spillere til at udvikle unge ryttere frem for at flippe dem med det samme. ← anbefalet**
- B) Tillad direkte salg fra akademiet – fjerner friktionen spilleren efterspørger, men gør akademi-overflow-problemet (#2699) potentielt værre, fordi flere stærke unge ryttere kan ende direkte på auktion.

_Hvorfor A: Beskyttet akademi matcher rigtig cykelsport (unge ryttere udvikles, sælges ikke straks), og issuet selv flager at direkte salg kan forstørre et allerede kendt problem (#2699). Billigste og sikreste rettelse er at forklare reglen, ikke at ændre den._

### [#2991](https://github.com/NicolaiDolmer/CyclingZone/issues/2991) — Grand Tour-achievementet kan reelt ikke nås af nogen menneske-spiller i mindst 2 sæsoner

Achievementet 'Grand Tour-hold' findes og kan tildeles, men Grand Tours (Tour de France-typen løb) kører kun i division 1 – som udelukkende består af 24 AI-hold. Alle 156 menneskehold ligger i division 3 (96 hold) og 4 (60 hold). Verificeret i prod: 0 menneskehold har nogensinde haft en rytter i et af de 6 Grand Tour-løb i sæson 1. Vejen op til division 1 går gennem flere divisioner, så tidligst efter sæson 3 kan de allerbedste nå det – for de fleste af de 156 spillere er badget reelt uopnåeligt lige nu, uden forklaring på hvorfor.

- **A) Lad achievementet stå som et flersæsoners prestige-mål, men gør teksten eksplicit ('kun i division 1 – kræver oprykning') så spillerne forstår hvorfor de ikke kan nå det endnu. Kun tekstændring. ← anbefalet**
- B) Slæk kriteriet til 'løb med i divisionens største etapeløb' i stedet for et rigtigt Grand Tour – giver alle spillere en reel vej til achievementet, men udvander betydningen af navnet 'Grand Tour' og kræver at badget omdøbes/forklares på ny.
- C) Åbn Grand Tours for division 2 – kræver ny kalender-simulering (rører finjusteret binding-logik fra #2251/#2276), og løser ikke problemet med det samme, fordi division 2 i dag også er 100% AI.

_Hvorfor A: At Grand Tours kun kører i topdivisionen matcher rigtig cykelsport – ikke alle hold kører Tour de France. Det er en ærlig præmis, ikke en fejl. Billigste og mest ærlige greb er at sige det højt i teksten, frem for at udvande selve 'Grand Tour'-betydningen (B) eller åbne en dyr kalenderændring for et felt der stadig er 100% AI (C)._

### [#3020](https://github.com/NicolaiDolmer/CyclingZone/issues/3020) — Skal sponsor-vælgeren i sæson 3 faktisk vise forskellige beløb pr. division, eller forblive kun en rate-visning?

27/7 besluttede du at IKKE ændre sponsor-udbetalingsmodellen midt i sæson 2 – kun teksten på sponsorkortet er rettet (shippet i PR #3063), så det nu står klart at maks-udbetalingen er ens uanset hvilken division-knap man klikker i tilbudsmodalen. Det ubesvarede spørgsmål, som du selv har sagt ikke skal stå permanent: skal division rent faktisk ændre beløbet i sæson 3, ikke kun raten pr. etape? Bag kulissen varierer sponsor-basebeløbet allerede reelt efter division (600.000 i D1 ned til 315.000 i D4), men spilleren kan ingen steder se den forskel i dag.

- **A) Fjern de andre divisioners knapper fra vælgeren – vis kun spillerens egen division. Billigt, fjerner den sidste rest af misvisende UI, ingen ny økonomi-risiko. ← anbefalet**
- B) Byg reel omprissætning til sæson 3, så vælgeren viser hvad AFTALEN faktisk ville være værd ved oprykning/nedrykning – svarer på det spørgsmål spillerne faktisk stiller, men er en ny balance-sim-opgave under økonomisporet #1441, ikke et UI-fix.

_Hvorfor A: A er den billige, risikofri oprydning der kan laves nu uden at røre økonomi. B er den rigtige langsigtede løsning, men bør vente til #1441-økonomisporet får en balance-simulering – at bygge det ad hoc her risikerer samme fælde som S2-beslutningen undgik (spillere ser tal ændre sig under fødderne)._

### [#3050](https://github.com/NicolaiDolmer/CyclingZone/issues/3050) — Skal vi bygge venskabsløb/turneringer mellem spillere på tværs af divisioner?

En engageret spiller (@thelamba) foreslog 26/7 på Discord venskabsløb på tværs af divisioner — enten en simpel udfordring mellem kendte hold med de trupper de allerede har, eller en fuld custom-turnering med budget-draft i en lukket simulering (a la Football Manager). Fordelene: retention mellem løbsdage, en mulig Pro-perk uden konkurrencefordel (køber ikke stærkere ryttere), og ekstra belastningstest af race-motoren med rigtige spillere i stedet for kun AI. Det er stort og spekulativt nok til at det er dit valg om det overhovedet skal bygges.

- **A) Godkend den simple version: venskabsløb med eksisterende trupper, genbruger hele race-motoren, ingen ny økonomi — sættes i backloggen som næste store feature efter fair-play-epic'en (#3131). ← anbefalet**
- B) Byg den fulde version med det samme: custom turnering med budget-draft i en lukket simulering — større, selvstændigt projekt med ny økonomi-logik.
- C) Parkér ideen helt for nu, intet commitment — fokus forbliver på anti-cheat (#3131) og S2→S3-overgangen.

_Hvorfor A: Den simple version er billig (genbruger motoren, ingen ny økonomi) og løser retention + giver et ægte Pro-perk uden pay-to-win, men den skal stå i kø bag anti-cheat-epic'en, som er højst prioriteret lige nu._

### [#3092](https://github.com/NicolaiDolmer/CyclingZone/issues/3092) — Fjern adgangen for en ubrugt tredjeparts-app (Manus Connector) i GitHub?

GitHub sendte 27/7 en permission-opdatering for app'en 'Manus Connector', som har bred skriveadgang til repoet (kode, workflows, dependabot-secrets). Undersøgelsen fandt intet mistænkeligt — ingen Manus-commits nogensinde, ingen uventede collaborators — men Manus-abonnementet er opsagt og bruges ikke. Det er en ren klik-handling kun du kan udføre (kræver dit GitHub-login), ikke et kodevalg.

- **A) Fjern adgangen nu: gå selv til github.com/settings/installations (skriv URL'en, klik ikke på mail-linket) → find 'Manus Connector' → Configure → Uninstall. Tager 2 minutter. ← anbefalet**
- B) Behold appen og godkend permission-opdateringen — et bevidst valg om at beholde bred skriveadgang til en app du ikke bruger.

_Hvorfor A: Ubrugt skriveadgang til repo, workflows og secrets er unødvendig risiko for nul gevinst; der er ingen grund til at beholde en app fra en opsagt aftale._

### [#3109](https://github.com/NicolaiDolmer/CyclingZone/issues/3109) — 4 AI-modstanderhold mistede deres trup ved en fejl — hvad gør vi ved dem?

26/7 blev 4 AI-hold i division 4 ved et uheld tømt for deres oprindelige AI-trup og fik i stedet en tynd manager-trup (8 ryttere mod normalt 11-24) på grund af en fejl i systemet der fejlagtigt 'redder' hold med fejlet opstart. Fejlen er allerede rettet (PR #3108). Ingen rigtige spillere er berørt — det er kun AI-modstandere, og de 4 hold har nok ryttere til at stille op i løb.

- **A) Lad dem være — 4 lidt tyndere AI-hold i division 4, ingen mærkbar effekt for nogen spiller, ingen mutation, ingen risiko. ← anbefalet**
- B) Top-up: tilføj ryttere så de matcher de andre division-4 AI-hold (24 mand) — sletter intet, men er en ekstra mutation for et rent kosmetisk problem.
- C) Regenerér truppen helt — mest 'rent' på papiret, men sletter ryttere der kan have løbsresultater/entries; unødig destruktiv mutation for et problem uden spillerpåvirkning.

_Hvorfor A: Skaden er ren kosmetik — ingen spiller mærker forskel på en AI-modstanders trupstørrelse — og både B og C introducerer en unødvendig prod-mutation for et problem der ikke gør ondt._

### [#3121](https://github.com/NicolaiDolmer/CyclingZone/issues/3121) — Matview-fix virker — bekræft at det er nok

PR #3058 (merged 28/7) delte den tunge matview-opdatering op i fire mindre kald, så databasen ikke længere risikerer at låse i op til 8 sekunder ad gangen. Ny måling i dag (30/7) viser maks 1,6 sekunder — langt under 8-sekunders-loftet og ned fra 7,8 sekunder før fixet (det var de 7,8s der truede med at ramme timeout-grænsen). Issuet kan først lukkes når du siger 'det er nok'.

- **A) Bekræft 'Vej 1 er nok' — Claude lukker #3013-sporet og noterer 1,6s som ny baseline. Ingen mere kode skal bygges. ← anbefalet**
- B) Gå videre med Vej 2 (pg_cron) eller Vej 3 (rå database-forbindelse fra Node) — mere robust hvis trafikken vokser meget, men koster en ny driftsflade og du mister Sentry-heartbeat-synlighed (Vej 2) eller får en ekstra forbindelsesvej i backenden (Vej 3).

_Hvorfor A: 1,6s mod et 8s-loft er 5x margin — problemet er løst. At bygge Vej 2/3 nu er at løse et problem der ikke længere findes; tag dem op igen hvis trafikken vokser markant._
