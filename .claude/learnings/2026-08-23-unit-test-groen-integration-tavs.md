# Unit-testen var grøn, integrationen var tavs

**Dato:** 2026-08-23 · **Issue:** #4104 · **Fejlklasse:** gentagelse af #3620

## Hvad skete der

Monumenter skulle have et klasse-båret distancebånd (250-290 km i stedet for terrænets 150-210). Fixet blev bygget, 207 tests var grønne, PR'en var grøn, preflight var grøn. Anvendt i prod kom monumenterne ud **uændrede** på 155-190 km.

## Rod-årsag

`tierCalendarMaterializer.js` inserter races og læser dem tilbage:

```js
.select("id, pool_race_id, name, race_type, stages")
```

`race_class` er ikke med. `seedRace` byggede videre på den række, så feltet var `undefined`, og guarden i `attachRoute`

```js
const classBand = !isStageRace && race?.race_class ? CLASS_DISTANCE_BANDS[race.race_class] : null;
```

faldt tilbage til terræn-båndet **uden at sige noget**. Præcis #3620: *"kolonnen blev ikke selectet" forvekslet med "kolonnen er NULL"*.

## Hvorfor testene ikke fangede det

Verifikationen kaldte `generateRaceStageProfiles` med et **håndbygget** objekt hvor `race_class` var sat. Den beviste at generatoren virker, når den får feltet. Ingen test gik gennem den sti der faktisk skriver til databasen, og det var netop dér feltet forsvandt.

Det er et lag-krydsende fix testet på én side af laget.

## Fix

1. `race_class` slås op i **kataloget**, ikke i den indsatte række — samme mønster som `external_id` og `terrain_archetype`, og immunt over for select-drift.
2. `seedRaceFor` (dæknings-verifikationen) manglede feltet helt og evaluerede derfor andre ruter end dem der blev persisteret.
3. `verifySeason3Calendar.mjs`: asserterer mod **produktionsdata** efter hver apply. Kørt som sidste trin i `season3-calendar-apply.yml`.

## Læring

Den defensive guard gjorde skaden værre. `race?.race_class ? ... : null` var skrevet for at være robust over for kaldere med delvise objekter, og resultatet blev at en manglende kolonne så ud som et gyldigt valg. Havde den kastet ved et `Monuments`-løb uden `race_class`, var fejlen fanget på første kørsel.

**Regel:** et fix der krydser et lag skal verificeres på den anden side af laget, mod ægte data. Og en fallback må ikke kunne dække over at et påkrævet felt mangler — så skal den larme i stedet.

## Bonus-fund samme nat

`regenSeason3Calendar.mjs` lagde alle 471 race-id'er i én `.in()`-klausul i sin post-verifikation. Det sprænger PostgREST-gatewayen og fejlede med `TypeError: fetch failed` **efter** at hele kalenderen var skrevet, så en vellykket apply rapporterede rødt. Repoet kendte grænsen i forvejen (`SUPABASE_IN_CHUNK_SIZE = 100`, #3030). Nu chunket.
