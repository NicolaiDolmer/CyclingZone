# Oplåsning: værdi-sweepet og løfte-hovedbogen

Dato: 14. august 2026 (fredag). Alt måleri er read-only mod prod (Supabase-projekt `ghwvkxzhsbbltzfnuhhz`) og mod repoet. Ingen mutation, ingen merge, intet flag flippet.

Tal i dette dokument har en af tre kilder, og den står altid ved tallet:

- **(målt her)** = jeg har selv kørt querien i denne session.
- **(model-MAE)**, **(typevalg)**, **(konflikt)** = de tre forudgående måle-rapporter.
- **ikke målt** = der findes ingen måling. Der står aldrig et estimat i stedet.

---

# Del 1: Kan #3449 køre, og med hvilke valg?

## Svaret

**Nej. Sweepet kan ikke køre 14.-15/8, og #3449 skal ikke merges i sin nuværende form.**

Den første grund er ikke en vurdering, det er en kalender: **sweepet kan kun køre om søndagen.** `runMarketValueSundaySweep` returnerer `{ ran: false, skipped: "not_sunday" }` hvis det ikke er søndag i dansk tid (`backend/lib/marketValueSundaySweep.js` linje 203-238 på branch `worktree-agent-ac44bfa26a5440fcc`). Løftet blev givet tirsdag 11/8 og lyder "mellem i dag og fredag". Fredag er i dag. Næste søndag er 16/8 (målt her). **Løftet kunne ikke holdes ordret uanset modelkvalitet, og MASTERPLAN-linjen "merge + kør 14.-15/8" har aldrig været forenelig med sweepets egen kadence.** Det er værd at sige højt, fordi det betyder at valget i dag ikke er "hold løftet eller lad være", men "meld en ny dato eller meld en ny plan".

De to næste grunde afgør, om der overhovedet skal meldes en ny dato for netop denne model.

## Grund 2: Modellen måler dårligere end den der kører, og målingen er selv utroværdig

Målt på det friskeste holdout (3/8 til 14/8, n=243) er billedet (model-MAE):

| Scenarie | Markedsmodel (v1.1) | v4 (kører i dag) |
|---|---:|---:|
| Prissat på live `primary_type` | 32.896 | 45.228 |
| Prissat på frossen `valuation_type` | 32.942 | **18.445** |

Vælger man den type-kolonne som modellen er konsistent med (`valuation_type`, se grund 4), taber markedsmodellen med næsten faktor to. **At merge og flippe flaget ville være at sende en regression for at holde et løfte.**

Men det er ikke engang det værste. **Metrikken er cirkulær.** En auktions startpris defaulter til rytterens listede værdi, som er v4's eget output (`backend/routes/api.js:5116-5118` → `calculateRiderMarketValue` i `backend/lib/marketUtils.js:133-137`). Målt her på completed auctions med køber og startpris > 0, afsluttet 3/8 eller senere:

- n = 228
- solgt til **nøjagtig** startprisen: **149 (65,4 %)**
- MAE hvis man bare gætter startprisen: **8.115**

Den trivielle model "brug den værdi rytteren i forvejen var listet til" slår **begge** modeller, med god margin. To tredjedele af observationerne er altså ikke en måling af markedet, det er en måling af hvor tæt en model ligger på v4's eget anker. Selv på delsættet hvor budgivning faktisk flyttede prisen (model-MAE, holdout n=65) vinder ankeret: 24.984 mod markedets 36-37.000 og v4's 29.351.

**Konsekvensen for beslutningen:** både argumentet "merge, fordi 56.118 slog 119.571" og argumentet "bloker, fordi 38.176 tabte til 28.968" er udledt af den samme utroværdige metrik. Vi ved ikke hvilken model der er bedst. Vi ved kun, at ingen af dem slår "hvad rytteren stod til i forvejen". Det er ikke et grundlag at flytte 252 mio. CZ$ spillerejet værdi på (målt her: 3.136 spillerejede ryttere, 252.226.283 CZ$ i sum).

## Grund 3: Sweepet straffer styrke, og det er uafhængigt af typevalget

Simuleret med sweepets egen kæde mod prod (typevalg). Median-ændring for spillerejede ryttere, fordelt på værdi-decil:

