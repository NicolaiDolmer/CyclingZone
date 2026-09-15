# #5182 — designsession: hvorfor løbene kommer for sent

> **Formål:** ejeren bad 12/9 om at få problemet forklaret detaljeret og designe løsningen sammen, FØR #5182 får en plads i MASTERPLAN. Rækkefølgen er derfor ikke besluttet. Dette er oplægget til den session.
>
> **Kilde:** daglig Sentry/Railway-triage 12/9. Alle tal er målt i Railway-deploy-loggen på deployment `25a53fb8` (release `203a2fb2`), ikke estimeret.

## 1. Hvad der sker når et løb bliver færdigt

Når den sidste etape i et løb er simuleret, kører en kæde af trin. Hvert trin er instrumenteret i loggen (`⏱ finalize`-linjen), så vi kan se præcis hvor tiden går. Tallene her er fra løb `bbecc4ee` 12/9 kl. 13:10:

| Trin | Tid | DB-kald | Hvad det gør |
|---|---|---|---|
| `sim` | 3,9 s | 45 | Simulerer selve etapen — hvem vinder, tider, point |
| `write` | 0,4 s | 1 | Skriver resultaterne |
| `standings` | 1,0 s | 0 | Opdaterer stillingen |
| `matview` | 3,5 s | 5 | Genopbygger ranglister |
| `enrichment` | 2,3 s | 38 | Beriger resultatrækkerne |
| **`board`** | **513,5 s** | **6.364** | **Opdaterer alle bestyrelsers tilfredshed** |
| `notify` | 60,1 s | 3 | Discord-embed + in-app-besked |
| `status-flush` | 0,2 s | 1 | Sætter løbet til `completed` |
| **I alt** | **9 min 45 s** | **6.457** | |

**Selve løbet — det spillerne er her for — tager 4 sekunder. Bestyrelsen tager 8½ minut.**

Det samme mønster gentog sig på alle fem løb der blev finaliseret i det tick: `board` var mellem 72 % og 93 % af den samlede tid, og kaldtallet lå hver gang på 6.361-6.364.

## 2. Hvorfor bestyrelses-trinnet er så langsomt

Koden ligger i `backend/lib/boardWeekendFinalization.js` (funktionen `processBoardWeekendFinalization`, linje 135).

Den starter **rigtigt**: den henter alle hold, stillinger, bestyrelsesprofiler, ryttere og lån i få store, paginerede opslag. Det er godt håndværk, og det er ikke der tiden går.

Problemet er hvad der sker **derefter**. Funktionen løber igennem alle 242 menneskehold **ét hold ad gangen**, og inde i hver runde spørger den databasen igen:

1. `board_plan_snapshots` for holdet
2. `loadGoalContextForBoard` (`backend/lib/boardGoalContext.js`, linje 120) — som selv slår op i `board_plan_snapshots` (den samme række igen), `race_results` tre gange og `finance_transactions` to gange
3. En opdatering af `board_profiles`
4. En upsert i `board_satisfaction_events`
5. `applyMandateWeekendSync`

Det bliver ca. **26 databasekald pr. hold × 242 hold = 6.364 kald**. Og de kører i serie: koden venter på svar nummer 1 før den sender nummer 2.

**Det er ikke regnearbejde. Det er ventetid.** 513 sekunder delt med 6.364 kald = ~80 millisekunder pr. kald, som er præcis hvad et normalt Supabase-opslag koster i netværkstid. Serveren sidder stille og venter i 8½ minut.

To detaljer gør det værre end nødvendigt:

- `race_results` og `finance_transactions` er **sæson-brede** tabeller. De indeholder det samme uanset hvilket hold vi kigger på — men de læses 242 gange.
- `board_plan_snapshots` læses **to gange pr. hold**: én gang i løkken og én gang inde i `loadGoalContextForBoard`.

## 3. Hvad det betyder i spillerens kalender

