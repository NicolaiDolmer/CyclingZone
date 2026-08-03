# Hold-dominans i race v3 — empirisk karakterisering og verdikt (#2557)

**Dato:** 2026-08-03 · **Metode:** read-only SELECT mod prod (Supabase MCP) + kodelæsning. Ingen prod-mutationer.
**Refs:** #2557 (dette issue) · #2574 (share4Plus strukturelt afkoblet) · #2731 (maxRiderWinRate) · #3015 (AI-træthed) · #2224 (forrige dominans-hændelse) · #2414/#2555 (drift-vagten)

---

## Kort svar

Hold-dominansen er **ikke** et motor-problem, og den lukkes **hverken** af #2731-kalibreringen eller #3015-trætheds-fixet.

Den er en **liga-strukturel skævhed**: pulje-tildelingen er styrke-blind, så tre af de fire Division 3-puljer hver har fået ét hold der er dobbelt så stærkt som puljens median. Alt bånd-bruddet kommer derfra. Fjerner man tier 3 fra tallene, er hele spillet inden for båndet.

| måling (27/7-3/8, ren post-cutover-data) | værdi | bånd |
|---|---|---|
| share4PlusSameTeamTop10, **alle** puljer | 0,109 (29/265 etaper) | ≤0,05 ❌ |
| share4PlusSameTeamTop10, **uden tier 3** | **0,038** (8/209 etaper) | ≤0,05 ✅ |
| share4PlusSameTeamTop10, **kun tier 3** | **0,375** (21/56 etaper) | ≤0,05 ❌❌ |

Tier 3 er 21 % af etaperne og leverer 72 % af alle bånd-brud.

**Verdikt: JA, der kræves et separat fix** — og det hører hjemme i liga-/pulje-tildelingen (`economyEngine.processDivisionEnd`), ikke i `RACE_V3_TUNING`.

---

## 1. Hvem dominerer

"Wander Riders" er et **menneskehold** (manager `Lumi`), ikke et AI-hold. Det ligger i `league_division_id` 7 = **Division 3 — D**.

Top-10-koncentration pr. pulje, 27/7-3/8:

| pulje | label | HHI | top-1 holds andel af top-10 | top-3 holds andel | share4Plus |
|---|---|---|---|---|---|
| 5 | Division 3 — B | **2050** | 33,6 % | 75,0 % | **0,571** |
| 7 | Division 3 — D | **1515** | 35,7 % | 48,6 % | **0,571** |
| 6 | Division 3 — C | **1161** | 27,1 % | 47,9 % | **0,357** |
| 2 | Division 2 — A | 963 | 16,3 % | 42,7 % | 0,000 |
| 4 | Division 3 — A | 800 | 17,9 % | 37,1 % | 0,000 |
| 3 | Division 2 — B | 783 | 14,0 % | 36,0 % | 0,033 |
| 9 | Division 4 — B | 702 | 17,1 % | 30,7 % | 0,214 |
| 8 | Division 4 — A | 593 | 11,4 % | 27,1 % | 0,000 |
| 1 | Division 1 (kun AI) | 503 | 10,1 % | 23,4 % | 0,000 |
| 10-15 | Division 4 — C..H | 474-555 | 7,9-13,6 % | 20,7-27,1 % | 0-0,143 |

De værste enkelthold (antal etaper med 4+ ryttere i top 10, 15 dage):

| hold | AI? | pulje | etaper med 4+ | værste stak |
|---|---|---|---|---|
| 24/7 Aspire-Light Velo Team | nej | Div 3 — B | 8 | 5 |
| Wander Riders | nej | Div 3 — D | 8 | 5 |
| Nickstar Rockets | nej | Div 3 — C | 5 | 6 |
| FOSS-Trackman Pro Cycling | nej | Div 2 — B | 4 | 6 |

Wander Riders' egne tal i det rene vindue: **84 rytter-starter, 50 top-10-placeringer (59,5 %), 32 podier, 12 sejre.** Spillernes fornemmelse ("Wander Riders tager os alle") er korrekt målt.

---

## 2. Overlap med #2731 — samme fænomen, to målinger

Rytterne med højeste win-rate (≥5 starter, 14 dages rullende vindue, samme definition som drift-vagten):

| rytter | hold | pulje | starter | sejre | win-rate |
|---|---|---|---|---|---|
| Lars Wouters | **Wander Riders** | Div 3 — D | 9 | 6 | **0,667** |
| Nuno Carvalho | International Cycling Team | Div 4 — B | 8 | 4 | 0,500 |
| Maarten De Vries | AI Vertex Devo | Division 1 | 8 | 4 | 0,500 |
| Iván Molina | **Nickstar Rockets** | Div 3 — C | 9 | 4 | 0,444 |