| Decil | Værdi i dag | Uge 1, live type | Uge 1, frossen type | Ved konvergens, live | Ved konvergens, frossen |
|---|---|---:|---:|---:|---:|
| 1 (billigst) | 303-1.627 | +9,5 % | +25,0 % | +205,9 % | +281,6 % |
| 5 | 6.510-9.007 | +11,9 % | +19,4 % | +42,4 % | +42,5 % |
| 9 | 45.408-125.107 | **-25,0 %** | **-25,0 %** | -60,3 % | -60,2 % |
| 10 (dyrest) | 125.181-23.117.539 | **-25,0 %** | **-25,0 %** | **-73,2 %** | **-73,3 %** |

De to øverste deciler rammer bundloftet på -25 % **med det samme, hver uge, under begge typevalg.** Det er en monoton omfordeling fra dyre til billige ryttere. Doktrinen siger at styrke aldrig straffes, og at balance sikres gennem struktur. Et uniformt loft der bider hver uge på præcis de bedste ryttere er det modsatte af struktur, det er et handicap.

**Den ærlige nuance, som du skal træffe beslutningen på:** et fald i toppen er ikke automatisk et doktrinbrud. Andrea Riva står i 23.117.539 CZ$ (målt her, højeste spillerejede værdi), og det tal kommer sandsynligvis selv fra anker-løkken beskrevet i grund 2, ikke fra at rytteren er 23 mio. værd. En korrektion af en modelfejl er legitim. Problemet er, at **sweepet ikke kan skelne** mellem "denne rytter er overvurderet af en ødelagt model" og "denne rytter er reelt elite". Begge får -25 % om ugen indtil de rammer bunden. Skal toppen korrigeres, skal det ske som en engangs-korrektion du har set og godkendt, ikke som en ugentlig kværn.

## Grund 4: Artefaktet er fittet på en verden der ikke findes mere

`backend/lib/marketValueModelV1.json` på branchen har `fitted_at` 2026-08-06 og typeoffsets estimeret på 5/8-typefordelingen (konflikt). Siden er #3570-reparationen kørt. Målt her, med sweepets egen populationsafgrænsning (`defaultFetchPopulation`: team_id sat, ikke test/frosset/bank-hold, ikke retired, ikke academy):

- Population: **6.429**
- Ryttere hvor `primary_type` afviger fra `valuation_type`: **4.811 (74,8 %)**
- Ryttere uden `valuation_type`: **0**

PR-teksten dokumenterer 4.027 af 6.455 (62,4 %) pr. 10/8. Divergensen er vokset 12 procentpoint på fire dage. Typeoffsettet er modellens næststørste led, og spændet er `exp(0,611)` = **+84,3 %** i markeds-mål for præcis de samme evner (typevalg). En koefficient estimeret på 297 puncheur-observationer, hvor der nu er 1.007 puncheurs (konflikt), er ikke en priseffekt længere. Det er støj fra en fordeling der ikke eksisterer.

Det er ikke en fremtidig risiko. Det er en fejl i artefaktet i dag.

## Hvis det alligevel skulle køre: hvilke valg

Spørgsmålet var også, hvilke valg der skulle træffes, hvis det kørte. Svaret, for fuldstændighedens skyld:

1. **Typekolonne: den frosne `valuation_type`.** `backend/lib/riderValuation.js` linje 117 læser `valuation_type` først, så vælger man live `primary_type`, prissætter markeds-leddet og v4-leddet to forskellige ryttere for 4.811 af 6.429 (målt her). Live typen er desuden ustabil: +784 ryttere skiftede væk fra deres frosne type på fire dage (typevalg). Men bemærk: **typevalget redder ingen.** Median-forskellen mellem de to er 0,00 %, og 7 af de 10 største tab er bit-identiske (typevalg).
2. **Ophæv ikke frysningen (mulighed C).** Målt med den live v4-model: +40,8 % samlet inflation, 516 spillerejede ryttere taber over 25 % natten over, 192 taber over 50 % (typevalg). #3345's fortegn er vendt siden 4/8.
3. **Loftet skal ned.** ±25 % er kalibreret på en simulering fra 6/8. Med support-vægtningen på `valuation_type` stiger gennemsnitlig support fra 0,624 til 0,821 og antallet af fastfrosne ryttere falder fra 172 til 51 (typevalg), altså flytter sweepet **flere** ryttere **hurtigere** end da loftet blev valgt.
4. **Lønvirkningen skal ses først.** Kørt gennem #3393's foreslåede formel falder D2-holdenes lønudgift med **en tredjedel** ved konvergens (median -33,8 % / -34,5 %), mens D3 og D4 stiger cirka 10 % (typevalg). #3393 er stadig draft, så det er en simulering af en foreslået formel, ikke en måling af live løn.

