# Undersøgelse #8549: prioritet pr. felt og ét låst pas pr. dag (Week blocks)

Refs #8549, Refs #7456, Refs #7947. Undersøgelsesspor (kind: investigate, #5220). **Kun design, ingen kode.**

> Briefen bad om designet i `docs/superpowers/specs/2026-11-21-7456-prioritet-laast-pas-design.md`. Bølgens leverance (#8233) tillader kun denne ene rapportfil, så hele designet står her. Når ejeren har svaret på A/B-spørgsmålene, flyttes dokumentet uændret til spec-stien i byg-PR'en.

## 1. Hvad er besluttet (kilder)

| Kilde | Beslutning |
|---|---|
| Wireframe 17/11, "Training plan · Week blocks" (ejer-godkendt = specifikationen) | Hver dag har sin egen rækkefølge. Ét pas pr. dag kan låses, så et løb aldrig tager det; det flytter til et ledigt felt. Løb tager laveste prioritet først. Pas taget af løb indhentes ikke. Dagblokke kan trækkes rundt. |
| #7456, 19/11 18:05 | Træthedsgrænsen vinder over låsen. Låsen beskytter kun mod løb; et løb kører altid. |
| #7456, 19/11 17:46 | Et nyt program starter i Week blocks. |
| #7456, 20/11 | Løbsfelter grå + flag (ingen skravering), låste pas med låseikon + guld tekst. Felter: RD på engelsk, LD på dansk. Telefon: variant A (én dag ad gangen), skifter A/B er stadig åben. |
| Skitsen `R5ProgramParts.tsx` (`fillWeekBlocks`, branch `design/7947-r5-program`, PR #8506) | Dagblokken er `{ locked, prio[] }`. Ledige felter fyldes i prioritetsrækkefølge i tidsrækkefølge. Låsen har et hjemmefelt og flytter, hvis et løb står der. Rækken **Races took** viser de pas, der faldt af. |

## 2. Sådan virker det i dag (bekræftet i koden)

- Planen ligger i `training_week_plans.days`: `{ mon: { session, intensity, slots?[5], effort?, slotEfforts?[5] }, ... }` (`trainingPrograms.js`). Felt *i* kører `slots[i] ?? session` (`sessionForDayEntry`).
- Motoren afregner én løbsdag (felt) ad gangen. Feltet er `programSlot = programSlotForRaceDay(raceDay, dateGameDays)` (`dailyTrainingEngine.js` `raceDayFrame`), og `resolveDayProgram({ slotIndex: programSlot })` vælger sessionen.
- Kører rytteren på feltet, rammer han `racedToday` / `boundRestToday`, og **netop det felts pas springes over** (ejer-valg 2, 26/9: "løb er løb"). Der findes ingen prioritet, ingen lås og ingen flytning. Prognosen (`trainingWeekPlanForecast.js`) gør det samme (invariant I5).
- `isValidProgramWeekDays` **afviser ukendte nøgler** i en dag. Det er afgørende for bagudkompatibilitet (afsnit 4.3).
- `ProgramR5.tsx` / `programR5Model.ts` kender i dag kun dagens løbsfelter (`raceSlotsFor(forecast)`), og modellen siger selv, at prioritet og lås ikke findes i backend endnu.

Problemet er dermed bekræftet: et løb tager altid passet i sit eget felt, også det pas spilleren helst ville beholde.

## 3. Målt baseline (read-only, prod, 21/11)

Kun SELECT/EXPLAIN. Tallene er afrundede andele. Rå tal og id'er bliver i privat kontekst (spillertal offentliggøres ikke).

| Måling | Resultat |
|---|---|
| Plan-rækker med sessioner (felt-planer) ud af alle rækker i `training_week_plans` | ca. 94 % |
| Dage hvor alle 5 felter kører samme pas (ingen `slots`) | ca. 81 % af dagene |
| Dage med mindst ét overstyret felt (`slots`) | ca. 19 % |
| Dage med `effort`/`slotEfforts` | 0 (kontakten #7947 er ikke brugt endnu) |
| Rytter-datoer med løb: 1 løbsfelt / 2 / 3-4 | ca. 53 % / 45 % / 2 % |
| Med 2 løbsfelter på datoen: løb i LD 5 | ca. 78 % |
| Opslag af bindinger for ét hold x datoens 5 løbsdage (`race_entry_days`, indeks `no_rider_double_booking_day`) | Index Scan, ca. 18 ms |

**Hvad det betyder:**
1. På ca. 4 ud af 5 dage er de 5 felter ens. Der giver den nye regel præcis samme træning som i dag (samme pas falder af, bare fra et andet felt). Reglen bider kun på dage med forskellige pas, og dér er det netop spillerens valg, der skal beskyttes.
2. Med to løb på datoen ligger det ene næsten altid i LD 5. En lås med hjem i LD 5 flytter derfor ofte. "Moved from LD 5" skal være tydeligt i cellen (skitsen har det allerede).
3. Motoren skal kende alle datoens løbsfelter for rytteren. Det koster ét indekseret opslag pr. hold pr. afregning, og prognosen laver allerede det samme opslag.

## 4. Datamodel (additiv, bagudkompatibel)

### 4.1 Valgt form
Skitsens model, hvor **rækkefølgen er prioriteten** (forudsætter svar A på spørgsmål 1):

- Felternes rækkefølge i `days[wd]` (LD 1..5) er både tidsrækkefølge og prioritet. Det svarer til dagblokkens nummerering 1..4(5).
- Ny valgfri nøgle pr. dag: **`lockSlot`**: heltal 0..4. Det låste pas er `sessionForDayEntry(entry, lockSlot)`, og hjemmefeltet er `lockSlot`. Mangler nøglen, er der ingen lås. Højst én pr. dag følger af formen.
- Ny valgfri kolonne **`training_week_plans.plan_kind text NULL`** (CHECK `plan_kind IN ('week','rotation')`). `NULL` = gammel felt-plan med dagens regel. `'week'` = Week blocks med prioritetsreglen. `'rotation'` hører til søsterdesignet #8548 og skal afstemmes dér, så begge spor bruger samme kolonne.

Hvorfor en kolonne og ikke en nøgle i `days`: `days` skal have præcis 7 nøgler, og en markør i hver dag skulle valideres 7 gange. Kolonnen er additiv. Gammel kode læser `days` som i dag og ignorerer kolonnen.

### 4.2 Migration
`ALTER TABLE training_week_plans ADD COLUMN IF NOT EXISTS plan_kind text NULL` plus CHECK. Ingen backfill og ingen ændring af eksisterende rækker. Flag-rækken `training_week_priority` i `app_config` oprettes i `'off'` (`ON CONFLICT DO NOTHING`). Migrationen køres efter merge (#2642) og kontrolleres bagefter.

### 4.3 Bagudkompatibilitet og rækkefølge af PR'er (vigtigt)
`isValidProgramWeekDays` afviser i dag ukendte nøgler. Ruller koden tilbage, efter at en række har fået `lockSlot`, bliver rækken "ugyldig". Så kan `seedProgramWeekDays` så ugen forfra fra den gamle plan ved spillerens næste ret, og hans felter går tabt. Derfor:
1. **PR 1 (læser først):** validatoren godtager `lockSlot` uanset kontakt. `copyDays`, `setProgramCell` og `stripProgramFromWeekDays` bevarer eller fjerner nøglen. Ingen skriver endnu. Samme mønster som `effort` i #7947.
2. Først i en senere PR må API'et skrive `lockSlot` og `plan_kind`.
3. Tilbagerulning må aldrig gå bag PR 1. Det skrives i PR-body og i runbook-noten.

## 5. Motorens regel

### 5.1 Ren funktion (ny, `backend/lib/trainingWeekBlocks.js`)
```
assignDayFields({ entry, raceFields:Set<0..4>, settled:Map<field, sourceField> })
  -> { fieldSource: (sourceField|null)[5], taken: sourceField[], lockMovedFrom: field|null }
```
1. `free` = felter uden løb, i tidsrækkefølge. Felter, der allerede er afregnet, ligger fast med deres kilde fra `settled`.
2. **Lås:** står hjemmefeltet frit, bliver låsen dér. Ellers flytter den til det nærmeste frie felt, der ikke er afregnet. Ved lige afstand vælges det senere felt (skitsen bruger det sidste ledige). Er intet frit felt tilbage, står låsen i `taken`.
3. **Resten:** de ikke-låste kildefelter i rækkefølge (prioritet 1 først) fyldes i de resterende frie felter i tidsrækkefølge. De kilder, der ikke får plads, er `taken`. Løb tager altså laveste prioritet først, og pas taget af løb indhentes ikke.
4. **Prefix-stabilitet (invariant):** et løb, der kommer til senere på datoen (ny tilmelding), ændrer aldrig et felt, der allerede er afregnet. Det følger af punkt 1-3, fordi felt *j* kun afhænger af løb i felter op til *j* plus låsens flytning, og låsen flytter aldrig ind i et afregnet felt.

### 5.2 Indbygning i motoren (én linje skifter)
Reglen er en **omdirigering af kildefeltet**, ikke en ny træningssti:
```
const sourceSlot = weekBlocksOn && planKind === 'week'
  ? assignDayFields(...).fieldSource[programSlot]   // kun for frie felter
  : programSlot;
resolveDayProgram({ ..., slotIndex: sourceSlot })    // session + effort fra kildefeltet
applyFatigueRules({ ..., slotIndex: programSlot })   // tidspunktet er stadig det rigtige felt
```
- Session og indsats (`slotEfforts`) følger med passet, når det flytter. Det klarer `resolveDayProgram` uændret, fordi den kaldes med kildefeltet.
- **Træthedsgrænsen vinder over låsen:** `applyFatigueRules` kører efter, på feltets rigtige tidspunkt, og erstatter også et låst pas (19/11). Den er uændret.
- Løbsfeltet selv: `racedToday` / `boundRestToday` / `unknownSlot` er uændrede. "Et løb kører altid."
- `raceFields` for rytterens dato = afregnede løbsbelastninger på datoens løbsdage (`canonicalLoadRows`) ∪ planlagte etaper fra `race_entry_days` + `race_stage_schedule`. Bindinger alene er ikke nok, fordi de forsvinder, når løbet er afsluttet (#4850 C2). Det er **samme rene kerne som prognosen** bruger til `raceSlots`, så I5 holder.
- `settled` = datoens kvitteringer (`dateReceipts`). Kvitteringens rapport får et additivt felt `source_slot`, så et allerede kørt pas aldrig køres igen i et andet felt. Det dækker også "Train now" og stemplede ryttere, der afregner ude af rækkefølge (#7737).
- Lag-stigen er uændret: låsen og rækkefølgen læses fra den dag-række, der vinder i `resolveDayProgram` (rytterens egen række ellers holdets). `plan_kind` læses fra samme række.

### 5.3 OFF er bit-identisk
- Kontakt `training_week_priority` (off|beta|on, læses pr. hold som `isTrainingEffortLevelsEnabled`). **Off ⇒ `sourceSlot = programSlot`**, altså præcis dagens kald. Der laves heller intet ekstra opslag, og intet felt skrives i rapporten.
- On, men `plan_kind` er NULL ⇒ også dagens kald. Gamle planer ændrer først adfærd, når spilleren selv gemmer i Program-fanen (ejer-valg 1, 26/9: kun spillerens eget klik ændrer planen).
- Bevis i testplanen: golden-test over et fast udsnit af rækker og datoer, hvor off og (on + NULL) giver byte-ens rapporter og evne-deltaer.

## 6. API

- `PUT .../cell` får valgfrit `lockSlot` (`null` = fjern lås). Validering: 0..4 og kun én pr. dag (følger af formen).
- `PUT .../order` (nyt): ny rækkefølge for én dag som en permutation af 0..4. Serveren flytter `slots`, `slotEfforts` og `lockSlot` med, så indholdet følger passene. Det er træk-og-slip i dagblokken.
- Gem i Program-fanen (guldknappen "Save plan") sætter `plan_kind = 'week'` på rækken.
- Prognosen/ugen returnerer pr. rytter pr. dag `{ fieldSource[5], taken[], lockMovedFrom }`. Den beregnes med `assignDayFields` ud fra planlagte løb i den viste uge (samme kerne). Kun session-nøgler, ingen tal.

## 7. UI (R5 efter TASTE, `ProgramR5.tsx`)

**Desktop (T2, ugegitter som skitsen):**
- Løbsfelt: grå baggrund + flag + løbsnavn, ingen skravering (20/11).
- Låst pas: låseikon + guld tekst "Locked". Er det flyttet: "Locked · from LD 5" (DA: "Låst · fra LD 5"). Ikke-låste pas viser "Priority N" i cellens metalinje.
- Rækken **Races took** (DA: "Løb tog") under felterne, kun i Week blocks: pasnavne pr. dag eller "All sessions ridden" / "Alle pas kørt". Tabular figures. Ingen ny farve.
- Dagblokke under gitteret: nummereret liste (1 = højest), låst pas øverst med låseikon, træk-håndtag, "Copy day". Pas, der er taget denne uge, er gennemstreget med `text-cz-3` (skitsen).
- Én guldknap ("Save plan") i sidehovedet. Låse-toggle og træk er sekundære kontroller. Stroke-ikoner, hairlines, 5px radius.

**Telefon (variant A, én dag ad gangen, 20/11):**
- Dagene i én linje med pile, dagens felter som liste. Løbsfelter, låst og flyttet vises som på desktop.
- "Races took: …" som én linje under dagens felter (skitsen `R5ProgramPhone.tsx`).
- Dagblokken redigeres i et ark: op/ned-knapper (min. 44 px) i stedet for træk, lås som toggle pr. pas. "Save plan" fast i bunden.
- Skifteren A/B (dag/uge-liste) er åben på #7456 og hører ikke til dette design. Reglen og data er de samme i begge.

**Tekst:** EN først, DA under (`tR5`-nøgler i `programR5`), RD på engelsk og LD på dansk. Hjælpetekst i `help.json` (en+da) og en patch note, når kontakten tændes.

## 8. Testplan

| Lag | Test |
|---|---|
| Ren funktion | `trainingWeekBlocks.test.js`: ingen løb ⇒ identitet. 1 løb i hvert felt (5 tilfælde) med og uden lås. 2 løb inkl. LD 5 (lås flytter til nærmeste frie felt; ved lige afstand det senere). 5 løb ⇒ alt i `taken`, låsen også. Ens pas på alle felter ⇒ samme træning som dagens regel. Effort følger kilden. |
| Invariant | Prefix-stabilitet: for alle 2^5 løbsmængder og alle `settled`-prefixer ændrer et tilføjet senere løb aldrig et afregnet felt, og ingen kilde bruges to gange. Egenskabstest over alle kombinationer. |
| Validator / bagudkompat | `isValidProgramWeekDays` godtager `lockSlot` 0..4 og afviser 5, -1 og streng. `copyDays`/`setProgramCell`/`strip` bevarer eller fjerner nøglen. En gammel række uden nøglen er uændret. |
| Motor OFF | Golden: kontakt off og (on + `plan_kind` NULL) giver byte-ens rapporter, scores og evne-deltaer mod main på et fast datasæt (mønster `trainingWeekPlanForecastGolden7801.test.js`). |
| Motor ON | Én dato med løb i LD 1 og LD 5 og lås hjemme i LD 5: felter afregnet i rækkefølge, ude af rækkefølge (Train now/#7737) og med et løb tilføjet efter LD 1 giver samme kilder og samme `taken`. Træthedsgrænse midt på dagen erstatter også det låste pas. |
| Prognose = motor (I5) | Samme fixture giver samme `fieldSource` i prognosen og i motorens rapport. |
| Frontend | `programR5Model.test.ts`: Races took-tekst, "from LD N", gennemstregning. Playwright-snapshots i alle 3 projekter, desktop + 390 px. |
| Fable-dom | Motor/træning ⇒ Fable-dommer før merge (ejer 10/11), og et kort gentjek ved tænding. |

## 9. Byg-plan (trin, filer, risiko)

1. **PR 1, læser + ren kerne:** `trainingPrograms.js` (validator, copy, set, strip), `trainingWeekPlanCells.js` (`copyDays`), ny `trainingWeekBlocks.js` + tests. Ingen adfærd ændres. Risiko lav.
2. **PR 2, migration + kontakt:** `database/2026-11-xx-8549-week-blocks.sql` (kolonne + CHECK + flag off), `trainingWeekBlocksFlag.js`. Risiko lav. Køres efter merge.
3. **PR 3, motor + prognose bag kontakt:** `dailyTrainingEngine.js` (kildefelt, `raceFields`, `source_slot` i rapport), `trainingWeekPlanForecast.js` (samme kerne). Golden OFF-test. Risiko middel (motor) ⇒ design er dette dokument, Fable-dom før merge.
4. **PR 4, API + UI:** routes (`lockSlot`, `/order`, `plan_kind` ved Save), `ProgramR5.tsx`, `programR5Model.ts`, i18n, help.json. Ejeren ser billeder på preview før merge (UI-gate).
5. **Tænding:** beta → on er ejer-only. Patch note samme dag.

Største risici: (a) tilbageløb bag PR 1 kan slette felter (afsnit 4.3); (b) løbsfelter, der skifter midt på datoen, mødes af prefix-stabilitet + `source_slot`; (c) `plan_kind` skal afstemmes med #8548/#8550, så de tre spor ikke laver hver sin markør.

## 10. Åbne spørgsmål til ejeren (A/B med anbefaling)

1. **Hvad er "prioritet"?**
   - **A (anbefalet):** rækkefølgen i dagen *er* prioriteten, som i skitsen og wireframet ("hver dag har sin egen rækkefølge"). Et løb skubber dagen ned, og det sidste ikke-låste pas falder af. Låsen holder det ene pas, der skal blive (fx Lang tur sidst på dagen). Intet ekstra tal at forstå.
   - B: et separat prioritetstal pr. felt, uafhængigt af tidspunktet. Mere kontrol, men to ting at indstille pr. dag (træk for tid + tal for prioritet).
2. **Gælder reglen også for planer, spilleren ikke har gemt igen?**
   - **A (anbefalet):** kun planer gemt i den nye Program-fane (`plan_kind = 'week'`). Gamle planer kører som i dag, indtil spilleren selv gemmer. Det følger ejer-valget "kun spillerens eget klik ændrer planen". På ca. 4 ud af 5 dage er der desuden ingen forskel.
   - B: alle felt-planer får reglen, når kontakten tændes. Det er enklere at forklare, men pas flytter tidspunkt uden spillerens klik.
3. **Hvor flytter låsen hen, når et løb står i dens felt?**
   - **A (anbefalet):** til det nærmeste ledige felt, ved lige afstand det senere. Så holdes "sidst på dagen"-hensigten.
   - B: altid til det sidste ledige felt (som skitsens kode gør i dag).

## Bevis (hvad jeg undersøgte og hvordan)
- Issues: #8549 og #7456 (body + alle 18 kommentarer, især 17/11, 19/11 og 20/11).
- Kode på main (`f471418de`): `backend/lib/trainingPrograms.js` (dataform, `isValidProgramWeekDays`, `resolveDayProgram`, `programSlotForRaceDay`), `backend/lib/trainingWeekPlanCells.js`, `backend/lib/trainingWeekPlanCellsFlag.js`, `backend/lib/dailyTrainingEngine.js` (l. 490-501 `raceDayFrame`, l. 1814-2030 per rytter: `resolveDayProgram` → `applyFatigueRules` → `racedToday`/`boundRestToday`), `backend/lib/trainingWeekPlanForecast.js`, `database/2026-07-11-training-week-plans.sql`, `database/2026-10-01-training-cells-flag.sql`, `frontend/src/components/training/r5/ProgramR5.tsx`, `programR5Model.ts`.
- Skitsen: `origin/design/7947-r5-program` (`e463f750`): `R5Program.tsx` (WeekGrid, Races took, DayBlocks), `R5ProgramParts.tsx` (`fillWeekBlocks`, `applyLimit`).
- Prod, read-only via Supabase MCP: 3 SELECT-opgørelser og 2 EXPLAIN ANALYZE (afsnit 3). En overflødig `CREATE TEMP TABLE` (session-midlertidig, uden data) blev kørt ved en fejl. Den rører ingen tabeller og forsvinder med sessionen.

**Dom:** problemet er bekræftet i koden. I dag tager et løb altid passet i sit eget felt (`slotIndex: programSlot` → `racedToday`), og der findes hverken prioritet, lås eller rækken Races took. Fix-planen står i afsnit 4-9.

bekraeftet + fix-plan


## Tilføjet 22/11 efter Codex-review: SSOT og dommer-scenarier (AGENTS regel 30 og 40)

**SSOT.** Designet er afstemt mod [`docs/TRAINING_RULES.md`](../TRAINING_RULES.md) §3 (dagstyper og sessioner), §4 (ugerytme og hvilket lag der vinder), §5 (restitution, træthedsgrænse og skader), §6 (træning og løbsdage), §13 (træning pr. løbsdag, fem felter pr. dato) og [`docs/CALENDAR_RULES.md`](../CALENDAR_RULES.md) §0 (de to akser: dato og løbsdag), §2b (rytterbinding) og §4 (etapeløb og endagsløb). Hvor designet og reglerne er uenige, vinder reglerne, og afvigelsen er et ejer-spørgsmål før byg.

**Dommer-scenarier før kode (AGENTS 40).** Den uafhængige Fable-dommer skriver de forventede scenarier ud fra reglerne ovenfor, før første kode-PR merges, i `docs/audits/7456-program-dommer-scenarier.md` (fælles for #8548, #8549 og #8550). Samme dommer gennemgår hver motor- og data-PR mod scenarierne før merge. PR 1 for #8548 og #8549 blev startet 22/11 nat før scenarierne. De merges ikke, før scenarierne og dommerens gennemgang foreligger.

**Prognose = motor (I5), rettet efter Codex 22/11.** Prognosen må ikke kun bruge planlagte løb. Den bruger samme kvitteringsbaserede kilde-mapping som motoren: `settled` fra datoens kvitteringer (`source_slot`), inklusive afregnede og gennemførte løb, plus planlagte etaper for resten af datoen. Eksempel: A-E med E låst på LD 5, LD 1-4 afgjort, og et løb tilføjet sent i LD 5. Motoren placerer intet i et afgjort felt, så E står i `taken`, og prognosen skal vise det samme og ikke flytte E til LD 4. `assignDayFields` deles af begge (afsnit 5.2), og `settled` er påkrævet input i prognosen.
