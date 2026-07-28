# Kalenderen brændte 8 sekunder på et kald der aldrig kunne lykkes (#2861)

**Dato:** 2026-07-25 · **Issue:** [#2861](https://github.com/NicolaiDolmer/CyclingZone/issues/2861) · **Klasse:** slugt fejl + URL-overflow

## Symptom

Ejeren: "Kalender siden inde på hjemmesiden, loader markant for langsomt."
Ingen fejl i Sentry. Ingen 500'er. Siden virkede — den var bare langsom.

## Rod-årsag

`GET /api/races/calendar` sluttede af med:

```js
const { data: entries } = await supabase
  .from("race_entries").select("race_id, race_role")
  .eq("team_id", req.team.id)
  .in("race_id", raceIds);          // ← hele sæsonens løb
```

`raceIds` er HELE sæsonens løb: 423 i S1, 455 i S2. 455 × 36-tegns UUID giver en
query-streng på ~15,6 kB. PostgREST-kanten afviser en GET-URL i den størrelse, og
undici svarer med `TypeError: fetch failed` — **efter ~7,9 sekunder**.

Målt tærskel mod prod (read-only probe):

| id'er i `.in()` | query-streng | resultat |
|---|---|---|
| 300 | 11,1 kB | 102 ms, 258 rækker |
| 380 | 14,1 kB | 111 ms, 102 rækker |
| **400** | **14,9 kB** | **7844 ms, fetch failed** |
| 423 (S1) | 15,7 kB | 7785 ms, fetch failed |

To fejl ganget sammen:

1. **Ingen error-check.** Destruktureringen tog kun `data` — aldrig `error`. Fejlen
   nåede derfor hverken en `throw`, en 500 eller Sentry. `entries` blev `undefined`,
   `teamEntryRaceIds`/`teamLeaderRaceIds` blev tomme, og `entered`/`leaderSet` var
   tavst `false` for alle hold. Ingen så det, fordi kalenderen ikke renderer de to felter.
2. **Ingen chunking.** Nabo-helperne `fetchAllScheduleRowsWithGameDay` og
   `fetchAllStageProfiles` chunker id-lister i 300 ad gangen præcis for at undgå det her.
   `race_entries`-kaldet var det eneste der ikke gjorde.

Det er samme klasse som **#2516** (Sentry CYCLINGZONE-33), hvor `loadManualRegisteredRaceIds`
sprængte GET-URL'en på samme måde. Fixet dengang blev lavet lokalt i den ene funktion —
ikke som et bredt sweep — så kalenderen bar bugget videre.

Bugget var også **tidsindstillet**: det opstod da sæsonen voksede forbi ~390 løb. Med
færre løb var URL'en under grænsen og kaldet returnerede på ~100 ms.

## Fix

Sæson-scopet inner-join i stedet for en id-liste — filteret er sæsonen, ikke 455 UUID'er:

```js
.select("race_id, race_role, races!inner()")
.eq("team_id", teamId)
.eq("races.season_id", seasonId)
```

3,3 ms i Postgres, 57-136 ms over PostgREST. Plus: `if (error) throw`, range-pagination
og eksplicit `ORDER BY` (et holds entries er ryttere × løb og nærmer sig 1000-rækkers-cappen).

Server-tid: **8626 ms → 637 ms** (S1) og **9431 ms → 396 ms** (S2). Mobil, oplevet load
til første løbs-chip: **13,0 s → 5,2 s** koldt / **9,3 s → 0,9 s** ved in-app-navigation.

## Læring

1. **En slugt `error` koster mere end den skjuler.** Havde kaldet kastet, var det landet i
   Sentry som en 500 den dag sæsonen voksede forbi grænsen — i stedet betalte hver eneste
   kalender-visning 8 sekunder i månedsvis. `const { data } = await supabase…` uden
   `error` er aldrig harmløst, heller ikke på et felt "ingen bruger".
2. **Verificér at et kald returnerer rækker, ikke bare at det ikke smider en exception.**
   `raceEntryRows: 0` i målingen var det der afslørede fejlen — ikke tiden.
3. **Når en bug-klasse rammer én gang, sweep hele klassen.** #2516 fixede ét kaldsted.
   Der findes stadig ~10 andre `.in("race_id", raceIds)`-kald i backend'en; de er i dag
   scopet til små id-sæt, men samme fælde venter når et af dem møder en fuld sæson.
4. **Mål før du gætter.** Den oplagte mistanke (og issuets egen hypotese) var payload-størrelse
   og klient-rendering. Payloaden var 258 kB rå — men Railway gzipper på kanten, så den
   var 20,7 kB på ledningen. 92 % af tiden lå i ét kald der slet ikke virkede.

## Forward-guard

`backend/lib/raceCalendar.routes.test.js` låser at kalenderen aldrig igen sender hele
sæsonens id-liste i en `.in()`, at entry-loadet kaster ved fejl, at det er pagineret med
stabil sortering, og at de tre uafhængige query-bølger kører parallelt.
