# Træn nu = hele dagen i ét klik (#6461, design 23/10 2026)

> **Status: ejer-beslutning 24/10: B (hele dagen for alle i klikket), designet og bygget samlet med løbsmotoren og form/træthed 2.0 (#6984) nu, ikke A som mellemtrin.** Ingen kode i denne PR. §7's forudsætninger (fælles lås, målt baseline før første PR, hard rule 36) gælder uændret, og B's motor-del kræver motor-review.
> Bygges tidligst efter skiftet 25/10 (ejer-kommentar 20/10 på #6461).
> Bygger på: [`2026-09-29-traen-nu-og-prognose-design.md`](2026-09-29-traen-nu-og-prognose-design.md) (beslutning 1-9, I1-I5),
> [`TRAINING_RULES.md` §13.3b](../../TRAINING_RULES.md) (realisme-reglen 18/9) og MASTERPLAN Nu 4 ("Træn nu = hele dagen i ét klik").
> Hænger sammen med #6984 (form/træthed 2.0).
> Fulde måletal (ikke offentlige): `balance-internals/2026-10-23-6461-train-now-measurement.md`.

## 1. Kort

- **Det er ikke en tilfældig fejl. Koden gør præcis, hvad specifikationen fra 29/9 siger.** Klikket afregner alle løbsdage på datoen undtagen den sidste. Den sidste løbsdag ejer datoens ene skrivning af træthed og form, og den skrivning er reserveret til aftenkørslen (beslutning 4 + I4).
- **Ryttere med et løb i dag, der ikke er kørt endnu, får 0 af 5 ved klikket.** Hele deres dato venter på løbet og derefter på aftenkørslen. (Er løbet allerede kørt, får de 4 af 5 som ryttere uden løb.)
- **Prod (read-only, 1/10-22/10):** knappen bruges dagligt af en stor del af de aktive hold.
  - Ved tryk før aftenkørslen fik de fleste ryttere 4 af 5. En betydelig del, næsten alle med et løb samme dag, fik 0 af 5.
  - Resten kom typisk mange timer senere.
  - Ingen rytter mistede træning, og alle datoer blev afregnet til 5 af 5 om aftenen.
  - Tallene ligger privat (se ovenfor).
- **Spillerne oplever det som en fejl**, fordi knappen hedder "Træn nu" og alligevel venter på aftenen. Ejeren 20/10: "alt sker med klikket", træning skal føles som en øjeblikkelig reaktion.
- **Forslag:** variant A lader klikket afregne hele datoen (5 af 5, også træthed og form) for alle ryttere, hvis dato er kendt på klik-tidspunktet. Det er ryttere uden løb, og ryttere hvis løb allerede er kørt. Løbsryttere afregnes som i dag. Variant B tager også løbsryttere med og kræver ændringer i løbsmotoren (§6).

## 2. Hvad spilleren oplever

1. Manageren trykker "Træn nu" om formiddagen.
2. Ryttere uden løb viser 4 trænede felter af 5. Det 5. felt, og datoens træthed og form, kommer først med aftenkørslen (tidligst kl. 20 og først efter dagens sidste løb).
3. Ryttere med et løb, der ikke er kørt, viser "venter på løb" og intet trænet.
4. Prognosen "Træthed i aften" står stadig som en prognose, selv om spilleren har "trænet".

To spillere har meldt det uafhængigt af hinanden: #bugs 10/10 ("only trained 4 sessions") og staff 11/10 ("5/5 i stedet for 4/5, så man ikke skal vente til ca. 20:30"). Staff 20/10: træningen føles ligegyldig, fordi den ikke kan følges, når man selv vil.

## 3. Rod-årsag i koden

| Hvad | Hvor | Effekt |
|---|---|---|
| `trainNowGameDays(gameDays)` returnerer `days.slice(0, -1)`: alle datoens løbsdage **undtagen den sidste** | `backend/lib/trainNow.js` (`trainNowGameDays`, kommentaren øverst i filen: "What the press deliberately does NOT settle") | Ryttere uden åbent løbsslot får 4 af 5 |
| Den sidste løbsdag er den eneste, der skriver tilstanden (`settlesCondition = raceDay === dateDays.at(-1)`) | `backend/lib/dailyTrainingEngine.js` | Træthed og form følger med 5. dag og venter derfor også |
| RPC'en afviser tilstandsskrivning på andre dage end den sidste ("Condition writes only at date settlement") og kræver tidligere dage committet først ("Earlier rider date ticks must commit first") | `commit_training_date_tick`, `database/2026-10-10-6439-training-follows-rider.sql` | Rækkefølgen er låst: dag 1-4, så dag 5 med tilstand |
| `splitTrainNowRiders`: en rytter med et uafklaret løbsslot (reelt tilmeldt et løb, der ikke er kørt endnu) lægges i `afterRace` og afregnes slet ikke ved klikket. Kandidater til autoudtagelse venter ikke: klikket låser dem, `runTrainNow` genindlæser readiness efter låsene, og `trainingAutopickCandidates` udelukker låste ryttere (testen for #6006: 45 ryttere, 10 tilmeldt, kun de 10 venter). **Undtagelse (race-vindue):** løbsstartens autofyld (`raceRunner.js`) læser låsene, før den indsætter sine valg. Trykker manageren imellem, kan en rytter klassificeres som "afregn nu" og samtidig blive autoudtaget; under A ville hans tilstand så være afregnet, før løbets belastning skrives, og `record_training_race_load` afviser den. Se §7: A kræver en fælles lås | `backend/lib/trainNow.js` + `resolveTrainingDateReadiness` | Løbsryttere får 0 af 5 ved klikket |
| Aftenkørslen åbner tidligst kl. 20 og først efter dagens sidste finalization | `trainingDayCloseTrigger.js`, `trainingDateClose.js` | Resten kommer typisk ca. 20:00-20:50 |

Grunden til reglen er beslutning 4 + I4 fra 29/9: træthed og form opdateres **én gang pr. dato**, så det gamle trick (#3461: kør etaper, tryk træning for at restituere, kør frisk videre) ikke kommer tilbage.

## 4. Måling i prod (kun SELECT, 23/10)

Read-only opslag i `training_train_now_locks`, `training_rider_ticks` og `training_race_loads`. Tallene ligger privat i `balance-internals/2026-10-23-6461-train-now-measurement.md`. Kvalitativt:

- Knappen bruges hver dag af mange hold, og mange ryttere trykkes hver dag.
- Ved tryk før aftenkørslen får de fleste ryttere 4 af 5. En betydelig del får 0 af 5, næsten alle med et løb samme dag.
- 5 af 5 ved klikket sker kun, når aftenkørslen følger lige efter trykket.
- Resten af datoen kommer typisk mange timer efter trykket.
- Næsten alle datoer ender på 5 af 5. De få undtagelser ligger i den kendte afstemningssti.

Kontrol: en gruppe ryttere fik 4 af 5 ved klikket **og** havde et løb samme dato. Deres løbsdags-felt er afregnet som løb, og ingen blev tilmeldt efter trykket. Løbet var altså kørt før klikket, og afregningen var korrekt. Realisme-reglen ("løb ELLER træning") er ikke brudt.

**Konklusion:** Fejlen rammer alle hold, der bruger knappen før aftenen, på hver dato. Den koster ikke træning, men den gør knappens løfte ("nu") usandt for alle.

## 5. Rammer der ikke må brydes

- **Realisme-reglen 18/9** (§13.3b): en løbsdag er én dato; rytteren kører ét løb ELLER træner; et etapeløb binder også på hviledage; på en dato med etape er de øvrige løbsdage træning (valg A 28/9).
- **Beslutning 1 / I1:** resultatet er det samme, uanset hvornår der trykkes. Klik kl. 06 = automatisk afregning.
- **Beslutning 2 / I3:** klikket låser datoen i begge retninger og ændrer aldrig en tilmelding.
- **Beslutning 3:** løbet køres på datoens starttilstand. Morgentræning gør ikke rytteren træt til aftenens etape.
- **I2:** én kvittering pr. rytter pr. løbsdag. Dobbelt tryk, retry og aftenkørsel kan ikke give dobbelt afregning.
- **#5926-princippet bag I4:** én tilstandsafregning pr. rytter pr. dato.
- Ingen bonus og ingen fordel ved at være online (beslutning 2, 6/9 og 29/9).

## 6. Design

### Variant A: hele datoen for ryttere, hvis dato er kendt (anbefalet første skridt)

**Regel:** klikket afregner alle fem løbsdage, inklusive datoens ene tilstandsafregning (træthed, form, skadesrul), for hver rytter der ikke har et åbent løbsslot på datoen. Løbsryttere med et løb der ikke er kørt, afregnes som i dag efter løbet.

**Hvorfor det er sikkert:**

1. **Intet input kan ændre sig efter klikket.** Låsen (`training_train_now_locks`) gør, at en rytter uden tilmelding ikke kan sættes ind i et løb på datoen. Uden løb kommer der ingen løbsbelastning (`training_race_loads`). Skadesrullet er seedet på datoen, og tilstanden regnes fra datoens starttilstand (`opening_conditions`). Klikket og aftenkørslen regner derfor samme tal: I1 holder.
2. **Afregningen er allerede pr. rytter.** `commit_training_date_tick` har kvitteringer pr. rytter og løbsdag, tilstandsafregning pr. rytter (`training_condition_settlements`), status `partial` når kun en del af truppen er færdig, og et tjek af løbsbelastningen ved afregningen. Aftenkørslen springer ryttere med kvittering over. Der skal ikke bygges en ny skrivevej.
3. **Løbet påvirkes ikke.** Løbsmotoren læser træthed og form for løbets deltagere, og autoudfyldningen læser træthed for holdets ryttere, når den vælger kandidater (`raceRunner.js`). En rytter der afregnes ved klikket, har en lås og springes over af alle udtagelsesveje, så han kører ikke på datoen, og en tidlig skrivning når aldrig et løb samme dag (beslutning 3 holder). Bygge-PR'en skal have en test, der låser netop dette: en låst rytter er aldrig autoudfyld-kandidat.
4. **#3461-tricket kan ikke komme tilbage.** Ryttere med et løb får ikke deres tilstand skrevet før løbet. Der er stadig én tilstandsafregning pr. rytter pr. dato.

**Ændringer (til bygge-PR'en, ikke denne):**

| Del | Ændring |
|---|---|
| `trainNow.js` | `trainNowGameDays` returnerer alle datoens løbsdage for `settleNow`-ryttere. Kommentaren "What the press deliberately does NOT settle" omskrives |
| I4 i 29/9-specen | Omformuleres fra "skrives kun af aftenopgørelsen" til "skrives én gang pr. rytter pr. dato, af den afregning der afslutter rytterens dato, så snart datoen er kendt (klik eller aften)". Ejer-godkendelse kræves, fordi I4 er en låst invariant |
| Status-API og siden | `settledGameDays` bliver 5 for de afregnede. Teksten "4 af 5" forsvinder. Har holdet ingen løbsryttere, bliver datoen `complete` allerede ved klikket: status skifter da fra `locked` til `date_settled`, og `isTodayPlanLocked` slipper dagens plan (ændringer rammer ikke længere i dag). `TrainNowState` skal vise den tilstand direkte efter trykket |
| Prognosen (`trainingWeekPlanForecast.js`) | `settled` afgøres i dag for hele holdet (status `complete`, eller alle ryttere har 5 kvitteringer). Den skal afgøres **pr. rytter**, så afregnede ryttere viser den faktiske træthed, mens holdets løbsryttere stadig viser "Træthed i aften" |
| Hjælp (`help.json` en+da) | Beslutning 9-teksten ("restitutionen sker ved aftenopgørelsen") og det eksisterende afsnit om at træningen kører af sig selv "tidligst kl. 20" opdateres: for ryttere uden løb sker alt i klikket |
| Patch note | EN først, DA under, i bølgens close-out |

**Det A ikke løser:** løbsryttere med et løb, der ikke er kørt, venter stadig på løbet og aftenkørslen. Prod viser, at det er en betydelig del af de trykkede ryttere.

**Mulig lille tilføjelse (A+, kræver eget valg):** en løbsrytter, hvis eget løb er færdigt, kunne afregnes lige efter sin etape i stedet for kl. 20. Det kræver en udløser efter hver finalization for hold med et tryk og en ny kapacitetsmåling. Det er ikke en del af A.

### Variant B: hele datoen for alle, også løbsryttere (ejerens retning 20/10)

**Regel:** klikket afregner alle træningsfelter og træningens effekt på træthed og form for alle ryttere. Løbsryttere får løbsdags-feltet og løbets belastning lagt på bagefter, som en synlig separat linje, når løbet er afgjort.

**Hvad det kræver ud over A:**

1. **Løbsmotoren skal læse datoens starttilstand** (`opening_conditions`) i stedet for den aktuelle `rider_condition`. Ellers ændrer morgenens tilstandsskrivning aftenens løb (beslutning 3). Det er en ændring i motorens input og kræver motor-review og ejer-go.
2. **To tilstandsskrivninger pr. løbsrytter pr. dato** (træningsdelen ved klikket, løbsdelen bagefter). I4 og RPC'ens sikkerhedstjek ("nuværende tilstand = starttilstand") skal skrives om, og "én afregning pr. dato" bliver til "to dele, én samlet kvittering".
3. **Rækkefølgen af løbsdage** skal kunne brydes: træningsfelter efter løbsdags-feltet committes i dag kun efter løbet ("Earlier rider date ticks must commit first"). Udviklingens fremdrift bæres fra felt til felt, så en anden rækkefølge kan ændre resultatet. Enten skal I1 bevises for den nye rækkefølge, eller også skal fremdriften regnes uden rækkefølge.
4. **UI:** en linje for løbsbelastningen pr. løbsrytter, efter løbet.

B ligger tæt op ad #6984 (form/træthed 2.0), som allerede omdesigner træthed og form. Bygges B alene, risikerer det at blive bygget om igen i #6984.

### Sammenligning

| | A | B |
|---|---|---|
| Ryttere uden løb | 5 af 5 i klikket | 5 af 5 i klikket |
| Løbsryttere | som i dag (efter løb + aften) | træning i klikket, løbet som egen linje bagefter |
| Rører løbsmotoren | nej | ja (læser starttilstand) |
| Ændrer låste invarianter | I4 omformuleres (stadig én skrivning pr. rytter pr. dato) | I4 erstattes (to dele), rækkefølge-reglen brydes |
| Ny skrivevej i databasen | nej (eksisterende RPC) | ja (RPC + løbsbelastning som tillæg) |
| Størrelse | lille: én backend-PR + tekst/hjælp | stor: motor + RPC + UI, design sammen med #6984 |

## 7. Teknisk baseline og test (hard rule 36)

**Målt nu:** brug (tabellen i §4) og fordeling 4/0/5 pr. tryk.

**Kan ikke måles fra databasen:** hvor lang tid et klik tager. RPC'en stempler alle rækker med trykkets tidspunkt.

**Forudsætning før første bygge-PR (hard rule 36), ikke opfyldt endnu:** klikkets varighed måles lokalt på PG17 (PGlite, samme fremgangsmåde som `backend/scripts/benchRankingTransfer6765.mjs`) på et hold med fuld trup, før og efter: i dag 4 dags-ticks uden tilstandsafregning, med A 5 dags-ticks + tilstandsafregningen i klikket. Tallene lægges i `balance-internals/6461/`. Uden den måling får A ikke byg-go. Forventet effekt af A: ét ekstra dags-tick pr. klik, og aftenkørslen får tilsvarende mindre arbejde for de hold.

**Tests bygge-PR'en skal have (A):**

- I1: en rytter uden løb, afregnet ved klikket, får bit-identisk evne-, score- og tilstandsresultat som ved aftenkørslen (samme seed, samme starttilstand).
- I2: klik, gentaget klik og aftenkørsel giver præcis én kvittering pr. løbsdag og én tilstandsafregning pr. rytter.
- Blandet trup: løbsryttere står uafregnet tilbage (`partial`), og aftenkørslen afregner kun dem.
- En låst rytter kan ikke få en løbsbelastning på datoen, efter hans tilstand er afregnet (lås + RPC'ens tjek).
- En rytter hvis løb allerede er kørt ved klikket, afregnes 5 af 5 inklusive løbsbelastningen.
- Værnet mod en åben forrige dato bevares (uændret adfærd). Står forrige dato `partial`, fordi løbsryttere stadig er åbne, afviser `runTrainNow` klikket på næste dato med `previous_date_open` (`backend/lib/trainNow.js`, regressionstesten i `trainNow.test.js`). Ellers fryser den nye dato en forældet starttilstand. Testen skal vise, at A ikke fjerner eller omgår værnet.

**Forudsætning for A: én fælles lås mellem klikket og alle udtagelsesveje.** Klikkets lås-skrivning og readiness-genindlæsning skal tage samme advisory-lås pr. (hold, dato) i databasen som alle veje, der skriver en udtagelse. Det gælder løbsstartens autofyld (læs låse → indsæt valg) og managerens egne gemninger. Det gælder også de øvrige automatiske skrivere: `POST /races/:raceId/selection/auto` (tjekker låse og sletter/indsætter derefter direkte), Race Hubs regenerering (`raceHubAutofill.js`) og den timevise/boot-kørte `raceEntryGenerator.js` (læser låse længe før sin batch-RPC). De manuelle gemninger er `PUT /api/races/:raceId/selection` og bulk via `replace_race_selection` (`raceSelection.js` + `database/2026-09-23-5246-late-fill-log.sql`). I dag tager RPC'en kun holdets egen advisory-lås og læser ikke `training_train_now_locks`. Alternativet er ét atomisk claim i RPC'erne, der afviser en rytter med en Train now-lås på datoen. Så kan en gemning, der passerede `prepareSelectionChange` før klikket, aldrig indsætte en rytter, hvis tilstand allerede er afregnet.

Den fælles lås eller det atomiske claim skal ligge der, hvor rækkerne skrives (RPC eller samme transaktion), så ingen vej kan læse låsene før klikket og skrive efter.

Test: en samtidighedstest for hver udtagelsesvej mod klikket. Vejene er løbsstartens autofyld, enkelt-gemning, bulk, `selection/auto`, Race Hub-regenereringen og entry-generatoren. Hver test kører for samme hold og dato. Den skal vise, at en rytter enten afregnes ved klikket og aldrig udtages, eller udtages og venter på løbet, aldrig begge. Uden låsen må A ikke bygges.

**Verifikations-tier (A):** TIER FULL (træningsmotoren og en delt RPC-sti): `scripts/verify-local.ps1`, hele backend `node --test` på trænings-filerne, frontend lint + `node --test` + build for knap- og hjælpeteksten, og PG17-målingen ovenfor før/efter.

**Ejeren ser på preview (Android):** et hold med både løbsryttere og ryttere uden løb trykker "Træn nu"; ryttere uden løb viser 5 af 5 felter og opdateret træthed og form med det samme, løbsryttere står som "venter på løbet", og et gentaget klik ændrer intet. Aftenkørslen afregner bagefter kun løbsrytterne.

## 8. Valg-kort til ejeren

> **Besluttet 24/10 (ejer):** B, samlet med #6984 og motoren, med bedste langsigtede løsning nu. Kortet nedenfor er bevaret som beslutningsgrundlag.

**Træn nu: hvor meget skal ét klik klare?**

I dag giver "Træn nu" kun 4 af 5 felter. Det sidste felt, og træthed og form, kommer først ved aftenkørslen. Ryttere med løb i dag får 0 felter, før løbet er kørt. Det rammer alle hold, der trykker før aftenen.

- **A: Hele dagen for ryttere uden løb.** Klikket giver 5 af 5 felter plus træthed og form med det samme for alle ryttere uden et løb, der mangler at blive kørt. Løbsryttere afregnes som i dag efter løbet. Lille ændring med samme motor. Løbet påvirkes ikke.
- **B: Hele dagen for alle.** Som A, men løbsryttere får også deres træning i klikket, og løbet lægges på som en egen linje bagefter. Det kræver, at løbsmotoren bruger morgenens form og træthed, og at reglen "én skrivning pr. dato" ændres. Stort stykke arbejde, som hører sammen med form/træthed 2.0 (#6984).

**Anbefaling: A.** Den løser det, spillerne har meldt, for de fleste ryttere, uden at røre løbet. Hvis du også vil have løbsryttere med i klikket (B), designes det sammen med #6984, så træthed og form ikke bygges om to gange.

## 9. Uden for scope (forslag, ikke oprettet)

- A+: afregn en løbsrytter lige efter sin egen etape i stedet for kl. 20.
- En række hold-datoer står som `needs_reconciliation` i `training_date_work`. Det er den kendte afstemningssti, men listen bør gennemgås for at se, om nogen er gamle og glemt.