Scheduleren, der afvikler etaper, vågner hvert 5. minut. Hvis den forrige runde stadig kører, springer den over (overlap-vagten fra #2090) og prøver igen 5 minutter senere. Målt 12/9:

| Tick | Etaper | Varighed | Sprungne ticks |
|---|---|---|---|
| 09:00 UTC | 1 | under 1 min | 0 |
| **10:00 UTC** | **14** | **48 min** | **9** |
| 11:00 UTC | 1 | under 1 min | 0 |
| 12:01 UTC | 2 | under 1 min | 0 |
| **13:00 UTC** | **5** | **36 min** | **7** |
| 14:01 UTC | 2 | under 1 min | 0 |
| 15:00 UTC | 1 | under 1 min | 0 |

Forsinkelsen er altså **ikke** et fast offset og ikke tilfældig — den er proportional med hvor mange etaper der er skemalagt i samme time. Et løb sidst i en klynge på fem vises ~36 minutter efter det tidspunkt der står på siden. Det er præcis det dit direktiv #3624 fra 10/8 beskrev, og issuet forudsagde selv mekanismen: *"hvis ét tick ikke når igennem alle skemalagte etaper, skubbes resten til næste tick, og forsinkelsen ser tilfældig ud for spilleren selv om den er strukturel."*

**Vigtigt om fremtiden:** arbejdet vokser med antallet af menneskehold. 242 hold i dag giver 6.364 kald. Bliver vi dobbelt så mange, bliver det 12.700 kald og ~17 minutter pr. løb. Bane 2's mål er netop at få flere spillere, så problemet forværres af at det går godt.

## 4. Det spørgsmål jeg ikke selv kan svare på

`processBoardWeekend` kaldes **én gang pr. finaliseret løb**. Når fem løb bliver færdige på samme løbsdag, kører hele bestyrelses-evalueringen af alle 242 hold altså **fem gange** den dag.

Noget af det er tydeligvis med vilje: `board_satisfaction_events` gemmes pr. `race_id` (en række pr. løb pr. bestyrelse), og #3144 sørgede for at et løb kun skriver en hændelse for hold i løbets egen pulje. Så hændelses-historikken *skal* være pr. løb.

Men selve tilfredsheds-opdateringen er navngivet og opbygget som en **weekend**-opdatering, og den kører for alle hold — også hold i divisioner der ikke deltog i løbet. Trinnet heder også `recomputeRaceDays` + weekend-finance, altså løbsdags-begreber.

**Spørgsmålet til dig:** skal en bestyrelse reagere én gang pr. løb, eller én gang pr. løbsdag? Hvis svaret er "pr. løbsdag", falder arbejdet med en faktor svarende til antal løb pr. dag — det er en større gevinst end nogen teknisk optimering, men det er en spilregel, ikke en kodebeslutning. Jeg har ikke ændret noget og har ikke antaget et svar.

## 5. Mulighederne, med pris og gevinst

### A. Flyt de sæson-brede opslag ud af løkken (anbefalet førstetrin)

- **Gevinst:** `race_results` og `finance_transactions` læses én gang i stedet for 242 gange, og dobbelt-læsningen af `board_plan_snapshots` forsvinder. Det er langt størstedelen af de 6.364 kald.
- **Pris:** lille. Ingen ændring i hvad der bliver beregnet eller skrevet — kun hvornår data hentes. Dækket af de eksisterende tests i `boardWeekendFinalization`-suiten, og kan verificeres direkte: `board=`-feltet i `⏱ finalize`-linjen før og efter.
- **Alternativ:** gør intet og accepter forsinkelsen.

### B. Kør holdene parallelt med et loft

- **Gevinst:** de resterende kald køres 8-16 ad gangen i stedet for ét ad gangen. Skærer resten af ventetiden.
- **Pris:** ændrer rækkefølgen som hold behandles i. Skal gennemgås for om to hold kan nå at skrive oven i hinanden (fx samme bestyrelse, samme række). Kræver mere omhu end A.
- **Alternativ:** kun A — hvis A alene bringer trinnet under ~30 sekunder, er B måske ikke nødvendigt.

### C. Flyt `notify` ud af finaliserings-stien

- **Gevinst:** 14-63 sekunder pr. løb. `notify` bruger op til et minut på 2-3 kald, hvilket ser ud som ventetid på Discords rate-limit. Beskeden behøver ikke blokere at løbet bliver markeret færdigt.
- **Pris:** beskeden kommer et øjeblik efter resultatet i stedet for samtidig. Der findes allerede en `discord_dm_outbox`-tabel, så mønsteret er der.
- **Alternativ:** lad den ligge — den er kun ~10 % af problemet.

### D. Én bestyrelses-evaluering pr. løbsdag i stedet for pr. løb

- **Gevinst:** størst af alle, se afsnit 4.
- **Pris:** det er en ændring af spilreglen, ikke af koden. Skal afstemmes med GDD'en og bestyrelses-kapitlet.
- **Alternativ:** behold pr. løb og løs det teknisk med A+B.

## 6. Hvad jeg foreslår vi bruger sessionen på

To beslutninger, i denne rækkefølge:

1. **Er A grønt?** Ren læse-optimering, ingen adfærdsændring, verificerbar med før/efter-tal. Den kan laves uafhængigt af alt andet.
2. **Pr. løb eller pr. løbsdag (D)?** Det er spilreglen, og svaret afgør om B overhovedet er nødvendigt.

C kan afgøres til sidst eller udskydes.

## Relaterede

- **#3624** — dit direktiv 10/8; målingen er postet som kommentar der 12/9
- **#2391** — den forrige flaskehals i samme kæde (stillings-genberegning efter hver etape). Den er reelt lukket: `standings` tager nu 1-5 s. `board` har overtaget rollen.
- **#2090** — overlap-vagten der gør forsinkelsen synlig i loggen
- **#2430** — tidligere verifikation af scheduler-gennemløb
