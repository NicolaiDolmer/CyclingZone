# En række pr. sæson læste som "ingen række" — og låste et sweep fast hver nat

**Dato:** 31/8-2026 · **Issue:** [#4484](https://github.com/NicolaiDolmer/CyclingZone/issues/4484) · **Fundet af:** daglig Sentry/Railway-triage · **Sentry:** CYCLINGZONE-53

## Hvad skete der

Graduerings-sweepet fejlede 23 gange i træk på én nat — hele 22-24-vinduet, hver 5. minut, altid `resolved: 0, failed: 1`. Én rytter havde været i akademiet over to sæsoner på samme hold. `academy_graduation` er `UNIQUE (rider_id, season_id)`, så han havde to rækker: S2 `sold`, S3 `pending`.

Opslaget scopede kun på hold og rytter:

```js
.eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();
```

To rækker matchede. PostgREST svarer da med PGRST116 **og** `data: null`. Koden destrukturerede kun `data`, så fejlen forsvandt, og `null` blev læst som "der findes ingen række" → `throw "not_pending"`. Evigt, hver nat.

## Læringen

**En `maybeSingle()` uden fuldt unikhedsscope er ikke et opslag — det er en antagelse om kardinalitet.** Tabellen sagde `UNIQUE (rider_id, season_id)`; koden filtrerede på `(team_id, rider_id)`. Den ene kolonne der adskiller rækkerne — `season_id` — stod ikke i filteret nogen af de fire steder mønstret fandtes.

Og fordi `maybeSingle()` melder "for mange rækker" gennem `error` mens `data` samtidig bliver `null`, ligner et kardinalitetsbrud **præcis** et tomt resultat for enhver kalder der ikke destrukturerer `error`. Tre af de fire steder var best-effort og sprang derfor bare stille over.

**Regel:** når du skriver `.maybeSingle()`, så hold filteret op mod tabellens faktiske UNIQUE-constraint. Matcher de ikke, er der en dag hvor de ikke matcher. Og destrukturér altid `error` — også hvor du har tænkt dig at ignorere den, så du ignorerer den bevidst.

## Hvorfor testene ikke fangede det

Mock-supabasen returnerede `cfg.gradRow` **uanset filtre**. En mock der ignorerer filtre kan pr. konstruktion ikke fange en scope-fejl — den beviser kun logikken oven på et objekt ingen rute nogensinde bygger. Nøjagtig samme mekanisme som #3620, hvor mocken ignorerede kolonne-listen og lod en regressionstest stå grøn i et år.

Mocken modellerer nu PostgREST' faktiske adfærd: matcher filtrene mere end én række, får kalderen fejl + `data: null`. Med den mock er de tre nye tests røde uden fixet.

## Forward-guard

Sentry-kortet bar kun tallet `failed: 1`. At finde den fastlåste rytter krævede en DB-udgravning. `runAcademyGraduationSweep` returnerer nu `errors[]` (spejler `starterSquadHealSweep.js`), og `cron.js` sender dem med i capturen — næste gang står årsagen på kortet.

## Beslægtet

- `.claude/learnings/` — #3620-mønstret (mock der ignorerer SELECT-kolonner)
- #2793 / #2881 / #4004 — tidligere fund i samme graduerings-flow
