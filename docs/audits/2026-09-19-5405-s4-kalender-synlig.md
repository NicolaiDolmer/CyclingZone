# S4-kalenderen synlig for managers FØR sæsonskiftet — undersøgelse (#5405)

**Dato:** 19/9 2026 · **Type:** read-only undersøgelse, intet bygget, ingen prod-skrivning
**Refs:** #5405 #5267 #4845 #4270 #4123 #2449 #2518 #3018 #5272

> **Tal-note.** Repoet er offentligt. Målte fordelinger fra kalendergeneratoren (terræn-
> procenter, tolerancer, komposition pr. division) står derfor **ikke** i denne rapport.
> De er reproducerbare on demand med tørkørsels-kommandoen i §2 — den skriver aldrig.
> Her står kun tilstand: hvilke gates der er grønne, hvilke der ikke er, og hvad det betyder.

---

## 0. Kort svar

**Fladen findes allerede.** Kalendersiden har haft en sæson-vælger siden #2449, og læse-stien
slår sæsonen op på dens **nummer uden status-filter** (#2518). En sæson med status `upcoming`
og materialiserede løb bliver derfor synlig for managers **uden en eneste frontend-ændring**.

**Motorerne rører den ikke.** Alle baggrunds-sweeps — etape-scheduler, auto-udfyldning af
startfelter, præmier, udtagelses-varsler, træning — slår sæsonen op med `status = 'active'`
og ser derfor slet ikke en `upcoming` sæsons løb.

**Der er ét rigtigt hul:** udtagelses-skrivningen har ingen sæson-gate. Det er den eneste
flade der skal lukkes, før S4 kan stå synlig.

**Og én tidsklemme der ikke er teknisk:** kalenderens FORM er stadig uafklaret i #5267.
Det der kan vises mandag, er dagens form — ikke den skitse ejeren nikkede til 19/9.

---

## 1. Hvad findes allerede? (spørgsmål 1)

### 1a. Sæson-vælgeren på kalendersiden — bygget, virker, venter bare på en S4-række

`frontend/src/pages/CalendarPage.jsx`

- Linje ~78: `const [seasonNumber, setSeasonNumber] = useState(null)` — eksplicit sæson-valg.
- Linje ~93: valget sendes som `?season_number=N` til `/api/races/calendar`.
- Linje ~426 (`CalendarControls`): vælgeren **rendres kun når `availableSeasons.length > 1`**.
  Kommentaren i koden siger ordret at den findes, så managers kan planlægge mod næste sæsons
  program **før den starter**.
- Linje ~229: der findes allerede en tom-tilstand `notGenerated` ("Sæson N er endnu ikke
  oprettet") — altså en flade for præcis den situation hvor en sæson er valgt uden løb.

### 1b. Backend-læse-stien filtrerer IKKE på status

`backend/routes/api.js`, `GET /api/races/calendar` (linje ~4502):

- `?season_number=` → `.eq("number", seasonNumber)`. Uden parameteren → `.eq("status","active")`.
  Med parameteren er der **ingen status-betingelse overhovedet**.
- `availableSeasons` bygges af `seasons` hvor `number > 0`, **uanset status** (sæson 0 er
  bevidst udeladt, #2600). En S4-række med status `upcoming` dukker altså op i vælgeren
  automatisk, i samme øjeblik rækken findes.
- Ruten er eksplicit **afkoblet fra race-motorens flag**: kommentaren i headeren siger at
  kalenderen skal kunne renderes selv når motoren er slukket. Det er en ren læse-flade.

Samme mønster i planlægger-stien: `resolvePlannerSeason` (`api.js` ~3383) med kommentaren
om at `?season_number=` slår ANY sæson op "uanset status — 'upcoming' inkl.".

### 1c. Sæson-opslaget er allerede designet til en pre-oprettet S4-række

`backend/lib/seasonLookup.js` er utvetydig i sin egen docstring:

> opslaget filtrerer PÅ `number` OG IKKE PÅ `status`. En række med status `upcoming` er
> derfor NOK … Det er præcis dét der gør det sikkert at pre-oprette sæson 4 længe før
> cutoveren.

Filen nævner også en **bivirkning der taler FOR at oprette rækken tidligt**: årsmødet
(`boardMandateEngine.js`) slår den kommende sæson op på nummer og springer holdet over med
`skipped: "target_season_not_found"` hvis rækken mangler. Så længe S4-rækken ikke findes,
får **intet hold et bestyrelsesmandat** — tavst, uden at noget fejler højlydt.

### 1d. Prod-tilstand i dag (kun SELECT)

| Sæson | Status | Vindue | Løbsdage | Løb i `races` |
|---|---|---|---|---|
| 1 | completed | 22/6 → 26/7 | 28/28 | ja |
| 2 | completed | 27/7 → 23/8 | 28/28 | ja |
| 3 | **active** | 28/8 → **27/9** | 22 af 31 kørt | ja |
| 4 | — | — | — | **rækken findes ikke** |

Altså: sæson-vælgeren viser i dag S1/S2/S3. S4 findes hverken som række eller som løb.
S3 har 9 løbsdage tilbage når denne rapport skrives.

### 1e. Tørkørslen i dag — kørt, og det vigtige er nyt

Begge kørsler er read-only og gjort i undersøgelses-worktreet.

**Trin 0, den gyldne kalender-diff** (`backend/scripts/dev/calendarGoldenDiff.mjs`, #4123 —
100 % offline, ingen credentials):

```
✅ Kalenderen er identisk med den gyldne snapshot, og ingen hård invariant er brudt.
```

Alle fire divisioner uændrede, 0 ændrede dage, 0 invariant-brud. Koden har altså ikke
flyttet sig siden sidst nogen kiggede.

**Trin 1, S4-tørkørslen:**
`node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt`

Resultatet, i den rækkefølge det betyder noget:

| Gate-gruppe | Kan overrides? | Status i dag |
|---|---|---|
| **Placerings-gates (#4270)**: kvote-opfyldelse (§1b), monument uden for GT-spænd (§4), mindste-overlap (§1/#3329) | **Nej** | ✅ **0 brud, alle fire divisioner** |
| Dækning (§2, løb hver kalenderdag) | Nej (ejer-regel) | ✅ 28/28 dage i alle fire divisioner |
| Plan-invarianter (§3 GT, whitelist, dedup) | Nej | ✅ 0 brud |
| Samtidige løb pr. løbsdag (§1, cap) | Nej | ✅ inden for cap |
| **Pr.-tier komposition (#3469)** | Ja, `--allow-tier-composition-drift` | ❌ **1 afvigelse (D2, bjerg-andel)** — stopper `--apply` uden flaget |
| Uniforme mål (§6b, #4103) | Ja, `--allow-uniform-target-drift` | ❌ 1 afvigelse (D3) |
| Finale-bånd, sæson-aggregat (§7b/#4272) | Ja, `--allow-finale-drift` | ❌ nogle få afvigelser |

**Det afgørende fund:** de gates der **ikke kan overrides** er grønne. Det er en reel ændring
fra #5267's måling 18/9, hvor mindste-overlap fejlede i **alle fire** divisioner. Forskellen
er ikke kalenderen — det er at #5267 målte mod et **løbsdags-mål** (112), som får pakkeren til
at re-søge hele divisionens placering. Denne tørkørsel har intet mål og pakker naturligt.
Det bekræfter nat-runde-2's konklusion direkte på hovedlinjen.

**D4 rammer allerede ejerens 19/9-ønske:** tørkørslen giver 3 etaper pr. kalenderdag i D4,
som `TIER_DENSITY[4] = 3` foreskriver (#4270, ejer 3/9). Skitsen 19/9 brød den regel;
generatoren gør ikke.

**Men:** de fire divisioner får **ikke** lige mange løbsdage i denne pakning. Det er præcis
det #5267 stadig forhandler. Se §4.

---

## 2. De to veje (spørgsmål 2)

### Vej A — forhåndsvisning bygget af tørkørsels-output

Tørkørslen producerer hele planen i hukommelsen. Den kunne dumpes til JSON og vises bag et
flag på en egen flade (eller som en ekstra "S4 (forhåndsvisning)"-post i sæson-vælgeren).

**Kan regenereres frit** — §2c gælder kalenderen i databasen, ikke en JSON-fil.

**Prisen:** fladen findes ikke. Kalendersiden læser `/api/races/calendar`, som læser `races`
+ `race_stage_schedule` + `race_stage_profiles` + `league_divisions`. En forhåndsvisning skal
enten (a) have en ny endpoint der serverer plan-JSON i **præcis** `toCalendarWireEntry`-form,
eller (b) skrive planen til rigtige tabeller — hvorved den holder op med at være vej A.

Begge veje deler i øvrigt problemet i §3f: markeringen "mit holds løb" kan kun bygges på
holdets **nuværende** division, som ikke nødvendigvis er holdets S4-division.

### Vej B — den rigtige S4-kalender genereret tidligt, status `upcoming`

`buildSeasonCalendar.js --apply` opretter sæson-rækken med `status: "upcoming"`
(linje ~314) og materialiserer løb, etape-tider og profiler.

Hele læse-stien virker så af sig selv: sæson-vælgeren får en fjerde post, `?season_number=4`
returnerer kalenderen, og transitionen 27-28/9 promoverer bare `upcoming` → `active`
(`seasonTransition.js`'s `insertSeasonIfMissing` kolliderer ikke med en pre-oprettet række —
det er dokumenteret i `seasonLookup.js` og i CALENDAR_RULES §2d).

**Prisen er §2c.** CALENDAR_RULES §2c (ejer-beslutning 30/8, ordret: *"To regenereringer er
forbudt"*): en sæsons kalender må regenereres **højst én gang**, og kun mens status er
`upcoming`. Bruges den ene regenerering på en tidlig visning, er formen låst — også hvis
ejeren efter spillernes reaktion vil noget andet.

Reglen er i dag **ikke håndhævet i kode**. §2c's egen advarsel siger det ligeud: der findes
ingen guard mod den anden kørsel mod en `upcoming` sæson, og ingen kolonne der tæller
genereringer. Reglen kan altså brydes uden at nogen kan se det — hvilket gør det til et
**ejer-spørgsmål, ikke et teknisk**.

---

## 3. Risici pr. vej (spørgsmål 3)

Jeg har gennemgået hver flade brief'en nævner. Kort: næsten alt er allerede sikkert, og
sikkerheden kommer fra ét mønster — baggrundsarbejde slår sæsonen op som `status = 'active'`.

| Flade | Fil | Ser den en `upcoming` sæson? | Risiko |
|---|---|---|---|
| Etape-scheduler / race engine | `backend/lib/stageScheduler.js` | **Nej** | ✅ Ingen |
| Auto-udfyldte startfelter | `backend/lib/raceEntryGeneratorSweep.js` | **Nej** | ✅ Ingen |
| Præmier | `backend/lib/autoPrizeSweep.js` | **Nej** | ✅ Ingen |
| Udtagelses-varsler | `backend/lib/selectionWarningSweep.js` | **Nej** | ✅ Ingen |
| Træningens sweep | `backend/lib/trainingSweep.js` | **Nej** | ✅ Ingen |
| Planlægger-læsning (peaks) | `api.js` `resolveTeamDivisionForSeason` | Ja, men **`pending: true`** | ✅ Skrivning giver 409 `division_not_settled` |
| Kalender-læsning | `api.js` `/races/calendar` | **Ja — med vilje** | ✅ Det er hele pointen |
| **"Mit holds løb"-markering** | `backend/lib/raceCalendar.js` | **Ja** | 🟡 **Markerer mod NUVÆRENDE division — se §3f** |
| **Udtagelses-skrivning** | `backend/lib/raceSelection.js` | **Ja** | 🔴 **Se nedenfor** |

### 3a. Det ene rigtige hul — udtagelse kan skrives ind i en kommende sæsons løb

`prepareSelectionChange` (`backend/lib/raceSelection.js` ~130) gater på tre ting:

1. `race.status !== "scheduled"` → afvis. **Men materializeren indsætter S4-løb netop med
   `status: "scheduled"`** (`tierCalendarMaterializer.js` ~684).
2. `teamInRacePool({ teamDivisionId, racePoolId })` — holdets **nuværende** (S3-)division mod
   løbets pulje.
3. `race.stages_completed > 0` → frys. S4-løb har 0.

Der er **ingen kontrol af at løbets sæson er den aktive**. Konsekvensen: et hold hvis S3-pulje-id
tilfældigvis er det samme som et S4-løbs pulje-id, kan gemme en udtagelse i et S4-løb via
`PUT /api/races/:raceId/selection` (og bulk-varianten `PUT /api/races/selection/bulk`).

Hvorfor det er skadeligt og ikke bare kosmetisk: ved sæsonskiftet flytter langt de fleste hold
pulje (komprimeringen — #3018's kommentar noterer at 140 af 156 hold skiftede pulje ved
en tidligere måling). En udtagelse gemt før skiftet peger derfor typisk på løb holdet
**ikke skal køre**, og skal ryddes op bagefter. Det er nøjagtig den skade §2c's begrundelse
advarer imod ("alt hvad spillerne har bygget oven på det gamle sæt bliver forkert").

Hullet gælder **vej B**. Vej A rører ingen rigtige `races`-rækker og har det ikke.

**Rettelsen er lille:** samme gate som planlæggeren allerede bruger. Slå løbets sæson op
(`race.season_id` hentes allerede i handleren, `api.js` ~5197) og afvis hvis sæsonen ikke er
`active` — én tilstandskontrol, spejlet i bulk-endpointet, med `teamDivisionKnownForSeason`
(`backend/lib/plannerBoard.js`) som eksisterende diskriminator.

### 3b. Notifikationer / udgående kø

Den udgående kø til eksterne race-notifikationer (#3624, merged 18/9) er bag et **slukket
flag**. Notifikationer udløses desuden af etape-afvikling, som kun sker for den aktive sæson
(§3's tabel). Ingen risiko i nogen af vejene, så længe flaget bliver liggende slukket.

### 3c. Træningens løbsdags-akse (#5205/#5264)

Træningen læser løbsdage for den **aktive** sæson (`trainingSweep.js` → `no_active_season`).
En `upcoming` S4-kalender påvirker den ikke.

Den reelle kobling er ikke teknisk, men rækkefølges-mæssig: **#5264 er endnu ikke afklaret mod
ejerens regel 2-3 fra 18/9** (en løbsdag = én dato; et etapeløb binder rytteren fra første til
sidste etape). Låses S4-kalenderens form nu, låses også den akse træningen skal bygges på
bagefter. Det er den dyreste konsekvens af at bruge §2c's ene skud tidligt.

### 3d. Kalender-gaten (#4123) og `calendarGoldenDiff`

Begge er **forudsætninger, ikke risici**, og begge er grønne i dag (§1e). `calendarGoldenDiff`
er 100 % offline og kan køres igen lige før en eventuel `--apply` uden nogen risiko.

### 3f. "Mit holds løb" markeres mod holdets NUVÆRENDE division — ikke dets S4-division

Kalender-ruten bruger **ikke** `resolveTeamDivisionForSeason`. Den sender holdets nuværende
pulje-id direkte videre:

- `api.js` `/races/calendar`: `teamDivisionId: req.team?.league_division_id ?? null`
- `backend/lib/raceCalendar.js` ~207:
  `const isMine = teamDivisionId != null && race.league_division_id === teamDivisionId;`

Konsekvensen for vej B: S4-løb **bliver** markeret som "mine" — men ud fra holdets S3-division.
Da de fleste hold skifter pulje ved komprimeringen, vil markeringen for en stor del af
managerne pege på løb de **ikke** skal køre. Det er ikke en tom flade; det er en flade der
siger noget konkret og sandsynligvis forkert.

Det er den samme grundårsag som §3a: begge steder sammenlignes mod den nuværende division,
fordi sæsonens division endnu ikke er afgjort. Planlægger-stien har allerede den rigtige
diskriminator (`teamDivisionKnownForSeason` → `pending`); kalender-stien har den ikke.

**Mindste ærlige rettelse:** når den viste sæson ikke er `active`, undlad at markere
"mit holds løb" og skriv i stedet på fladen at divisionen først afgøres ved sæsonskiftet.
Det er en visnings-ændring i `CalendarPage.jsx` + et felt i svaret (fx `divisionPending`,
som planlægger-endpointet allerede sender). Omfang: **lille**.

### 3e. Værd at vide, men ikke en blokering

- **Sæsontilmelding** (`season_signup_enabled`, #452/#4592) er bygget, men dormant frem til
  cutoveren (CALENDAR_RULES §2d). En tidlig S4-række ændrer ikke på det.
- **Årsmødet** (§1c) er i dag dødt for alle hold fordi S4-rækken mangler. Det taler for at
  oprette rækken tidligt — uafhængigt af hvilken vej der vælges.
- `reconcilePoolCalendarOnActivation` (#5272) er §2c's ene undtagelse og rører ikke dette.

---

## 4. Den tidsklemme der ikke er teknisk

Det tekniske er nemt. Det svære er, at der ligger **to uforenelige ting i den samme uge**:

1. **#5405 (denne):** kalenderen skal være synlig mandag 21/9, så den kan tilrettes.
2. **#5267:** kalenderens FORM er ikke besluttet. Ejeren nikkede 19/9 til skitsen med
   synkroniserede etapeløbs-blokke, men den er *aldrig pakket* — nat-runde-2 skriver selv at
   K2 er regnet som loft på kataloget, ikke pakket, og at det skal måles før #5169 bygges om.
   Dertil kommer spørgsmålet om lige mange løbsdage, som dagens naturlige pakning ikke giver.

Genereres S4 mandag, genereres den i **dagens form**. Ejeren får noget at se på og rette til,
men han får ikke den kalender han sagde ja til fredag — og §2c's ene regenerering er brugt.

Det er ikke et teknisk valg. Det bør stilles til ejeren som ét spørgsmål (§6).

---

## 5. Anbefaling (spørgsmål 4)

### Anbefalet: vej B, men i to trin, og med §2c-reglen gjort håndhævbar først

**Fordel.** Den bruger den flade der allerede findes. Managers ser den rigtige kalender i det
UI de kender, med deres egen division markeret, og der bygges ingen parallel visnings-vej der
skal vedligeholdes. Sæson-rækken løser samtidig det tavse årsmøde-stop (§1c). Motorerne rører
den ikke (§3).

**Pris.** Der skal lukkes ét hul (udtagelses-gaten, §3a) før den må stå synlig, og §2c's ene
regenerering bliver brugt — medmindre ejeren eksplicit udvider reglen.

**Alternativ (vej A).** Ingen §2c-omkostning og fri regenerering, men den koster en ny
endpoint plus en visnings-flade (§2), og den løser ikke division-problemet i §3f — det følger
med begge veje. Til formålet "managers skal reagere på deres egen kalender" er det den
svagere flade for flere penge.

### Trinene

**Trin 1 — luk udtagelses-hullet (skal ligge før alt andet).**
`backend/lib/raceSelection.js` (`prepareSelectionChange`) + begge kaldere i
`backend/routes/api.js` (`PUT /races/:raceId/selection` ~5179, `PUT /races/selection/bulk` ~5349).
Afvis skrivning når løbets sæson ikke er `active`; genbrug `teamDivisionKnownForSeason`
(`backend/lib/plannerBoard.js`). Egen fejlkode i stil med de eksisterende
(`selection_season_not_active`), så UI'et kan sige noget sandt.
Omfang: **lille** — 2-3 filer, ~30-50 linjer inkl. tests. Backend-only, ingen UI-ændring.

**Trin 2 — gør §2c håndhævbar, før den ene chance bruges.**
CALENDAR_RULES §2c beder selv om det: `seasons` får et tællefelt (fx
`calendar_generation_count`), og genererings-stien nægter at køre når det er ≥ 1. Uden det er
"vi må gerne rette til indtil skiftet" en aftale ingen kode kender, og ingen kan bagefter se
hvor mange gange der blev genereret.

To detaljer der skal med, ellers gør tælleren mere skade end gavn:

1. **Tjek og optælling skal være én atomisk operation**, ikke et læs efterfulgt af en
   skrivning. To samtidige `--apply` kan ellers begge læse 0 og begge generere.
2. **Tæl først når genereringen er lykkedes.** Tælles der op før materialiseringen, kan en
   halvvejs fejlet kørsel blokere det eneste gyldige gen-forsøg — så er guarden blevet
   problemet. Tørkørsler må aldrig røre tælleren.

Filer: `database/<dato>-5405-calendar-generation-count.sql`,
`backend/scripts/buildSeasonCalendar.js` (gate + optælling efter post-verify),
`backend/lib/seasonCalendarGate.js`. Omfang: **lille-mellem**.

**Trin 3 — generér S4 med `--apply`, kun efter eksplicit ejer-go.**
Rækkefølgen står i CALENDAR_RULES §2d og skal følges ordret: golden diff → tørkørsel →
`--apply` med eksplicit `--race-days`. Den ene blokerende afvigelse (§1e, D2's komposition)
er et **balance-valg, ikke en korrekthedsfejl** — enten lukkes den ved at justere, eller
ejeren accepterer den bevidst med `--allow-tier-composition-drift`. Det er et ejer-go, ikke
et agent-valg.
Omfang: **ingen kode** — en kørsel plus post-verify.

**Trin 4 — én lille frontend-ændring, ikke nul.**
Sæson-vælgeren dukker op af sig selv når den fjerde `seasons`-række findes (§1a/§1b), så
selve visningen kræver intet. Men §3f skal lukkes: for en sæson der ikke er `active` skal
"mit holds løb"-markeringen slås fra og erstattes af en linje om at divisionen først afgøres
ved sæsonskiftet. Ellers viser kalenderen en egen-hold-markering der for de fleste managere
er forkert.
Filer: `backend/routes/api.js` (`divisionPending` i kalender-svaret, samme felt som
planlægger-endpointet allerede sender), `frontend/src/pages/CalendarPage.jsx`.
Omfang: **lille**.

---

## 6. Det ene spørgsmål der skal til ejeren først

Alt ovenfor er klar til at bygge. Men rækkefølgen afhænger af én beslutning der ikke er
teknisk, og som ingen agent bør tage:

> **S4-kalenderen kan være synlig mandag — men i dagens form, ikke i den form du nikkede til
> fredag (#5267's synkroniserede etapeløbs-blokke), som endnu aldrig er pakket. Og
> CALENDAR_RULES §2c giver én regenerering pr. sæson.**
>
> **A:** Generér mandag i dagens form. Du ser noget rigtigt og kan reagere — men §2c's ene
> skud er brugt, og #5267's form kommer først i S5.
> **B:** Udvid §2c for netop S4 (fri regenerering indtil skiftet 27-28/9, derefter låst).
> Så kan mandagens kalender rettes til, også med #5267's form, hvis prøvepakningen når det.

Uden det svar kan trin 3 ikke sættes i gang.

---

## 7. Hvad denne undersøgelse IKKE dækker

- **Formen i #5267.** Jeg har ikke pakket eller målt den synkroniserede kalender. Dagens
  tørkørsel er dagens form.
- **Lige mange løbsdage pr. division.** Tørkørslen giver dem ikke, og §1d/#4845's aftale er
  stadig uafklaret i #5267.
- **Om udtagelses-hullet (§3a) er blevet udnyttet.** Jeg har kun læst koden; jeg har ikke målt
  om nogen faktisk har skrevet entries på tværs af sæsoner. Der er i dag ingen S4-løb at gøre
  det i, så hullet er teoretisk indtil vej B køres.
- **Visuel verifikation.** Ingen browser, intet screenshot — sæson-vælgeren kan ikke vises med
  fire sæsoner, før den fjerde findes.
- **RLS.** Jeg har ikke gennemgået om row-level security på `races` behandler en `upcoming`
  sæson anderledes end en aktiv.
