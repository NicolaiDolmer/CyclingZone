# Traeningsprogrammer: ugeplan med session pr. ugedag + default-programmer (design 3/9 2026)

> **Status:** design-spec til ejer-godkendelse, ikke byg. Ingen kode i denne PR, ingen prod-mutation.
> **SSOT for omraadet:** [`docs/TRAINING_RULES.md`](../../TRAINING_RULES.md) - regler bor der, ikke her. Hard rule 30(b): hver regel i dette dokument citerer det SSOT-afsnit den bygger paa.
> **Issue:** [#4629](https://github.com/NicolaiDolmer/CyclingZone/issues/4629) (lukker ogsaa [#4116](https://github.com/NicolaiDolmer/CyclingZone/issues/4116)). Ejerens retning er samlet i `TRAINING_RULES.md` §12 (Discord 2/9).

---

## 1. Problemet og ejerens maal

**Ejerens ord, ordret** (issue #4629, citeret fra Discord #dansk-strategi 2/9 kl. 12:20-13:20, samlet i `TRAINING_RULES.md` §12.1 princip C):

> "Jeg regner med, at vi paa sigt gaar over mod, at man laver et 'traeningsprogram' i stedet for at man behoever at aendre traeningen hver eneste dag. Og saa kan man finde et default program, der f.eks hedder 'sprinter' eller 'bakkerytter' - Og paa den maade, tror jeg, at jeg kan imoedekomme foelelsen af et behov for en traening der hedder 'brostensrytter' f.eks. Og saa inde i det program faar man maaske 3 dage teknisk, 2 dage zone 2, 1 dags hvile og en dags punch."

> (til egomadsens oenske om at ugeplanen ikke bare er intensitet, men den komplette traening: "Mandag = Intervaller, tirsdag = TT, onsdag = loebslaere, osv.") "Ja hov, den her oversaa jeg faktisk - Men er helt enig. Det haaber jeg paa at faa ind i spillet.. Indenfor en maanedstid, cirka."

> "Og i oevrigt taenker jeg at lave muligheden 100% for at man kan lave egne traeningsprogrammer, med egen valgt sammensaetning. Saa taenker jeg at lave 10-25 programmer fra 'default' man kan vaelge."

**Hvad spillerne bad om samme traad** (`TRAINING_RULES.md` §12.3), og hvordan denne spec svarer:

| Oenske | Fra | Svaret i denne spec |
|---|---|---|
| Traen en ryttertype (alle relevante evner paa en gang) i stedet for et saet evner | egomadsen, knud_r_flink, robsteren | §4: default-programmer navngivet efter typen, ikke en ny fokus-akse |
| Ugeplan med komplet session pr. dag, ikke kun intensitet | egomadsen, friisisch | §3: `days`-kolonnen baerer en SESSION, ikke en intensitet |
| De gamle tre intensitetsniveauer tilbage | robsteren | ikke denne spec's svar - princip D (loebsdags-intention, #4632) daekker det |

**Maal:** ejerens tidsramme er "indenfor en maanedstid, cirka" (sat 2/9, saa ca. 2/10). Denne spec definerer det fulde omfang og en slice-raekkefoelge der kan leveres inden for den ramme uden at blokere paa #4630 (deling), #4632 (loebsdags-intention) eller #4633 (formtraening).

**Ikke i scope** (fra issue-teksten, ordret): "Deling/community-workshop (egen issue). Loebsdagens valg (grupetto til all-out), egen issue. Auto-periodisering ud fra kalenderen (#2337) er et lag ovenpaa, ikke en del af dette."

---

## 2. Begreber

| Begreb | Definition | SSOT-forankring |
|---|---|---|
| **Session** | Den atomare ting en rytter traener paa EN dag. Findes allerede: `technique`, `aero`, `loebslaere` (faerdighed), `endurance`, `tempo`, `vo2max`, `vo2max_climb`, `vo2max_punch`, `threshold`, `sprint` (traening), plus de to hele-dags-tilstande `rest` og `recovery`. Intensiteten er en EGENSKAB ved sessionen, ikke et separat valg | `TRAINING_RULES.md` §3 ("Intensiteten er ikke et valg, den er en egenskab ved sessionen"), `backend/lib/trainingDayTypes.js` (`SESSION_INTENSITY`, `ALL_SESSIONS`) |
| **Ugedag** | En af de 7 ugedage, `mon`..`sun`. En ugeplan kraever ALLE 7 - ingen delvis rytme | `TRAINING_RULES.md` §4 ("En ugeplan kraever alle 7 ugedage"), `backend/lib/training.js` (`WEEKDAY_KEYS`, `isValidWeekPlanDays`) |
| **Program** | En navngivet 7-dages skabelon: en session pr. ugedag. To slags: **system-default** (10-25 stk., denne spec §4) og **eget** (spillerens egen sammensaetning, #4630, ikke bygget her men datamodellen forbereder det) | Issue #4629 punkt 2 ("Et program = en navngivet 7-dages skabelon") |
| **Tildeling pr. rytter (assignment)** | Handlingen at laegge et program paa HELE truppen eller paa en eller flere navngivne ryttere. Skriver en snapshot af programmets 7 dage ind i den eksisterende `training_week_plans`-raekke for holdet (`rider_id IS NULL`) eller rytteren (`rider_id` sat) | `TRAINING_RULES.md` §4, lag 1 og 3 i `resolveDayIntensity`-stigen (genbruges, se §3.3) |
| **Override-dag** | Naar en manager efter en tildeling aendrer PRAECIS EN ugedag i en allerede-tildelt uge, uden at redefinere resten. Det er IKKE et nyt lag i motoren - det er blot en redigering af den samme 7-dages raekke, som UI'et praesenterer med provenance ("Sprinter · ons overstyret") | §3.4 |

**Bevidst IKKE genopfundet:** rytterens egen pr-dag-override (lag 1 i `resolveDayIntensity`) og rytterens eksplicitte `training_plans`-raekke (lag 2) er de samme mekanismer som i dag, kun med session i stedet for intensitet som payload. Se §3.3.

---

## 3. Datamodel

### 3.1 Uroert

`training_plans` (`id, team_id, rider_id, season_id, focus, intensity, created_at, updated_at`, jf. `database/schema-snapshot.json`) aendres IKKE i denne spec. Den forbliver lag 2 og lag 4 i prioritetsstigen, uaendret betydning: rytterens sæson-lange `(focus, intensity)`-par, som `trainingDayTypes.js`'s `dayTypeForProgram`/`sessionForProgram` allerede oversaetter til en session uden skema-aendring (`TRAINING_RULES.md` §3, "Ingen skema-aendring: `training_plans` baerer stadig (focus, intensity)"). Det er praecis samme genbrugs-princip denne spec foelger for `training_week_plans`.

### 3.2 Aendret: `training_week_plans`

I dag: `id, team_id, rider_id, days, created_at, updated_at`, hvor `days` er `{ mon: { intensity: "rest" }, ..., sun: { intensity: "normal" } }` (`backend/lib/training.js:383-397`, kommentaren over `isValidWeekPlanDays`).

**Ny form:** hver dags-entry faar en `session`-noegle i stedet for (paa sigt: ud over) `intensity`:

```
{ mon: { session: "vo2max_climb" }, tue: { session: "recovery" }, wed: { session: "technique" },
  thu: { session: "rest" }, fri: { session: "tempo" }, sat: { session: "endurance" }, sun: { session: "rest" } }
```

Gyldige `session`-vaerdier: `ALL_SESSIONS` (`trainingDayTypes.js`) plus de to hele-dags-pseudo-sessioner `"rest"` og `"recovery"`. Ingen nye sessioner opfindes i denne spec (issue-kravet: "opfind ikke nye effekter") - katalog og lofter er uaendrede, kun HVORDAN en ugedag udtrykkes aendres.

**Ny kolonne:** `program_id uuid null references training_programs(id) on delete set null`. Provenance, ikke sandhed - `days` er stadig den fulde, selvstaendige 7-dages sandhed motoren laeser (samme princip som `training_plans` §3.1: ingen anden-kilde-drift). `program_id` bruges kun til UI-visning ("baseret paa Sprinter") og til aabne beslutning 1 i §8.

**Bagudkompatibilitet - eksisterende raekker uden `session`:** motoren laeser `entry.session` foerst; findes den ikke, falder den tilbage til en afledning fra den gamle `entry.intensity`, saa INGEN eksisterende raekke aendrer adfaerd foer den redigeres:

| Gammel `intensity` | Afledt `session` | Begrundelse |
|---|---|---|
| `"rest"` | `"rest"` | 1:1, ingen tvetydighed |
| `"recovery"` | `"recovery"` | 1:1, ingen tvetydighed |
| `"easy"` | `"endurance"` | eneste `easy`-traeningssession i `TRAINING_SESSIONS_BY_LEVEL.easy` |
| `"normal"` | `"tempo"` | eneste `normal`-session i `TRAINING_SESSIONS_BY_LEVEL.normal` |
| `"hard"` | rytterens eget `training_plans.focus` hvis det er en `hard`-session, ellers `"vo2max"` | samme "bevar EVNERNE, ikke intensiteten"-regel som migrationen i #3762 (`TRAINING_RULES.md` §3, "Migrations-reglen var: bevar EVNERNE, ikke intensiteten") og i #4631 |

Dette er en LAESE-tids-afledning, ikke en tvungen skrive-migration - gamle raekker forbliver gyldige data. En separat, valgfri backfill (Slice 4, §7) kan skrive `session` ind i eksisterende raekker for at goere provenance-UI'et konsistent, men motoren kraever den ikke.

### 3.3 Ny tabel: `training_programs`

| Kolonne | Type | Noter |
|---|---|---|
| `id` | uuid, pk | |
| `slug` | text, unique | fx `"sprinter"`, `"cobbles-rider"` |
| `name_en`, `name_da` | text | spillervendt, EN foerst (`docs/CLAUDE.md`-sprogregel, projekt-CLAUDE.md) |
| `tagline_en`, `tagline_da` | text | een saetning, "hvad programmet er til" (issue-krav) |
| `target_rider_types` | text[], null-bar | delmaengde af `RIDER_TYPE_KEYS` (`PROGRESSION_RULES.md` §2: `climber, rouleur, sprinter, puncheur, baroudeur, brosten, gc, tt`), tom/null = generelt program |
| `days` | jsonb | samme form som §3.2's `days`-entries, alle 7 ugedage kraevet |
| `is_system` | boolean, not null, default `true` | `true` = et af de 10-25 default-programmer i denne spec; `false` reserveret til spillerens egne (#4630) |
| `team_id` | uuid, null-bar, fk `teams(id)` | `null` for system-defaults; sat naar #4630 lader en spiller gemme sit eget |
| `created_by` | uuid, null-bar | rytteren/spilleren der oprettede et eget program (#4630) |
| `created_at`, `updated_at` | timestamptz | |

**Hvorfor kolonnerne `is_system`/`team_id`/`created_by` findes allerede nu, selvom #4630 (egne programmer + deling) eksplicit er ude af scope:** at tilfoeje dem i SAMME migration som default-programmerne undgaar en 2. skema-aendring naar #4630 bygges, og koster intet i dag (de staar `null`/`true` for alle 10-25 raekker denne spec seeder). `is_system=false`-raekker skrives IKKE af nogen kode i denne spec.

**RLS-retning** (byg-tid beslutning, ikke aaben ejer-beslutning): system-programmer (`is_system=true`) laesbare af alle autentificerede brugere; egne programmer (naar #4630 bygges) laese/skriv kun for ejer-holdet, indtil workshop-deling aabner dem.

### 3.4 Hvordan motoren laeser "dagens session"

`resolveDayIntensity` (`backend/lib/training.js:422-437`, `TRAINING_RULES.md` §4) generaliseres til `resolveDaySession` med PRAECIS samme 5-lags prioritet, blot med `session` som payload i stedet for `intensity`:

| # | Lag | Kilde | Aendring fra i dag |
|---|---|---|---|
| 1 | Rytterens egen pr-dag-override | `training_week_plans` med `rider_id` sat | uaendret lag, ny payload (`session`) |
| 2 | Rytterens egen eksplicitte plan | `training_plans` via `sessionForProgram(plan)` (findes allerede i `trainingDayTypes.js`) | ingen kode-aendring - allerede en session-oversaettelse |
| 3 | Holdets ugerytme / tildelte program | `training_week_plans` med `rider_id IS NULL` | uaendret lag. **Et tildelt program SKRIVER ind i dette lag** (eller lag 1, hvis tildelt en enkelt rytter) - der er intet nyt 6. lag |
| 4 | Allerede resolvet plan-/default-session | `resolveProgram` → `sessionForProgram` | uaendret |
| 5 | `"tempo"` (afloeser dagens `"normal"`) | sidste sikkerhedsnet | samme rolle, ny vaerdi |

Effektiv intensitet til motoren (`dailyTrainingEngine.js:301-307`) afledes derefter med eet opslag: `SESSION_INTENSITY[session]` for traenings-/faerdighedssessioner, eller direkte `"rest"`/`"recovery"` for de to pseudo-sessioner. **Motoren laeser stadig igennem EEN funktion** (issue-accept-kriteriet "Motoren laeser ugeplanen gennem samme `resolveDayIntensity`-sti, ingen ny sandhed") - stien er den samme, kun navnet og payloaden aendres fra intensitet til session, hvilket er praecis hvad issue #4629 punkt 1 beder om.

**Override-dag i praksis:** en tildeling (§2) skriver en fuld 7-dages snapshot ind i lag 1 eller lag 3. En efterfoelgende override-dag redigerer EEN ugedags-entry i den SAMME raekke - `isValidWeekPlanDays` kraever stadig alle 7 noegler (`TRAINING_RULES.md` §4, "ingen delvis rytme"), saa en override er en delvis SKRIVNING til en allerede-komplet raekke, ikke en ny delvis-model. `program_id` bevares som provenance saa UI'et kan vise "Sprinter · ons overstyret" (§6).

---

## 4. Default-programmer (16 stk., inden for 10-25)

Alle dage bruger udelukkende eksisterende sessioner (`ALL_SESSIONS` + `rest`/`recovery`, `TRAINING_RULES.md` §3) - ingen nye effekter opfindes. Maalgruppe-kolonnen refererer `RIDER_TYPE_KEYS` (`PROGRESSION_RULES.md` §2) hvor relevant.

| Program (EN) | Program (DA) | Maalgruppe | Tagline (EN) | Uge (mon-sun) |
|---|---|---|---|---|
| Sprinter | Sprinter | `sprinter` | Sharpen the finish with sprint days and recovery between them. | sprint, endurance, technique, sprint, recovery, tempo, rest |
| Hill climber | Bakkerytter | `climber` | Build the climbing legs with repeated climbing intervals. | vo2max_climb, endurance, technique, vo2max_climb, recovery, tempo, rest |
| Cobbles rider | Brostensrytter | `brosten` | Technique-heavy week with one punchy day for cobbled sectors. | technique, endurance, technique, endurance, technique, vo2max_punch, rest |
| GC rider | GC-rytter | `gc` | A balanced mix of threshold, climbing and long endurance. | threshold, endurance, vo2max_climb, tempo, recovery, endurance, rest |
| All-rounder | Rouleur | `rouleur` | Broad development across tempo, aero and threshold. | tempo, aero, endurance, threshold, recovery, endurance, rest |
| Puncheur | Puncheur | `puncheur` | Short, sharp efforts for punchy finishes and hilltop attacks. | vo2max_punch, technique, endurance, vo2max_punch, recovery, tempo, rest |
| Breakaway rider | Baroudeur | `baroudeur` | Threshold and race craft for riders who go on the attack. | threshold, loebslaere, endurance, vo2max, recovery, tempo, rest |
| Time triallist | TT-specialist | `tt` | Aero position and sustained power for the race of truth. | threshold, aero, tempo, threshold, recovery, endurance, rest |
| Build base | Byg base | generelt | Low-intensity volume to build the aerobic foundation. | endurance, technique, endurance, recovery, endurance, tempo, rest |
| Recovery week | Restitutionsuge | generelt | A light week to bring fatigue back down before the next block. | recovery, recovery, technique, recovery, rest, recovery, rest |
| Technical focus | Teknisk fokus | generelt / ungdom | Technique, aero and race craft, light on the legs. | technique, aero, loebslaere, technique, recovery, endurance, rest |
| Balanced week | Afbalanceret uge | generelt | One of everything: a bit of endurance, tempo, intervals and skill. | endurance, technique, tempo, recovery, vo2max, endurance, rest |
| Hard block | Haard blok | generelt (erfarne) | A demanding week of intervals and threshold for riders in good form. | vo2max, threshold, recovery, vo2max, recovery, tempo, rest |
| Active recovery block | Aktiv restitutionsblok | generelt | Mostly active recovery with light technique days between. | recovery, endurance, recovery, technique, recovery, endurance, rest |
| Youth development | Ungdomsopbygning | ungdom/akademi | Skill and endurance first, no hard days. | technique, endurance, aero, endurance, loebslaere, tempo, rest |
| Peak week | Topformuge | generelt | Sharpen with intervals, then rest before the goal race. | vo2max, recovery, threshold, recovery, rest, tempo, rest |

**Cobbles rider matcher ejerens eget eksempel ordret:** "3 dage teknisk, 2 dage zone 2, 1 dags hvile og en dags punch" → 3× `technique`, 2× `endurance` (zone 2), 1× `rest`, 1× `vo2max_punch`.

**Ikke en balance-beslutning i sig selv:** hvilke sessioner der ligger i pakkerne (fx `vo2max_climb` vs. `vo2max_punch`) er allerede afgjort af #4631 (`TRAINING_RULES.md` §3.1, bygget). Denne liste vaelger KUN blandt eksisterende sessioner - ingen nye rater, vaegte eller lofter (hard rule 17).

---

## 5. Hvordan #4632 og #4633 passer ind uden at blokere

### 5.1 #4632 - loebsdagens intention (grupetto til all-out)

Issue #4629 er eksplicit: "Loebsdagens valg (grupetto til all-out), egen issue" er UDE af scope. Denne spec forudsaetter derfor at #4632 forbliver ubygget, og programmer designes saa de hverken kraever eller blokerer paa den:

- **Et programs ugedags-vaerdi er, hvad rytteren traener naar han IKKE loeber loeb den dag.** Det aendrer intet ved dagens kendte afvigelse (`TRAINING_RULES.md` §6.2): saa laenge `race_day_development_enabled` er off (S3), er programmets vaerdi for en loebsdag lige saa inert som dagens `training_plans.intensity` allerede er.
- **Naar #4632 bygges**, indfoeres en loebsdags-intention som et EGET, hoejere-prioriteret lag (over §3.4's lag 1-5) for de dage hvor rytteren rent faktisk staar til start - praecis den model ejerens dom 24/8 allerede kraever ("Du traener enten. Eller koerer loeb."). Det er en TILFOEJELSE til stigen, ikke en aendring af hvordan et program skrives eller tildeles.
- **Ingen skema-kollision:** `training_week_plans.days` faar ikke et "race intention"-felt i denne spec (se aaben beslutning 2, §8) - #4632 designer sin egen lagring naar den er klar.

### 5.2 #4633 - formtraening for alle

Issue #4633 er stadig `OPEN`, ikke besluttet (A/B/C mellem "session der styrer traethed", "session med egen form-effekt" eller en eksplicit indstilling). Naar en beslutning er truffet og en evt. ny session (fx `"form"`) tilfoejes til `trainingDayTypes.js`'s katalog:

- **Programmer refererer sessions via slug i `jsonb`, ikke et hardkodet enum i databasen.** At udvide `ALL_SESSIONS` med en formtraenings-session kraever INGEN migration af `training_programs`-tabellen - kun en applikations-niveau validerings-liste udvides, samme princip som §3.2's bagudkompatibilitet.
- **Eksisterende default-programmer (§4) beroeres ikke.** En formtraenings-session kan senere tilfoejes til fx "Recovery week"/"Restitutionsuge" eller faa sit eget program, men det er en opfoelgende, lille redigering af `days`-jsonb'en paa specifikke raekker, ikke en ny tabel eller kolonne.

---

## 6. UI-touchpoints (i forlaengelse af #4613)

#4613 (traeningssiden som overblik foerst + faner) er selv `OPEN`/design-status. Denne spec forudsaetter dens fane-struktur og tilfoejer EEN fane: **"Program"**.

- **Programfanen** viser: rytterens/holdets aktive program (navn + tagline hvis tildelt via `program_id`, ellers "Ingen program - dagsvalg"), en read-only 7-dages raekke af sessions-badges, og et katalog-view grupperet efter maalgruppe (§4) med eet gyldigt "Anvend"-knap-moenster pr. view (`docs/design/PAGE_TEMPLATES.md`, "een gold primary-knap pr. view").
- **Tildeling:** "Anvend paa hele truppen" vs. "Anvend paa [navngivet rytter]" - to indgange, samme kald (§3.4).
- **Override-dag:** klik paa en enkelt dags-badge i den tildelte uge aabner et lille session-vaelger-modul begraenset til dagens gyldige sessioner (samme trin-1/trin-2-model som `trainingDayTypes.js` allerede definerer for `training_plans`); efter redigering viser badgen "· overstyret" i stedet for programmets navn paa den dag.
- **Ingen ny container, radius eller skygge** - genbruger DataTable/Card-moenstre fra kittet (`docs/design/TASTE.md`).
- Fuld wireframe-tegning (desktop + mobil) hoerer under #4613's egen "2-3 wireframes vises ejeren FOER retning vaelges"-krav, ikke denne spec - denne spec beskriver kun HVOR programfanen sidder og hvad den skal kunne, ikke dens visuelle udformning.

---

## 7. Slices i raekkefoelge

| Slice | Indhold | Verify-niveau |
|---|---|---|
| **0** | Denne design-spec. Ingen kode | docs-only PR, ingen test |
| **1** | Migration: `training_programs`-tabel + `training_week_plans.program_id`-kolonne. Idempotent seed af de 16 default-programmer fra §4. Ingen prod-apply i denne slice (post-merge under #2642-rammer, hard rule 9) | TIER FULL (skema-aendring): migrations-idempotens-test, `database/schema-snapshot.json` opdateres, ingen destruktiv klasse (kun tilfoejelser) |
| **2** | Backend laesesti: `resolveDaySession` (generaliserer `resolveDayIntensity`), bagudkompatibel session-afledning (§3.2-tabellen), `dailyTrainingEngine.js`'s kaldested opdateres. Nye endpoints: `GET` programkatalog, `POST` tildel program (team/rytter) | TIER FULL (motor roert): fuld lokal suite (`scripts/verify-local.ps1`), alle traenings-testfiler i `TRAINING_RULES.md` §11 ("Tests der haandhaever reglerne") udvides, ikke kun tilfoejes til |
| **3** | Frontend: Programfanen i #4613's fane-struktur (kataloggennemsyn, tildeling, override-dag) | `npm run lint` + `node --test` (frontend) + `node scripts/verify-affected.mjs`. Fuld `npm run test:e2e` (alle 3 Playwright-projekter, visuel aendring) ejes af orkestratoren, ikke denne worker |
| **4** | Valgfri backfill: skriv `session` ind i eksisterende `training_week_plans`-raekker der kun har `intensity` (opportunistisk, ikke-destruktiv). Patch note + `help.json` (en+da) for den nye Program-fane | Idempotent migrations-test + `pwsh -File scripts/preflight-pr.ps1` |
| **5 (senere, #4630)** | Egne programmer + workshop-deling. `is_system=false`/`team_id`/`created_by` allerede paa plads fra Slice 1, saa ingen ny skema-aendring kraeves for at starte #4630 | egen spec, egen slice-plan |

---

## 8. Aabne ejer-beslutninger (maks 3)

### Beslutning 1 - Snapshot eller live-reference ved tildeling?

**A - Snapshot (copy-on-apply).** `program_id` er ren provenance; redigerer ejeren senere selve default-programmet (balance-tuning), aendrer det IKKE allerede-tildelte ryttere/hold.
**B - Live reference.** Raekken gemmer kun `program_id` + en per-dags-override-diff; en senere redigering af programmet propagerer automatisk til alle der stadig staar paa uaendrede dage.

**Anbefaling: A.** Matcher direkte postmortem'et bag #2438 (`TRAINING_RULES.md` §4: "en individuel rytter-indstilling overtrumfer den ugentlige rutine" - en spiller mistede hele sit hold til haard traening fordi et hoejere lag aendrede sig under ham uden hans viden). En live-reference genintroducerer risikoen for at en rytters traening flytter sig UDEN et bevidst tildelings-klik. Ingen kode i denne spec kraever B, og A er den simplere implementering.

### Beslutning 2 - Skal et program kunne udtrykke en loebsdags-intention allerede nu?

**A - Nej, programmets dags-vaerdi forbliver inert paa loebsdage** (dagens §6.2-model), indtil #4632 (endnu ubesluttet) tilfoejer sit eget, separate lag.
**B - Ja, hver ugedag i et program faar et ekstra, valgfrit "loebsdags-intention"-felt allerede i Slice 1's skema**, saa et formaals-bygget program (fx GC-rytter) ogsaa kan udtrykke taktik.

**Anbefaling: A.** Issue #4629 udelukker eksplicit loebsdagens valg fra sit eget scope, og #4632 har sin egen, ikke-afsluttede beslutningsliste (fire designspoergsmaal, egen accept-liste). At forhaandsantage et skema for B nu risikerer at skulle rulles tilbage naar #4632 rent faktisk designes.

### Beslutning 3 - Skal de 16 foreslaaede default-programmer (§4) laases nu, eller reviewes foerst?

**A - Laas nu.** Slice 1 seeder listen i §4 verbatim.
**B - Ejeren gennemgaar/redigerer listen** (navne, maalgrupper, ugeskabeloner) foer nogen seed-migration skrives, siden dette er spillervendt indhold OG en let balance-adjacent sammensaetning.

**Anbefaling: B.** Billigt for ejeren at goere som eet visuelt review-pas foer Slice 1 overhovedet findes i kode, og matcher praecedensen om at vise mockups/lister foer bygning frem for "test selv til sidst".

---

## 9. Referencer

`TRAINING_RULES.md` §3 (dagstyper og sessioner), §3.1 (#4631-splittet), §4 (`resolveDayIntensity`-stigen), §12 (ejerens retning 2/9) · `PROGRESSION_RULES.md` §2 (8 arketyper) · `docs/design/PAGE_TEMPLATES.md` · `docs/design/TASTE.md` · `database/schema-snapshot.json` · `backend/lib/training.js` · `backend/lib/trainingDayTypes.js` · issues #4629 #4116 #4630 #4631 #4632 #4633 #4613 #3762 #2438 #1895
