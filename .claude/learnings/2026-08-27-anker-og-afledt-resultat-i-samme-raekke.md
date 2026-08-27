# Et anker og dets afledte resultat i samme række, hvor kun ankeret har en FK

**Dato:** 2026-08-27
**Issue:** [#4294](https://github.com/NicolaiDolmer/CyclingZone/issues/4294)
**Klasse:** datamodel. Ikke en kodefejl, ikke en regression. Fejlen lå i skemaet og
ventede på at nogen slettede en række et andet sted.

## Hvad der skete

Kalenderen for sæson 3 blev regenereret sent 26/8 (de nye løb er skrevet 26/8 kl.
23:38 CEST; skaden blev opdaget 27/8). Det slettede sæsonens `races`.

`rider_peak_plans` gemmer to ting i samme række:

| Felt | Hvad det er |
|---|---|
| `target_race_id` | **Ankeret.** FK til `races`, `ON DELETE SET NULL` |
| `window_start` / `window_end` | **Det afledte resultat.** Rene `date`-kolonner, snappet om målløbets etapedatoer af `snapPeakWindow` |

Kun ankeret havde en FK. Så da løbene forsvandt, nulstillede FK'en ankeret og lod
det afledte resultat blive stående: 812 af 894 planer pegede på ingenting, med
datoer fra en kalender der ikke fandtes mere.

Målt i prod før reparationen:

- **731** af de 812 vinduer overlappede den NYE kalender, fordelt på **490** ryttere
- **280** af de forældreløse vinduer dækkede åbningsdagen 28/8. Det er **planer**,
  ikke ryttere: distinkte ryttere med et sådant vindue var **274**, heraf **272**
  på menneskehold
- **27** menneskehold ramt på åbningsdagen, og **316** af planerne på menneskehold
  var allerede låst for spilleren
- `race_engine_v3_scoring` og `peak_planner_enabled` er begge `on` i prod

## Hvorfor ingen opdagede det

Alle tre lag tav, hver på sin måde.

1. **UI'et** viste rækken som `No peak`, fordi der ikke var noget mål at vise i
   select'en. Det ser ud som "ingen plan", ikke som "ødelagt plan".
2. **Fjern-knappen** var deaktiveret, fordi `isPlanLocked` kun ser på
   `window_start`, og 320 vinduer lå allerede på eller før dags dato. Spilleren
   kunne altså se problemet, men ikke røre det. Det blev rapporteret som
   [#4212](https://github.com/NicolaiDolmer/CyclingZone/issues/4212), som en
   selvstændig bug om at peaks ikke kan fjernes.
3. **Motoren** filtrerede aldrig på `target_race_id`. `loadPeakPlans` hentede på
   `season_id` og `rider_id`, og `peakPhaseForWindow` afgør fasen udelukkende ud
   fra `window_start`/`window_end`. Ankeret bruges kun til demand-vektoren. Et
   vindue uden mål fyrer altså præcis som et med.

`NOW.md` sagde imens "237 form-peaks bevaret" fra regenererings-sessionen. Det
rigtige tal var 812. Ingen havde talt efter.

## Lektionen

**Gemmer en række både et anker og et resultat afledt af ankeret, skal de dø
sammen.** `ON DELETE SET NULL` er kun rigtigt når resten af rækken stadig giver
mening uden ankeret. Her gjorde den ikke: vinduet ER målløbets datoer.

Fejlklassen kan søges efter. Kig efter tabeller hvor:

- et felt er en FK med `ON DELETE SET NULL`, **og**
- et andet felt i samme række er beregnet ud fra det felt FK'en peger på, **og**
- ingen skrivevej re-beregner eller rydder op når FK'en nulstilles.

I dette repo var carry-over-registret i `seasonCarryOver.js` (entry'en for
`rider_peak_plans`) allerede klar over problemet: `revalidatePeakPlans` **tæller**
forældreløse planer og lader dem ligge, med kommentaren at sletning er ejer-gated.
Tælleren var altså en detektor ingen læste. En invariant der kun tæller, men
aldrig fejler, er ikke en invariant.

Den kommentar er nu selv rettet i samme PR: efter CASCADE er sletningen IKKE
ejer-gated — databasen fjerner planen sammen med løbet. Havde vi ladet den stå,
ville rettelsen have skabt sin egen SSOT-drift: en registrering der beskrev en
gate der ikke længere findes.

## Den anden halvdel: NULL var illegitim her, men ikke i går

Dagen før lukkede vi [#4299](https://github.com/NicolaiDolmer/CyclingZone/issues/4299)
som falsk positiv, netop fordi `binding_span IS NULL` dér er en af fire grene
funktionen bevidst returnerer (blandt andet "holdet er afmeldt"). Postmortem'en
hedder `2026-08-27-udeluk-de-legitime-null-grene-foer-du-kalder-det-et-hul.md`.

Her er konklusionen den modsatte, og forskellen er bevist, ikke antaget. Alle
skriveveje til `rider_peak_plans` (`POST /peak-plans`, `POST /peak-plans/bulk`,
`PATCH /peak-plans/:id`) afviser et `target_race_id` der ikke er en ikke-tom
streng, med 400, før de rører databasen. `canCreatePeakPlan` kræver et
`targetRaceId`. Der findes ingen kodesti der med vilje gemmer en plan uden mål.

**Reglen der kom ud af det:** før du kalder en NULL-gren illegitim, så læs
skrivesiden først og list dens tomme grene. Er der ingen, er NULL en defekt. Er
der én, er den et design du er ved at brække. Begge svar er billige at få, og
begge fejl er dyre.

## Hvad vi gjorde

1. **Data** (ejer-GO 27/8): backup til `backup_4294_rider_peak_plans` (812 rækker),
   slettet scopet til backuppens egne id'er, så samtidige spiller-oprettelser ikke
   kunne rammes. Post-verify: 82 planer tilbage, alle med gyldigt målløb, 0 uden.
2. **Kilden:** `database/2026-08-27-4294-peak-plan-cascade.sql` skifter FK'en til
   `ON DELETE CASCADE`. De to øvrige FK'er på tabellen var allerede CASCADE.
3. **Fail-safe:** `loadPeakPlans` og `raceCardPeakOverlay` udelader planer uden
   målløb, så motoren er beskyttet selv hvis en fremtidig skrivevej efterlader en.
   Efter migrationen er det en vagt uden arbejde, og det er meningen.
4. **Sprængradius skrevet ned de tre steder den nu gælder.** CASCADE gør skaden
   lydløs, så den skal stå der hvor nogen trykker på knappen:
   `docs/runbooks/2026-08-27-s3-kalender-regenerering.md` (ny sektion plus et
   backup-skridt 0b før noget slettes), kommentaren over
   `DELETE /api/admin/races/:raceId` i `backend/routes/api.js` (ét slettet løb
   sletter nu hvert holds formplan for det løb), og carry-over-registret.
   En rettelse der kun står i migrationen er en rettelse ingen ser.

## Refs

#4294 · #4212 · #4299 · #4277 · #4236