Den dominante enkeltrytter sidder på det dominante hold i den dominante pulje. `maxRiderWinRate` og `share4PlusSameTeamTop10` måler **samme underliggende årsag**: et hold hvis 4-6 bedste ryttere alle er stærkere end puljens 10.-bedste rival. Hold-dominans er ikke "rytter-dominans aggregeret" — begge er følger af pulje-skævheden.

---

## 3. Hypotese-test

### (a) Samme rod som #2731 (for lav varians i motoren) — **DELVIST, men diagnosen er forkert**

Populationen er **bimodal**. Samme metrikker splittet på tier (favorit = højeste `components.terrain`, præcis som `observeRace`):

| tier | etaper | favoriteWinRate | favoritePodiumRate | share4Plus |
|---|---|---|---|---|
| Tier 1 (Div 1, 100 % AI) | 40 | 0,175 | 0,550 | 0,000 |
| Tier 2 (Div 2 A-B) | 64 | 0,172 | 0,484 | 0,000-0,033 |
| **Tier 3 (Div 3 A-D)** | 96 | **0,490** | **0,750** | **0,375** |
| Tier 4 (Div 4 A-H) | 128 | 0,156 | 0,414 | 0,038 |
| **kanonisk bånd** | | **0,25-0,40** | **0,55-0,75** | **≤0,05** |

I tier 1, 2 og 4 vinder favoritten **for sjældent** (0,156-0,175 mod bånd-min 0,25) — motoren er dér for tilfældig. I tier 3 vinder favoritten 49 % — for forudsigelig. De aggregerede drift-tal er gennemsnittet af to modsatrettede regimer.

Konsekvens: **ét globalt varians-håndtag kan ikke lukke begge ender.** Mere varians (for at trykke `maxRiderWinRate`/tier 3 ned) gør tier 1/2/4 endnu mere tilfældige; mindre varians eksploderer tier 3. Det forklarer præcis hvorfor τ=0,30-proben i 17/7-analysen kun dentede share4Plus til 5,2 % men smadrede ITT-favorit-båndet — og hvorfor #2574 konkluderede "strukturelt afkoblet". Metrikken er ikke afkoblet fra motoren; den er afkoblet fra **det globale** håndtag, fordi problemet kun findes i 4 af 15 puljer.

**Advarsel til #2731-arbejdet:** variant C (PR #2575, 17/7) blev kalibreret mod aggregatet og er en sandsynlig medårsag til at tier 1/2/4 nu ligger under bånd-min på favoriteWinRate. Enhver videre kalibrering bør scorecardes **pr. tier**, ikke mod ét gennemsnit der ikke findes i virkeligheden.

### (b) #3015-effekten (AI-ryttere på træthed 100 gør felterne svage) — **AFVIST**

| pulje-gruppe | % AI-ryttere i feltet | share4Plus |
|---|---|---|
| Div 3 — B / C / D (pulje 5, 6, 7) | **0,0 %** | 0,357-0,571 |
| Div 4 — A..H (pulje 8-15) | 73,9-93,2 % | 0,000-0,214 |
| Division 1 (pulje 1) | 100 % | 0,000 |

**Dominansen sker i felter uden en eneste AI-rytter.** De AI-tunge puljer er blandt de sundeste. Var AI-træthed årsagen, ville billedet være det omvendte.

