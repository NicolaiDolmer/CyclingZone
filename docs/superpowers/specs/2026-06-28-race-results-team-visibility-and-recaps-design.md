# Race results: holdvinder-synlighed (#1485) + tekst-recaps (#1311)

> Design — 2026-06-28. To tæt-koblede præsentations-features på løbsresultat-fladen.
> **Ét spec-dokument, to PR'er** (én pr. issue) for ren patch-notes + close-protokol.
> **Hard constraint:** rene frontend-/præsentationsændringer. INGEN ændring af race-motoren
> (`raceSimulator.js`/`raceRunner.js`/`raceResultsEngine.js`), INGEN DB-migration, INGEN ny
> sim-mekanik. Begge bygger udelukkende på data der allerede persisteres i `race_results`.

## Baggrund / verificeret nuværende tilstand

- **Holdklassement findes allerede** i motoren: `teamClassification()` (sum af holdets bedste 3
  rytteres kumulative tid) skriver rækker med `result_type='team'` (raceRunner.js:88-104, 164-181,
  244, 271). `RaceDetailPage.jsx` har allerede `team` i `CLASSIFICATIONS` (linje 36-42) og renderer
  det via `OverallTab` → `ResultTable`.
- **Rod-årsag til at vinderen ikke kan ses (#1485):** team-rækker bærer KUN `team_id` —
  `rider_id=NULL`, `rider_name=NULL`, `team_name=NULL` (pushTeam, raceRunner.js:164-181).
  Frontend-queryen henter holdnavn via et *rytter*-join (`rider:rider_id(...team)`,
  RaceDetailPage.jsx:~143), men team-rækker har ingen rytter → `ResultTable` viser holdklassementet
  som en liste af "—" (riderName-fallback, linje 55-58). Holdets tid er heller ikke persisteret som
  `finish_time` (sættes til null), så holdklassementet har kun rank + (evt.) point.
- **Recaps findes ikke** (#1311): ingen recap/narrative/highlight-kode nogen steder. Motoren
  persisterer dog allerede nok rå-data til skabelon-fortællinger: finish-orden, tids-gab
  (`finish_time`), `in_breakaway`/`breakaway_caught` pr. rytter, trøje-holdere, holdklassement.
- **Spredte race-tider (#1311's anden halvdel) er ALLEREDE live** — etaper afvikles 11–19 spredt
  over dagen (verificeret mod `race_stage_schedule`). Den del kræver intet arbejde; #1311 reduceres
  til tekst-recaps.
- i18n: `frontend/public/locales/{en,da}/races.json`, `detail`-sektion (`detail.classification.team`,
  `detail.breakaway.*` findes). EN-først, DA-sekundært.

## Del 1 — #1485: gør holdvinderen synlig

**Mål:** når et løb er kørt, kan spilleren *se* hvilket hold der vandt holdkonkurrencen — med
holdnavn, ikke "—", og med vinderen tydeligt fremhævet.

### Ændringer (frontend, 0 motor-ændring, 0 migration)

1. **Query-join** (`RaceDetailPage.jsx`, fetch ~linje 143): tilføj `team:team_id(id, name)` til
   `.select(...)` på `race_results`, så hver række kan resolve sit *eget* hold (uafhængigt af
   rytter-joinet). Rytter-joinet bevares uændret for individuelle rækker.

2. **Entitets-resolver** (ny ren helper, fx `frontend/src/lib/raceResultEntity.js`):
   `resultEntity(row)` → `{ kind: 'team'|'rider', name, linkId, nationality? }`.
   - team-række (`result_type === 'team'` ELLER `rider_id == null && team_id != null`) → holdets
     navn fra `row.team?.name`, link til `row.team?.id`.
   - rytter-række → eksisterende `riderName(row)` + rytter-link + nationalitet.
   Holder visnings-logikken testbar og ude af JSX.

3. **`ResultTable`** (RaceDetailPage.jsx:516): brug `resultEntity(row)` til navne-cellen. For
   team-rækker: vis holdnavn med `TeamLink` (ikke tom rytter-celle), ingen flag/breakaway-markør,
   ingen tids-kolonne (team-rækker har `finish_time=null`). For rytter-rækker: uændret.

4. **Vinder-fremhævning:** holdklassementets rank-1-række får accent-behandling + en "Winner"-markør
   (`detail.team.winner`). Implementeres som en lille variant i `ResultTable` (prop `highlightWinner`
   sat når `title` er holdklassementet) ELLER en dedikeret rendering i `OverallTab` for `team`-nøglen.
   Anbefaling: `highlightWinner`-prop — mindst kode, genbruger tabellen.

### i18n
- Ny: `detail.team.winner` — EN "Winner", DA "Vinder" (+ aria-label).
- Eksisterende `detail.classification.team` genbruges som titel.

### Tests
- `raceResultEntity.test.js` (frontend `node --test`): team-række → holdnavn+holdlink;
  rytter-række → rytternavn+rytterlink; manglende `team`/`name` → graceful fallback ("—"), aldrig
  crash.

## Del 2 — #1311: tekst-recaps fra sim-data

**Mål:** en kort, skabelon-baseret fortælling pr. kørt etape/løb der gør resultatet levende —
deriveret af eksisterende `race_results`, ingen opdigtet indhold, degraderer pænt ved tynde data.

### Arkitektur (frontend, deriveret af persisterede data)

1. **Rent modul** `frontend/src/lib/raceRecap.js`:
   `buildRaceRecap({ results, race, profiles, scope })` → `RecapMoment[]`, hvor
   `scope = { type: 'stage', stageNumber } | { type: 'overall' }`.
   Returnerer **strukturerede momenter** `{ key, params }` (i18n-nøgle + interpolations-params) —
   IKKE færdige strenge, så al oversættelse bliver i komponenten via `t()`. Maks 4-6 momenter,
   prioriteret rækkefølge; tomt array hvis intet kan udledes ærligt.

2. **Momenter (kun fra persisterede felter):**
   - **Sejr/margin:** rank 1 + gap til rank 2 (`finish_time`). Stor gap (> tærskel, fx 8s) →
     `recap.soloWin`; ~0 → `recap.sprintWin`. Params: vinder-navn, margin.
   - **Udbrud:** antal `in_breakaway`-ryttere; vandt en escapee (`rank 1 && in_breakaway &&
     !breakaway_caught`) → `recap.breakawaySurvived`; blev indhentet (nogen `breakaway_caught`) →
     `recap.breakawayCaught`. Params: antal.
   - **Holdets dag:** autoritativt = vinderen af holdklassementet (rank-1 `team`-række). Som
     understøttende stat beregnes `ridersInTop10` for det hold (fra finish-orden). →
     `recap.teamDay`. Params: holdnavn, ridersInTop10. (Binder #1485 og #1311 sammen.)
   - **GC-rystelse (kun `scope.overall` på etapeløb):** GC-vinder + margin til 2. + trøje-vindere
     (points/bjerg/ungdom) → `recap.gcWinner` (+ evt. `recap.jerseys`). Params: navn, margin.
   - **Profil-kontekst (valgfri krydring):** etapens `profile_type` (fra `profiles`) til at farve
     ordlyden (bjerg vs. flad spurt) — kun hvis profil findes.

3. **Komponent** `RaceRecap` (i RaceDetailPage.jsx eller `components/race/RaceRecap.jsx`):
   renderer momenterne via `t("detail.recap.<key>", params)` i en recap-blok. Vises:
   - pr. etape i `StageTab` (scope=stage),
   - som samlet recap på kørte løb (scope=overall; på etapeløb øverst i `OverallTab`, på endagsløb
     over måltavlen).
   Degraderer pænt: 0 momenter → ingen blok (ingen tom/falsk UI).

### i18n (`detail.recap.*`, EN + DA — skabeloner, ingen opdigtet indhold)
- `recap.title` ("Race recap" / "Løbsreferat")
- `recap.soloWin` ("{rider} took a solo win by {margin}." / "{rider} vandt solo med {margin}.")
- `recap.sprintWin`, `recap.breakawaySurvived`, `recap.breakawayCaught`, `recap.teamDay`,
  `recap.gcWinner`, `recap.jerseys` — alle med EN-først + DA. Ingen em-dash, ingen invented content.

### Tests
- `raceRecap.test.js` (frontend `node --test`): fixtures af `race_results`-rækker →
  forventede `{key, params}`-momenter for (a) endagsløb-solosejr, (b) spurt-finale,
  (c) udbrud-overlevede vs. indhentet, (d) etapeløb-overall med GC+trøjer, (e) tynde/PCM-data →
  faldgrube-fri (færre eller ingen momenter, aldrig falske påstande).

## Leverance pr. PR

**PR A (#1485):** query-join + `raceResultEntity.js` (+test) + `ResultTable`/vinder-fremhævning +
i18n `detail.team.winner` (en/da). Patch notes + help.json (eller begrundelse). Verificér mod
mandagens kørte løb at holdvinderen vises.

**PR B (#1311):** `raceRecap.js` (+test) + `RaceRecap`-komponent + montering i StageTab/Overall +
i18n `detail.recap.*` (en/da). Patch notes + help.json (eller begrundelse).

## Ikke-mål (YAGNI)
- Ingen persisteret holds-tid/finish_time (ville kræve motor-ændring) — holdklassement viser rank +
  navn + evt. point.
- Ingen ny event-arkitektur i motoren (attack/sprint-timing) — recaps udleder af finish-data.
- Ingen spredte-race-tider-arbejde (allerede live).
- Ingen sæson-lang holdkonkurrence-ændring (`season_standings` + `StandingsPage` findes allerede).

## Risiko / verifikation
- Lav risiko: præsentation oven på eksisterende data, ingen migration, motor urørt → "live for alle".
- Pre-flight pr. PR: frontend build + warning-budget + i18n-keys + frontend `node --test` +
  `core-smoke.spec.js` (alle 3 playwright-projekter ved visuelle ændringer). `verify-local.ps1`.
- Empirisk verifikation: `race_results` er tom nu (kalender-rebuild) → endelig UI-verifikation sker
  mod mandagens (29/6) kørte løb. Indtil da verificeres via enheds-tests + Playwright-mock/seed.
