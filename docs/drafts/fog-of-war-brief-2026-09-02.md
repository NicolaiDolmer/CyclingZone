# Fog of war i Cycling Zone: beslutningsgrundlag

Skrevet 2. september 2026. Alle prod-tal er målt read-only samme dag kl. 10.45 dansk tid.

---

## 1. Hvad du allerede har sagt

**18/8, #dansk-snak (#3967):**
> "Tænker også ummidelbart jeg indfører flere 'fog of war' features - Altså hvor man ikke VED hvad der foregår. [...] den komplette sandhed/synlighed fjernes og erstattes med, at man får info, hvis man køber sig til det (talentspejdere, eller noget i den stil)"

> "Kan godt være, at jeg kører det mod noget ala afstemning på sigt"

> "Lige nu ift transparens så vælger jeg i hvert fald at have det fremme for nuværende. Måske det skjules bedre/mere på sigt, særligt når træningscore kommer."

**14/8, #dansk-snak (modvægten, dine egne ord):**
> "Det er reelt lige præcist følelsen af, 'at man kan regne med sine ryttere', at jeg er igang med at få på plads - At man da helst, sådan helt generelt set har en følelse af, at 'What you see, is what you get' - Så at sige"

**26/8, #løse-informationer:**
> "Og så bliver akademiet lidt mere 'skjult', ligesom f.eks det er i FM. Stadig en stor del af spillet, bare med mindre viden."

**2/9 (i dag), til mig:**
> "Jeg er ikke sikker på, at jeg vil skjule evnerne lige nu på rytterne, men vi kan godt overveje det, sammen med andre fog of war-funktioner."

**9/8, #questions-and-answers (den kontrakt du har lovet spillerne):**
> "The reason why you see a range, is to 'simulate' the inacuracy in the scouts. [...] But behind the scenes, theres actually only one real number."

Linjen er altså: mere fog på sigt, men eget hold skal føles pålideligt. Det er ikke en modsætning, det er en grænse: **fog på andre, klarhed på dine egne.**

---

## 2. Hvad spillerne har sagt

**For mere fog:**