Ingen af de fire valg gør grund 2 og 3 mindre sande. De er svar på "hvordan", ikke på "om".

## A eller B

**A) Udskyd sweepet. Meld en ny og ærligere plan til spillerne i dag. Træf typebeslutningen, refit modellen mod den valgte kolonne, og gen-mål på det konkurrenceprissatte delsæt frem for på alle handler.** 👍

**B) Merge nu med kill-switch off, så arbejdet er "landet", og refit senere.** 👎

B sparer intet. Artefaktet skal alligevel skiftes før flaget kan flippes, og en model med forkerte typeoffsets liggende i `main` er en fælde for næste session. Dertil: de tre config-nøgler findes ikke i prod i dag (målt her: `select key from app_config where key like 'market_value%'` returnerer 0 rækker), så sweepet er inert indtil migrationen er kørt OG flaget flippet. Der er ingen "vi merger bare"-gevinst at hente.

**Anbefaling: A.**

Konkret på branchen (konflikt): rebase den (én triviel konflikt, ét hunk i `backend/scripts/lintRiderTypeWrites.js`, begge sider tilføjer additivt), behold koden og de 49 unit-tests, **slet modelartefaktet** (`backend/lib/marketValueModelV1.json` og `marketValueModelV1.draft.json`), og lad PR'en blive stående som draft. Koden er ikke drevet fra main: alle importer, O-definitionen og typenøglerne er uændrede, og #3665's vægt-tabel-split er bevist adfærdsneutralt.

## Hvad man siger til spillerne i stedet

Et ændret løfte er bedre end en brudt måling. Det her skal du selv poste, jeg sender intet.

Det ærlige indhold er: vi målte den nye model mod den der kører, og den nye var dårligere. Og målemetoden viste sig at måle noget andet end vi troede. Ingen af delene er nederlag, det er grunden til at man måler først.

Udkast (EN først, DA under). Ingen dato, fordi vi ikke har en vi kan holde:

> **EN:** The value and wage recalibration is not shipping this week. We built it, then measured it against the model that is running today, and the new one priced riders worse. We also found that our own accuracy test was partly measuring itself: two out of three auctions close at exactly the price the current model had already put on the rider, so "being accurate" mostly meant "agreeing with ourselves". We are not moving your squad's value on a number we cannot trust. The work is not thrown away. It goes back to being fitted and measured properly, and you get a patch note before anything moves, not after.

> **DA:** Værdi- og lønjusteringen kommer ikke denne uge. Vi byggede den, målte den mod den model der kører i dag, og den nye satte dårligere priser. Vi opdagede samtidig at vores egen præcisionstest delvist målte sig selv: to ud af tre auktioner lukker på præcis den pris den nuværende model allerede havde sat på rytteren, så "at ramme rigtigt" betød mest af alt "at være enig med os selv". Vi flytter ikke værdien af dit hold på et tal vi ikke kan stole på. Arbejdet er ikke smidt væk. Det skal fittes og måles ordentligt, og du får en patch note før noget flytter sig, ikke bagefter.

To ting bevidst udeladt af udkastet, som du skal beslutte om du vil have med: at der var en fredagsdato, og at den top-decil-mekanik vi målte ville have skåret 25 % af de dyreste ryttere hver uge. Min anbefaling er at nævne datoen (spillerne husker den, og at springe den over ser værre ud end at indrømme den) og ikke nævne decil-tallet, fordi det beskriver en mekanik der ikke kommer til at køre i den form.

## Før sweepet kan køre, uanset dato

1. **Ejer-beslutning: live `primary_type` eller frossen `valuation_type`.** Den er stadig ikke truffet, og divergensen er nu 74,8 % (målt her).
2. **Refit mod den valgte kolonne.** Artefaktet er 8 dage gammelt og fittet på 1.027 af nu 1.215 handler (model-MAE).
3. **Ny målemetode.** MAE mod salgspris skal erstattes eller suppleres, fordi 65,4 % af handlerne lukker på ankeret (målt her). Mål på det konkurrenceprissatte delsæt, og rapportér median ved siden af MAE (median-absolut-fejl er 4.801 til 7.355 mod MAE 33.000 til 45.000, så få store handler bestemmer rangordenen, model-MAE).
4. **Rekalibrer K og guard-vinduerne** mod de nye tætheder. `zero_support_share` på 19,2 % i artefaktet er målt på en fordeling der ikke findes (konflikt).
5. **De to præmis-fejl PR'en selv flager:** alders-definitionen (fit på kontinuert kalenderalder, runtime på heltals-sæsonalder) og popularity-konfounden (`g_popularity` er negativ i alle kørsler, model-MAE).
6. **Du ser live-tilstanden før første kørsel.** Det er en økonomi-mutation af hele populationen, og reglen er at du har set tilstanden og godkendt netop det skridt.

