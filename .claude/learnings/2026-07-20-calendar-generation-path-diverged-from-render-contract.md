# Genererings-sti divergerede fra render-kontrakten (to materializere)

**Dato:** 2026-07-20 · **Issue:** #2449 · **PR:** #2726

## Symptom (latent — aldrig set i prod)
Under #2449 (generér S2-kalender synligt) viste kortlægningen at admin-genererings-routen,
sæson-transitionen OG relaunch alle kaldte `seasonCalendarMaterializer`, som **ikke** satte
`game_day`/`game_day_start`. `buildCalendarModel` (`raceCalendar.js:193-196`) springer et løb
over hvis BÅDE schedule-`game_day` er tom OG `races.game_day_start` er null. Så enhver frisk
generering (S2, en relaunch, en forever-transition) ville have lavet **usynlige** løb + brudt
`race_days`-beregningen. Det var aldrig blevet opdaget fordi den nuværende live S1-kalender blev
**genopbygget via et repair-script** der brugte den ANDEN materializer (`tierCalendarMaterializer`,
som sætter game_day). Den "normale" genererings-sti havde altså aldrig kørt mod en frisk sæson.

## Rod-årsag
To implementeringer af samme ansvar (materialisér en sæsons kalender). Den nyere
`tierCalendarMaterializer` (prestige-kaskade + game_day + invariant-guards) blev bygget som
repair-værktøj og aldrig wiret ind i de tre produktions-stier — de blev efterladt på den gamle.
Den live data så korrekt ud udelukkende fordi repair-stien havde overskrevet den.

## Fix
Unify: peg alle tre stier på `tierCalendarMaterializer`, slet `seasonCalendarMaterializer`, strip
`divisionCalendarGenerator` til kun `poolHasCalendar`. Netto −911 linjer. Verificeret med read-only
dry-run + ægte `buildCalendarModel`-kørsel mod prod-data (455 løb → 455 synlige entries).

## Læring (reusable)
- **To implementeringer af samme ansvar = en af dem driver stille i stykker.** Når du finder en
  duplikeret funktion, spørg: hvilken sti producerede den LIVE data? Her var svaret "en engangs-
  repair", ikke den wirede produktions-sti — så prod så sundt ud mens produktions-koden var brudt.
- **Verificér genererings-KONTRAKTEN, ikke bare at data findes.** S1 havde game_day sat; det
  beviste ikke at genererings-koden satte det (et repair-script gjorde). Tjek hvilken kode der
  faktisk skrev de felter render-laget kræver.
- **Preview og apply skal dele nøjagtig samme plan-funktion.** Preview brugte tidligere
  `generateDivisionCalendars`, apply en anden — previewet kunne lyve. Nu bygger begge
  `buildTierMaterializationPlan`.