Trætheds-gabet er desuden i dag lille: efter sæson-nulstillingen 26/7 (#2910) måler prod nu AI-hold 76,7 i gennemsnitlig træthed mod menneskehold 74,3 (2.057 hhv. 1.494 ryttere ≥95). Det er 2,4 point, ikke de 31,4 point #3015 målte 26/7 før nulstillingen. #3015 er stadig en ægte bug der skal fixes — men den lukker ikke #2557.

### (c) Ægte hold-niveau-effekt — **BEKRÆFTET, men det er roster-/pulje-koncentration, ikke en teamwork-mekanik**

Roster-størrelse er udelukket: alle puljer stiller 5,6-6,5 ryttere pr. hold pr. etape (`raceAutopick` 6-8 efter løbsklasse). Tynde felter er også udelukket: kun 6 etaper i vinduet har felt <20 ryttere, og de har share4Plus = 0,00; etaper med 120+ ryttere (250 stk.) har 0,112.

Det der adskiller puljerne er **evne-spredningen i toppen**. Top-5-styrke pr. hold ("peak" = max over flat/climbing/sprint/TT/punch/cobbles fra `rider_derived_abilities`):

| pulje | bedste hold | median hold | forhold | share4Plus |
|---|---|---|---|---|
| 2 (Div 2 — A) | 77,2 | 58,4 | 1,32 | 0,000 |
| 3 (Div 2 — B) | 82,2 | 52,7 | 1,56 | 0,033 |
| 4 (Div 3 — A) | 43,6 | 25,2 | 1,73 | 0,000 |
| 6 (Div 3 — C) | 45,2 | 24,2 | 1,87 | 0,357 |
| 5 (Div 3 — B) | 53,0 | 24,6 | 2,15 | 0,571 |
| 7 (Div 3 — D) | 57,8 | 26,0 | **2,22** | 0,571 |

Tier 3-puljerne har næsten identisk samlet styrke (658/670/636/689) og identiske medianer (24,2-26,0) — men toppen landede skævt: p100 = 43,6 / 53,0 / 45,2 / **57,8**. Wander Riders' 57,8 er på niveau med **medianen i Division 2** (52,7-58,4): holdet sidder en hel tier under sit niveau.

Når et holds 4.-bedste rytter er stærkere end puljens 10.-bedste rival, kan motorens støj ikke længere skabe variation:

| pulje | stærkeste stakker | holdets 4.-bedste | puljens 10.-bedste rival | margin |
|---|---|---|---|---|
| 7 | Wander Riders | 52 | 38 | **+14** |
| 6 | Nickstar Rockets | 44 | 33 | **+11** |
| 5 | 24/7 Aspire-Light Velo | 42 | 35 | +7 |
| 2 | Team Hansen Pro Cycling | 77 | 77 | 0 |
| 3 | LEGO-Vestas Cycling Team | 78 | 78 | 0 |
| 1 | AI Drivetrain Racing | 49 | 55 | −6 |

---

## 3b. Hvad ændrede sig 29/7 → 30/7: transfervinduet, ikke træthed

Tier 3's egen share4Plus lavede et trin: 0,000 (27/7) · 0,250 · 0,000 (29/7) → **0,500 (30/7)** · 0,750 · 0,750 · 0,250 · 0,500. De tre dominante holds største top-10-stak pr. dag lavede samme trin:

| hold | 27/7 | 28/7 | 29/7 | **30/7** | 31/7 | 1/8 | 2/8 | 3/8 |
|---|---|---|---|---|---|---|---|---|
| Nickstar Rockets | 2 | 1 | 2 | **5** | 6 | 5 | 4 | 3 |
| 24/7 Aspire-Light Velo | 2 | 4 | 3 | **5** | 5 | 5 | 5 | 5 |
| Wander Riders | 3 | 4 | 3 | **4** | 5 | 4 | 3 | 4 |

Trinnet falder sammen med at nyindkøbte ryttere fik deres **første start 30/7**:

| rytter | peak | hold | købt | første start | starter | top-10 | sejre |
|---|---|---|---|---|---|---|---|
| Lars Wouters | 66 | Wander Riders | 29/7 | **30/7** | 9 | 8 | **6** |
| Iván Molina | 46 | Nickstar Rockets | 27/7 | **30/7** | 5 | 4 | **4** |
| Andrés Lozano | 38 | Nickstar Rockets | 27/7 | **30/7** | 9 | 7 | 2 |
| Romain Girard | 67 | Wander Riders | 27/7 | 27/7 | 5 | 3 | 2 |
| Tobias Neumann | 56 | Wander Riders | 27/7 | 2/8 | 4 | 3 | 0 |

Lars Wouters **er** #2731's dominante rytter (6/9 = 0,667). Han blev købt 29/7 og kørte sit første løb 30/7.

Hvor kom de fra (`auctions`, afsluttede):

| rytter | sælger | sælgers pulje | køber | køberens pulje | pris |
|---|---|---|---|---|---|
| Iván Molina | Lidl–Leffe Pro Drinking | **Div 2 — A** | Nickstar Rockets | Div 3 — C | **9.000** |
| Andrés Lozano | Lidl–Leffe Pro Drinking | **Div 2 — A** | Nickstar Rockets | Div 3 — C | 10.001 |
| Dawid Zupan | Lidl–Leffe Pro Drinking | **Div 2 — A** | Nickstar Rockets | Div 3 — C | 30.000 |
| Tobias Neumann | LEGO-Vestas Cycling Team | **Div 2 — B** | Wander Riders | Div 3 — D | 83.258 |
| Lars Wouters | (ingen sælger — fri agent) | — | Wander Riders | Div 3 — D | 216.381 |
| Romain Girard | (ingen sælger — fri agent) | — | Wander Riders | Div 3 — D | 80.537 |

**Mekanismen er cross-tier-transfers i sæsonstarts-vinduet:** Division 2-hold solgte ryttere billigt NED i Division 3, og fri-agent-markedet leverede to peak-66/67-ryttere til en Division 3-trup hvis top-5 var 57,8. Iván Molina kostede 9.000 og har siden vundet 4 af 5 starter.

### Afgørelse mellem orkestratorens tre kandidater

- **(a) Trætheds-differentiering vokser siden cutoveren — AFVIST.** Hele bruddet ligger i tier 3, som er **100 % menneskehold**. #3015-bug'en (AI-hold restituerer aldrig) kan pr. konstruktion ikke differentiere hold i en pulje uden AI — alle tier 3-hold får det samme daglige træningssweep. #2731's uafhængige mekaniske argument (`FATIGUE_RACE_WEIGHT` capper på 0,030 mod terræn-spredning 0,106, og AI's gennemsnitsstraf er *lavere* end menneskers) peger samme vej. Timing-korrelationen i den aggregerede kurve var et sammenfald: fatigue-nulstillingen og transfervinduet lå begge omkring cutoveren 26/7.
#### Den specifikke hold-AGGREGAT-kanal for #3015

Indvendingen er rimelig: #2731's størrelsesordens-argument (maks trætheds-straf 0,0338 mod terræn-sd 0,106) gælder **pr. rytter**, og 8 ensrettede små handicaps på ét hold kunne i princippet flytte hold-metrikken selv om ingen enkelt rytter flyttes mærkbart. Kanalen er målt direkte og er lukket:

**1. Der er ingen hold-aggregat-forskel at bære effekten.** Gennemsnitlig trætheds-værdi pr. HOLD (kun hold med ≥6 ryttere, 3/8):

| gruppe | hold | middel af hold-middel | median-hold | p90-hold | sd på tværs af hold |
|---|---|---|---|---|---|
| AI-hold | 188 | **79,2** | 72,1 | 100,0 | 18,3 |
| Menneskehold | 175 | **79,2** | 84,9 | 100,0 | 20,6 |

Forskellen på hold-niveau er **0,0 trætheds-point**, og medianen peger den modsatte vej (AI-hold er *mindre* trætte end median-menneskeholdet). "61 % af AI-ryttere på loftet mod 46 % af menneske-ryttere" er en rytter-optælling; menneskeholdenes fordeling er mere bimodal (nogle ryttere på 0 efter hvile, mange på 100), så det AGGREGAT der faktisk sender 8 ryttere ind i et løb er ens.

**2. Dosis-respons går den forkerte vej.** Var kanalen aktiv, ville dominansen stige med AI-andelen i feltet. Den falder monotont (265 etaper):

| AI-andel i feltet | etaper | share4Plus | gns. største stak |
|---|---|---|---|
| **0 %** | 116 | **0,190** | 2,59 |
| 50-89 % | 86 | 0,081 | 2,13 |
| 90-100 % | 63 | **0,000** | 1,63 |

Al dominans ligger i felterne uden en eneste AI-rytter; felterne der er 90-100 % AI har nul brud. Kanalen kan derfor hverken forklare niveauet eller trinnet 30/7 — og i tier 3, hvor 100 % af bruddet ligger, findes den slet ikke, fordi der ikke er AI-hold at differentiere mod.

Dette afviser #3015 **som driver af hold-dominans**. Bug'en er stadig ægte og skal fixes.

- **(b) Kalender-sammensætning — AFVIST som forklaring på trinnet.** Bjerg-etaper optræder både 29/7 (share4Plus 0,000) og 30/7+ (0,500-0,750). Profilmixet forklarer dag-til-dag-støj, ikke niveauskiftet. Feltstørrelserne er stabile 134-145 hele vejen.
- **(c) Transfers — BEKRÆFTET.** Rytter-niveau-evidensen ovenfor: købsdato → første start 30/7 → trinnet i samme døgn, i tre uafhængige puljer samtidig.

---

## 4. Rod-årsag i koden: pulje-tildeling er styrke-blind

`economyEngine.js`:

- `buildPoolTree` (`:2045-2076`) udleder forælder/barn af `pool_index` som et fast binært træ.
- **Oprykning** (`:2117-2124`): puljens top-2 går til den ENE forælder-pulje. Ingen valgmulighed.
- **Nedrykning** (`:2158-2165`): bund-4 fordeles round-robin over børne-puljerne i `pool_index`-orden — `realIdx` nulstilles pr. forælder-pulje, så laveste `pool_index` systematisk får det bedst placerede nedrykker fra hver gren.

Der er **ingen rating, ingen seeding, ingen re-draw inden for en tier**. En teams pulje er en ren funktion af hvilken pulje den kom fra. Skævheder låses derfor fast og forstærkes over sæsoner.

Styrke-balancering findes i kodebasen — `pyramidCompression.js:143-152` `snakeAssign`, med kommentaren *"Balancerer styrke, så pulje A ikke støvsuger alle top-seeds"* — men **kun** i engangs-scriptet `compressPyramid.js` (S1→S2), uopnåeligt fra den normale sæsonovergang.

De to øvrige steder der skriver `league_division_id` er også styrke-blinde og vælger pulje efter **færrest hold**:
- nye tilmeldinger: `teamProfileEngine.js:224-229` (`pickDivisionForNewTeam`)
- beta-reset: `betaResetService.js:252-263` (`pickLeastFilledPool`)

Konstanterne i `economyConstants.js` (`POOL_TARGET_SIZE=24`, `PROMOTION_SLOTS=2`, `RELEGATION_SLOTS=4`) balancerer udelukkende **hovedtal**, aldrig kvalitet. `audit-league-size-invariant.js` auditerer ligeledes kun størrelse.

Bidragende faktor: holdene forstærker skævheden i sæsonen via transfers. Nickstar Rockets har hentet 4 af sine 5 ryttere med peak ≥40 siden cutoveren 26/7; Wander Riders 3 af 7.

---

## 5. Målemetodiske fund (vigtige for al fremtidig backtest)

1. **Drift-tal fra før 27/7 er ubrugelige.** `race_results` fra før sæson-cutoveren har 45-59 % NULL `team_id` (ryttere/hold nulstillet ved rollover, FK'erne ryddet bagefter). `observeRace` tæller null-hold som "solo-hold", så alle `share4Plus`/`avgDistinctTeamsTop10`-tal før 27/7 er systematisk **for lave**. Sammenlign aldrig hen over cutoveren.
2. **Issue-bodyens tal er stale.** "favoriteWinRate monotont stigende → 51 %" er målt 13-16/7, før variant C. Live er favoriteWinRate nu oftest **under** bånd-min, ikke over.
3. **Den seneste "forbedring" er en sammensætnings-effekt, ikke en bedring.** Aggregatet faldt 0,171 → 0,098 → 0,073 fordi andelen af tier 3-etaper pr. dag svinger (8/4/8 af 24-37 etaper), ikke fordi tier 3 blev bedre. Tier 3 alene: 0,000 (27/7) → 0,250 → 0,000 → 0,500 → 0,750 → 0,750 → 0,250 → **0,500** (3/8). Der er **ingen** selvkorrigerende nedadgående trend.
4. **`favoritePodiumRate`s røde vip 2/8 (0,51 mod min 0,55) har samme forklaring**: tier 2 (0,484) og tier 4 (0,414) ligger permanent under båndet, tier 3 på 0,750 trækker aggregatet op. Når dagens løbsmix har få tier 3-etaper, falder aggregatet under min. Det er endnu et symptom på bimodaliteten, ikke et selvstændigt problem.

---

## 6. Verdikt og anbefaling

**Kræver hold-dominans et separat fix ud over #2731 + #3015? — JA.**

- #3015 (AI-træthed) rører ikke tier 3, hvor der ikke er AI-ryttere. Fix'et er stadig rigtigt af andre grunde.
- #2731 (global varians-kalibrering) kan ikke ramme begge ender af en bimodal population. Yderligere global tuning vil gøre 11 af 15 puljer værre for at afhjælpe 4.
- Det akutte håndtag er **cross-tier-transfers** (afsnit 3b); det strukturelle er **styrke-balanceret pulje-tildeling** (afsnit 4).

### Forlig med #2731's slutrapport

#2731 konkluderer at `maxRiderWinRate` er målestøj (max over brøker med nævner 5-7) og at `share4PlusSameTeamTop10` er den eneste statistisk robuste breach. **Enig i statistikken, med én tilføjelse:** `maxRiderWinRate` er ikke *ren* støj. Dens toprytter er Lars Wouters — købt 29/7, første start 30/7, 6 sejre på 9 starter — altså præcis den samme kausale begivenhed som driver share4Plus, bare målt med en for lille nævner til at duge som alarm. Konklusionen bør derfor være "maxRiderWinRate er en dårlig *alarm-metrik*, ikke et selvstændigt problem", ikke "der skete ikke noget". Hæv `minStarts` (eller drop metrikken som alarm-berettiget) OG fix årsagen i denne sag — så forsvinder begge symptomer.

Enig i at variant C har overshot: mine per-tier-tal viser at tier 1/2/4 nu ligger på favoriteWinRate 0,156-0,175 mod bånd-min 0,25. Det bør rulles tilbage — men først EFTER at tier 3-skævheden er fjernet, ellers kalibrerer man igen mod et gennemsnit af to modsatrettede regimer.

### Anbefalet rækkefølge

1. **Nu (denne PR, inert):** mål problemet permanent. Per-tier-opdeling i balance-drift-vagten, så aggregatet aldrig igen kan skjule to modsatrettede regimer. Plus en ren `poolBalance`-lib + read-only audit-script der kvantificerer pulje-skævheden og beregner hvad en snake-reseed ville give.
2. **Ejer-beslutning:** vælg politik for pulje-tildeling (se A/B nedenfor).
3. **Før ship:** kør `seasonStartScorecard`/dry-run-harnessen mod den valgte politik — fast simulér-før-ship-politik for alt balance-følsomt.
4. **Derefter:** genbesøg #2731 med et **per-tier** scorecard. Sandsynligvis skal den globale varians *ned* igen (tier 1/2/4 er for tilfældige), når tier 3-skævheden ikke længere skal kompenseres globalt.

### A/B til beslutningsrunden

De to spor rammer hver sin halvdel. Sporet der ville have forhindret **denne** hændelse er A.

**A — Dæmp cross-tier-transfers (det akutte).**
En Division 3-trup med top-5 på 57,8 kunne 27-29/7 hente ryttere med peak 66 og 67 — Division 1/2-kaliber — og en Division 2-manager solgte tre brugbare ryttere ned i Division 3 for 9-30.000. Kandidat-indgreb: (i) evne-loft relativt til købers tier, (ii) tier-præmie på prisen ved salg nedad, (iii) karantæne så en nyindkøbt rytter først må starte efter n løbsdage.
Fordel: rammer den målte mekanisme direkte. Omkostning: begrænser legitim opbygnings-strategi, og (i)/(ii) rører transfer-økonomien lige efter at pris-gulv/-loft landede (#3133/#3136) — de to skal designes sammen, ikke hver for sig.

**B — Styrke-balanceret re-seed pr. tier ved sæsonovergangen** (snake på styrke over tierens puljer, efter op/nedrykning; tærskel-variant så kun skæve tiers røres).
Fordel: fjerner den strukturelle skævhed permanent og selvkorrigerer hvert år. Omkostning: managere kan skifte pulje mellem sæsoner, så pulje-rivaliseringer nulstilles. **Ville ikke have forhindret denne hændelse** — købene skete lige EFTER overgangen.

**Anbefaling: A først (karantæne-varianten (iii) som mindst indgribende), B som opfølgning.** En startkarantæne på nyindkøbte ryttere er den eneste af de tre A-varianter der hverken rører prismodellen eller forbyder et køb — den udjævner bare stødet, så en pulje ikke skifter karakter fra én dag til den næste. B bør stadig laves, ellers reproduceres baseline-skævheden ved næste overgang.

**Ingen af delene bør shippe uden en harness-kørsel først** (simulér-før-ship). Tærsklen `DEFAULT_RESEED_THRESHOLD = 10` i `backend/lib/poolBalance.js` er sat mellem de målte regimer (margin ≤7 ⇒ share4Plus 0,000; ≥11 ⇒ 0,357-0,571) og er **ikke** verificeret endnu.

### Åbne spørgsmål til ejeren

1. Er "køb dig stærk i en lav division" legitim strategi der bare skal matches af hurtigere oprykning — eller skal den dæmpes? (Afgør om spor A overhovedet skal bygges.)
2. Må managere skifte pulje mellem sæsoner (bryder spor B en pulje-identitet du vil bevare)?
3. Skal noget gøres ved den **igangværende** sæson i Div 3 B/C/D, eller lever vi med den og fikser til næste? En midt-sæson-korrektion er en prod-mutation og kræver dit eksplicitte go.