## Hvad der kunne gøre denne konklusion forkert

- **Holdout-vinduerne er ikke sammenlignelige.** Median salgspris er faldet fra 36.153 (6/8-vinduet) til 10.000 (i dag), og andelen under 5.000 CZ$ er gået fra 19 % til 34 % (model-MAE). En del af "vendingen" mellem de to modeller er et skift i hvad der handles, ikke i modellerne.
- **v4 evalueres med dagens evner**, ikke med den værdi rytteren faktisk var listet til på salgsdagen. Det straffer v4 hårdt på gamle handler og belønner den på nye (model-MAE).
- **Historiske `primary_type`-værdier kan ikke rekonstrueres.** Der findes ingen historik-tabel. 5/8-snapshottet er det eneste faste punkt, og derfor kan hverken 6/8- eller 10/8-kørslen reproduceres fuldt (model-MAE). Alt om hvad harnessen læste de dage er slutning, ikke måling.
- **Effekten med en refittet model er ikke målt.** Det er muligt at et frisk fit mod den valgte type-kolonne slår v4. Det ved vi ikke, og det er præcis derfor anbefalingen er "refit og mål", ikke "drop modellen".
- **Løn i dag mod løn efter er ikke målt** med den nuværende cpv-formel, fordi #3393 er draft og der ikke findes en live værdi-drevet lønudgift at sammenligne med.

---

# Del 2: Løfte-hovedbogen

14 af 42 undersøgte løfter er ikke eller kun delvist indfriet. Sorteret efter hvor længe spilleren har ventet, ældst først. "Ventet" er dage fra løftet blev givet til i dag, 14/8.