- @egomadsen, 26/8 #hattrick (#4264): *"man aldrig kender evnerne på andre holds spillere [...] uden scouting kunne se eks 65-75. Efter én scouting 67-73. Efter tre scouting 73"* og *"det skal være lidt vilkårligt, og ikke altid +/- 5"*. Sidegevinst han selv peger på: *"(det ville også fjerne det her med at folk sidder og nærstuderer alle ryttere og undrer sig over hvorfor deres rytter ikke vandt over x)"*
- @friisisch, 18/8 (#3967): *"Det er lidt ærgerligt synes jeg, at være helt sikker på, hvem der bliver de bedste i spillet lige nu"*
- @snorkalot, 18/8: *"Vild med den her idé - Det er lidt for lige til pt."*
- @knud_r_flink, 22/7 (#2798): *"nu kan man jo bare kigge værdien"*, og 12/8 om scouting: *"I stopped using it, mostly because of the limited scope. But I think it works in Football Manager, because of the huge database and hidden skills and potential."*

**Imod eller med forbehold:**

- @valverde4ever, 24/8, som svar på om alt skal sløres: *"Eller. Nummer 2 er måske ikke så 'onlinespil' venligt"*
- @thelamba, 14/8: *"hvor forkert på den kan vores scouts være?"* og 16/8 et helt logisk puslespil hvor han forsøger at regne det sande tal ud af flere bånd. Han har brugt tre separate tråde på at afkode sorteringsnøglen (#4097). Bånd skaber allerede friktion.
- @mandia1984, 11/8: *"how can it reach its ceiling if it's only halfway through its development? It doesn't make much sense"*

Bemærk: der er kun ét bogstaveligt "fog of war"-hit i hele august (@jonasnielsen 24/8: *"Er det planen at der i fremtiden skal være en form for fog of war eller skal alle stats være synlige"*), og præcis ét skeptisk svar på det. Det er ikke et bredt spillerkrav, men et vedholdende ønske fra 4-5 af de mest aktive.

---

## 3. Hvad der findes i dag

| # | Kandidat | Status i dag |
|---|---|---|
| 1 | Andre holds evner som interval | **Nej.** Alle 16 synlige evner er offentlige for alle ryttere (RLS `Public read riders`, `USING (true)`) |
| 2 | Potentiale som ord eller bånd | **Delvist.** Potentiale er skjult server-side (#1162) og vises som bånd plus stjerner, men som TAL, ikke som ord. Skalaen er stadig 11 trin (1,0-6,0), ikke 1-99 |
| 3 | Markedsværdi-lækagen | **Nej, lækagen er åben.** `potentiale` er direkte input til NPV og dermed til den offentlige `market_value`. Målt 30/8: korrelation 0,772 inden for grupper hvor alt synligt er ens; medianværdien stiger 305 gange fra potentiale 1,0 til 6,0 |
| 4 | Skjult dagsform på andre hold | **På vej.** #4598 (dit design fra i dag) viser dagsform som replik, kun eget hold. Kendt hul: `race_stage_moments` har RLS for alle, så filtreringen sker klientside |
| 5 | Skjulte taktik-kort og ordrer | **Ja, allerede.** `team_race_strategy` og `race_team_orders` er begge ejer-only i RLS. Startlisten er offentlig, selve ordrerne er ikke |
| 6 | Anonyme bud i auktioner | **Nej.** `auction_bids` er `Public read ... USING (true)`, og budgiverens holdnavn vises i aktivitetsfeeden |
| 7 | Scouting af et løb eller en rival | **Nej.** Scout-missioner findes kun mod ryttere (`target` og `mission`) |
| 8 | Kendskab der forfalder | **Nej.** Scout-niveau er permanent. `scout_actions` er en ren ledger uden udløb |

Delvis fog findes allerede ét sted: `riderInterest.js` anonymiserer hvem der scouter og følger en rytter for alle andre end ejeren.

---

## 4. Målinger fra prod (2/9)

| Mål | Værdi |
|---|---:|
| Menneske-hold, ikke-test, ikke slettemarkerede | 235 |
| Heraf set logget ind seneste 30 dage / 7 dage | 127 / 85 |
| Aktive ryttere / heraf under 23 år | 7.416 / 4.031 |
| Scout-handlinger seneste 30 dage (hele ledgeren er under 90 dage gammel) | 1.621 |
| Scout-missioner (`scout_assignments`) seneste 30 dage | 1.367 |
| Hold der har scoutet seneste 30 dage | 74 af 127 aktive (58 %) |
| Ryttere scoutet af mindst ét hold der ikke ejer dem | 942 (12,7 % af poolen) |
| Auktioner seneste 30 dage (heraf ungdom) | 2.144 (896) |
| Auktioner der fik mindst ét bud | 713 (33 %) |
| Gennemsnitligt antal bydere pr. auktion | **0,53** (1,60 blandt dem med bud, max 10) |
| Direkte handel: listinger / tilbud / accepterede | 360 / 364 / 111 |
| Byttetilbud / accepterede | 125 / 21 |
| Rytterprofil-visninger seneste 30 dage | **25.224** |

Tre ting springer ud. **Information forbruges massivt**: cirka 200 profilopslag pr. aktivt hold pr. måned. Spillet er allerede et informationsspil. **Scouting er levende**: 58 % af de aktive hold brugte den seneste måned. Men **auktionsmarkedet er tyndt**: to tredjedele af alle auktioner får ikke ét eneste bud. Det er den vigtigste risikofaktor i hele beslutningen.

---

## 5. Pakkerne

### Pakke 0: Gør ingenting nu

**Spillerens oplevelse:** uændret. Potentiale-bånd som i dag, værdien afslører stadig hvem der bliver bedst. **Byg:** ingen.
**Risiko:** doktrinen siger *"Potential is uncertain. Scouting narrows a range rather than revealing a guaranteed future."* Det er i dag ikke sandt, og @knud_r_flink har sagt det højt. Stilstand er en løbende troværdighedsudgift, ikke nul.

### Pakke A (Minimal): Luk værdi-lækagen, og gør potentiale til et ord

Består af #2798 vej B (fjern potentiale-leddet fra den PUBLICEREDE værdi, lad den fulde NPV styre løn, AI-bud og intern økonomi) plus #3967 (ord i stedet for tal, bånd på hover) plus #4097 (vis sorteringsnøglen).

**Spillerens oplevelse:** to 18-årige der ser ens ud koster nu det samme. Scout-rapporten er den eneste vej til at vide hvem der bliver god. Potentiale hedder "Enormt / Lovende / Fornuftigt / Begrænset" i stedet for "39-42".
**Byg: M.** Vej B kræver én ekstra kolonne for synlig værdi og rører ikke motoren, men backwards-checket er bredt: otte flader plus lønprojektion, minimumsbud og AI-bud i `frontend/src/lib/marketValues.js`. Ord-visningen er ren præsentation oven på et bånd der allerede findes, altså S. Der skal skrives en invertérbarheds-harness der forsøger at invertere, ikke bare et UI-tjek.
**Risiko: lav.** Ingen ny information forsvinder som spillerne har i dag ud over den de ikke burde have haft. Værdien bliver et dårligere pejlemærke for unge, hvilket kan gøre ungdomsauktionerne endnu mere tynde. Modvægt: 896 ungdomsauktioner på 30 dage er allerede overvejende ubudte.
**Afhængigheder:** ingen. Alt andet på listen afhænger af den.

### Pakke B (Mellem): Pakke A plus andre holds evner som interval

Tilføjer #4264: fremmede ryttere viser hver evne som et bånd der snævrer ind med scouting, med vilkårlig og ikke-mekanisk bredde. Egne ryttere er eksakte som i dag.

**Spillerens oplevelse:** du kan ikke længere sortere feltet. Du kan gætte, scoute eller handle blindt. Det er den ændring @egomadsen beder om, og den der ville gøre scouting til en rigtig færdighed.
**Byg: L.** 16 evner gange 7.416 ryttere gange per-hold-seed skal beregnes server-side pr. beskuer, ikke bare maskeres i frontend. Og en advarsel fra #3679: det eksisterende loft-bånd kunne **regnes eksakt ud** fra to scout-niveauer, fordi skævheden skalerede med halvbredden, og 90-99 % af ryttere kunne pinnes til plus/minus 1 point. Den fejl skal først rettes strukturelt (fast absolut forskud, som stjerne-båndet), ellers bygger man 16 nye invertérbare kanaler. Dertil kommer sammenlign, auktioner, resultater, holdprofil og hover-kort.
**Risiko: høj.** @thelamba bruger allerede tre tråde på at afkode ét bånd. Seksten bånd pr. rytter rammer doktrinens *"Hidden formulas must not create an unknowable correct answer"* og *"Meaningful decisions, simple presentation"*. Og med 0,53 bydere pr. auktion er markedet ikke robust nok til at gøre vurdering dyrere lige nu.
**Afhængigheder:** Pakke A skal være landet (ellers regnes båndene tilbage fra værdien), og #3679's båndform skal rettes først.

### Pakke C (Fuld): Pakke B plus anonyme bud, rival- og løbsscouting, kendskab der forfalder

**Spillerens oplevelse:** et spil hvor du opbygger og vedligeholder et efterretningsbillede. Meget dybt for de 10-15 mest engagerede.
**Byg: L til XL.** Anonyme bud kræver RLS-ændring på `auction_bids`, som er offentlig i dag, plus oprydning i aktivitetsfeed og hoved-mod-hoved-visningen. Rival- og løbsscouting er en ny missionstype med nyt datalag. Kendskab der forfalder kræver en decay-model og notifikationer.
**Risiko: meget høj.** Forfaldende kendskab straffer direkte spillere der logger ind sjældnere, og doktrinen advarer eksplicit mod *"Offline progression feels punitive"*. Anonyme bud fjerner rivalisering, som doktrinen tværtimod vil have mere af. Det er også pakken @valverde4ever mente ikke var "onlinespil-venlig".
**Afhængigheder:** hele A og B, plus en scouting-økonomi der kan bære det. I dag koster en undersøgelse 1.000 pr. niveau og en mission 6.000, med kapacitet 1-2 samtidige opgaver. Skal scouting dække 16 evner plus løb plus rivaler plus vedligehold, skal kapaciteten mangedobles, og så bliver den en klik-skat i stedet for et valg.

---

## 6. Min anbefaling

**Byg Pakke A nu. Beslut ikke Pakke B endnu, men ret #3679's båndform som forudsætning.**

Tre grunde, forankret i doktrinen:

1. **Pakke A er ikke ny fog, den er et løfte du allerede har givet.** Doktrinen siger at potentiale er usikkert og at scouting indsnævrer et interval. Prod siger at man bare kan sortere værdikolonnen. Det er en SSOT-gæld, ikke et designvalg, og den er den eneste af de otte kandidater der gør alle de andre virkningsløse så længe den står åben.

2. **Din egen "what you see is what you get" er ikke i konflikt med A.** A rører kun det du ser om ANDRES unge ryttere. Egne ryttere, dagsform, træning og resultater bliver ved med at være pålidelige. Det er præcis den grænse #4598 allerede trækker.

3. **Markedet kan ikke bære B lige nu.** 0,53 bydere pr. auktion betyder at vurdering allerede er for dyr i forhold til udbyttet. Gør vurdering markant dyrere, og de 713 budte auktioner falder. Bygger vi først A og måler i to sæsoner, ved vi om scouting-brugen stiger og om auktionsdeltagelsen holder. Så er B en evidensbaseret beslutning i stedet for en smagsbeslutning.

Om afstemningen du nævnte 18/8: hold den til Pakke B. A er en fejlretning, den skal ikke stemmes om. B er en ægte retningsændring hvor spillerne er uenige indbyrdes, og der er en afstemning god.

---

## 7. Det ene spørgsmål du skal svare på først

#2798 har ligget uden ejer-svar siden 23. juli, og alt andet på listen er blokeret bag det:

> **Skal potentialet fjernes fra den offentligt viste markedsværdi (vej B), så scout-usikkerheden bliver ægte, mens den fulde NPV bliver ved med at styre løn, AI-bud og intern økonomi?**
>
> Alternativet er vej C: accepter at værdien afslører potentialet, og nedlæg scouting-fog'en som mekanik (#1138, #2494 og dermed også #4264 og #3967 falder).
>
> Min anbefaling: **B.**

Svarer du B, går jeg i gang med Pakke A. Svarer du C, lukker jeg fire issues og vi tager fog of war op igen når træningsscoren lander.