| # | Hvad blev lovet | Hvornår | Ventet | Status | Hvad mangler konkret |
|---|---|---|---:|---|---|
| 1 | De første 50 abonnenter bliver permanente Founders med et synligt badge, og "mere om det snart" | 25/7, Discord | 20 dage | Delvist | Founder-mekanikken er bygget (`ProUpgradePage.jsx`, PR #2727, patch note v7.35), men det spilleren ventede på, nemlig hvornår de 50 kan købe, mangler. Køb er hardkodet lukket begge steder: `frontend/src/pages/ProUpgradePage.jsx:33` og `backend/lib/billingCheckout.js:16` har `CHECKOUT_PAUSED = true` (503 checkout_paused). Prod: 1 abonnement i alt. Ingen dato meldt ud. #2813 åben |
| 2 | Sidste S1-etaper kører søndag aften, og sæson 2 starter mandag kl. 11:00 CEST | 25/7, Discord | 20 dage | Delvist | Søndag aften og mandagsdatoen holdt. Klokkeslættet gjorde ikke: første S2-etape kørte mandag 27/7 kl. 18:00 dansk tid, syv timer efter det lovede, og der lå ingen etape kl. 11:00 overhovedet. Om redigeringen af Discord-beskeden 26/7 rettede tidspunktet: **ikke målt** (beskeden kunne ikke læses) |
| 3 | Bestyrelsestilfredshed genoprettes automatisk for de seks hold der fik et umuligt mål | 31/7, Discord | 14 dage | Delvist | Straffen er stoppet og 5 af 6 hold glider selv op. Men S2-ankeret (`season_start_satisfaction`, sat ved S1-slut-evalueringen 26/7 med det umulige mål stadig i sættet) er aldrig repareret, og Ardennaise er gået fra 41 til **39** på 14 dage, altså under sit eget anker på 45. #3174 |
| 4 | Spildte angrebsforsøg skal på sigt koste kræfter, så man kan brænde for mange tændstikker | 2/8, Discord | 12 dage | Ikke leveret | Hele mekanikken. Udbrudsbonussen er stadig altid ≥ 0 i `raceSimulator.js` (linje 410-456, 665), og træthedsmodellen kender slet ikke angrebsforsøg (0 træffere på breakaway/attack i `raceFatigue.js`). #3413 åben. Ingen dato blev lovet |
| 5 | "Completed"-området på resultatsiden bygges helt om, og de to sidste widgets slettes | 3/8, Discord | 11 dage | Ikke leveret | Alt. "Top teams" og "Top scorers" står stadig i `ResultaterPage.jsx` (linje 507-574), `CompletedRacesExplorer.jsx` er uændret, og de 4 commits siden 3/8 er punktfixes. Der findes hverken PR, patch note eller åbent issue der bærer løftet |
| 6 | Et beskedsystem i spillet, så managere kan skrive til hinanden. "Det kommer helt sikkert" | 3/8, Discord | 11 dage | Ikke leveret | Alt: ingen datamodel (ingen tabel til spiller-til-spiller i prod), intet endpoint, ingen UI, ingen patch note. Ligger som to åbne issues, #3200 (design-fase) og #2209. Ingen dato blev lovet, så løftet er ikke overskredet, bare uleveret |
| 7 | En stor generel omlægning af transfersystemet er stadig planlagt | 3/8, Discord | 11 dage | Ikke leveret | Alt. Koden har fortsat kun ét prisfelt (`asking_price`), der findes intet `auto_accept_price` nogen steder, direkte hold-til-hold-tilbud lever stadig, og der er ingen 30-minutters auto-auktion. #2176 er åben med ejer-godkendt kontrakt, men intet er bygget |
| 8 | Potentiale skifter fra 6-stjerners skala til 1-99 som resten af spillet | 4/8, Discord | 10 dage | Ikke leveret | Visningen. `PotentialeStars.jsx` renderer stadig stjerner og bruges tre steder. #2454 åben. Retningen er desuden ændret af dig selv 13/8 (behold 1-6 internt, vis potentiel rating fra `ability_caps`), og den nye retning er heller ikke bygget. Spilleren har ikke fået noget at vide |
| 9 | Dashboardet skal kunne tilpasses komplet, med egen rækkefølge og måske størrelse, som telefon-widgets | 4/8, Discord | 10 dage | Ikke leveret | Rækkefølge og størrelse. `useDashboardLayout.js` gemmer kun booleans pr. modul-id, rækkefølgen er hardkodet, og der findes ingen drag/reorder/size-kode. Kun vis/skjul-toggles er leveret. #2442 og epic #3513 åbne |
| 10 | Tallene flyttede sig én gang med denne rekalibrering og flytter sig kun igen når rytteren selv udvikler sig | 6/8, i app | 8 dage | Ikke leveret, tilbagekaldt | Løftet kan ikke indfries som formuleret: skalaen er forankret i rytterpuljen, så et gen-fit af ankrene flytter alle tal uden at nogen rytter udvikler sig. v7.119 (13/8) tilbagekalder det offentligt og ordret. Det eneste leverede er korrektionen plus et nyt løfte om patch note ved hvert gen-fit. #3667 |
| 11 | Ryttere på 22+ rettes med samme korrektion, og det annonceres **før** det kører | 10/8, i app | 4 dage | Delvist | Forhåndsannonceringen. Selve korrektionen er kørt og målt i prod (5.795 af 5.795 på 22+ har fast primær og sekundær type), men patch noten der omtaler kørslen (v7.113, 11/8) beskriver den i datid og udkom samme dag som kørslen kl. 08:12. Ingen forhåndsannoncering fundet. Restpunkt: 35 af 5.795 mangler stadig `archetype_draw`. #3593 |
| 12 | Vi ved præcis hvorfor de fire typepar ikke kan skelnes, og det er på listen at rette ordentligt | 10/8, i app | 4 dage | Ikke leveret | Hele rettelsen. Rod-årsagen er uændret: negative vægte springes stadig over (`riderValuation.js:51`), `naturalPrimaryFactor` er stadig flad (`riderProgression.js:82`), og delmængde-relationerne i vægt-tabellerne er uændrede. Kildefilen skriver selv at de negative tal er "i dag rent dekorative". Kun bit-identisk refaktor (#3670) er landet. #3592 åben |
| 13 | Flere ungdomsryttere på auktionsmarkedet, og ubesvarede tilbud forlader indbakken tæt på de syv dage | 11/8, i app | 3 dage | Delvist | Anden halvdel. Første halvdel er leveret og målt (ungdomsauktioner fra 30/dag til 61-66/dag siden 11/8). Men tilbud udløber efter 10,8 til 11,8 dage i gennemsnit, 160 tilbud er over deres syv dage, og køen er vokset fra de 368 der stod i patch noten til **772**, fordi 60/dag-kvoten bruges fuldt ud hver eneste dag. Indstrømningen overstiger kapaciteten. #3618 |
| 14 | Allerede forkortede akademi-kontrakter er ikke repareret, og reparationen spores som sin egen opgave | 14/8, i app | 0 dage | Delvist | Reparationen. Sporingsdelen er indfriet samme dag (#3715 er oprettet, åben og beskriver afgrænsningsproblemet plus en 4-trins plan). Selve reparationen findes ikke: ingen repair-fil i `database/proposals/`, og prod-data er uændret (1.297 ryttere på længde 2 / udløb 3, 1.162 på 3/4). Rod-årsagen #3620 er stadig åben |

**Fodnote til hovedbogen:** løftet fra 11/8, "værdier og lønninger mellem i dag og fredag", står ikke i de 42 undersøgte, men det brydes i dag. Det behandles i Del 1. Det bringer tallet til 15.

## De tre jeg vil tage først

### 1. Beskeden om værdier og lønninger. I dag.

Fordi løftet brydes i dag, og fordi tavshed er det eneste udfald der er værre end en udskydelse. Alle de andre 14 løfter har det til fælles, at spilleren venter uden at vide om noget sker. Det her er det ene sted hvor du kan fjerne uvisheden på en time, uden at bygge noget. Udkastet ligger i Del 1.

Det er også det billigste sted at etablere en vane der forebygger resten af listen: en dato meldes ikke ud før den er bundet til noget målt.

### 2. #3618, udløbskvoten på akademi-tilbud.

Fordi det er det eneste løfte på listen der **bliver mere usandt mens vi ser på det.** Køen af ventende tilbud er vokset fra 368 til 772 siden løftet blev givet for tre dage siden, kvoten på 60 om dagen rammes fuldt ud hver eneste dag, og faktisk levetid er 10,8 til 11,8 dage mod de lovede syv. Alle andre punkter på listen står stille. Det her divergerer.

Det er også målt hele vejen: vi ved præcis hvilken konstant der er for lav (`INTAKE_EXPIRY_STEADY_PER_DAY = 45`, `CATCHUP = 60` i `backend/lib/academyIntakeExpirySweep.js:66-74`), og vi ved hvad den skal måles imod. Det er den korteste vej fra "brudt løfte" til "målt indfriet" på hele listen. **Ikke målt:** hvilken kvote der faktisk lukker gabet, kun at 60 ikke gør.

### 3. #3715 og #3620, de forkortede akademi-kontrakter.

Fordi det er skade på spillerens ejendom, ikke en manglende feature, og fordi det er det eneste punkt hvor **ventetiden gør reparationen sværere.** #3715 dokumenterer selv at en forkortet kontrakt ikke kan skelnes fra en normal ud fra nuværende tal. Hver dag hvor rod-årsagen #3620 stadig er åben, tilføjes flere ryttere til en mængde vi ikke kan afgrænse bagefter. De to backup-tabeller fra 25/7 og 5/8 er de faste punkter vi har, og de bliver ikke bedre af at vente.

Bemærk rækkefølgen inden for punktet: **rod-årsagen (#3620) først, derefter datareparationen.** At reparere data mens fejlen stadig producerer ny skade er spildt arbejde.

### Hvorfor ikke de to næste

**#2813, Founders.** Det er det ældste løfte (20 dage) og det eneste med penge i den anden ende, så det er tæt på at komme med. Det taber, fordi det ikke er blokeret af udvikling. Mekanikken er bygget, betingelserne er skrevet, og `CHECKOUT_PAUSED` står på `true` i begge lag og venter på dine go-live-tjek. Det er dit skridt, ikke et stykke arbejde jeg kan tage. Men det er 20 dage siden du skrev "more on that soon", og hvis åbningen ikke er nær, fortjener de 50 pladser en besked om hvorfor.

**#3174, Ardennaise.** Ét hold er 14 dage efter stadig ikke genoprettet og ligger under sit eget anker. Det er lille i omfang og stort i princip, fordi det er et hold der stadig bærer konsekvensen af en fejl vi selv lavede. Det taber kun på volumen, ikke på berettigelse. Tag det som en lille opgave oven på ét af de tre.
