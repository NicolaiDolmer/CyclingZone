# Kalender: prestige-rang + etape-spredning + klikbar etape-visning

> Spec · 2026-06-27 · ejer-godkendte beslutninger fra brainstorming-session.
> Afløser kalender-formen fra [#1945](https://github.com/NicolaiDolmer/CyclingZone/pull/1945).
> SSOT for løbsdage-aftalen (var ikke nedskrevet før denne spec).

## Mål

To leverancer i én feature, begge live **før motor-genstart mandag 29/6 08:00**:

1. **Kalender-rebuild (prod-data):** hver division har et præcist antal løbsdage med de største løb den kan få, etaperne spredt 1/IRL-dag, og fast tæthed pr. division.
2. **UI:** kalenderen viser hver etape på sin dag med tidspunkt, og løbsnavne er klikbare ind til planlægningssiden.

## Ejer-låste beslutninger

| Beslutning | Værdi |
|---|---|
| Løbsdage pr. pulje | Div 1 = **140**, Div 2 = **112**, Div 3 = **84**, Div 4 = **56** (præcist) |
| Tæthed (game-days/IRL-dag) | 5 / 4 / 3 / 2 → præcis **28 IRL-dage** for alle |
| Udvælgelse | **Prestige-rang**: Grand Tour → Monument → World Tour (A/B/C) → ProSeries → Class 1 → Class 2 |
| Dedup | På tværs af divisioner (div 1's løb ≠ div 2's ≠ div 3's); puljer *inden for* en division deler løb |
| Spredning | **1 etape/løb/IRL-dag** (et 21-etape-løb spænder 21 dage) |
| Etape-tider | Div 1 = 11/13/15/17/19 · Div 2 = 12/14/16/18 · Div 3 = **12/15/18** · Div 4 = 12/18 |
| Monumenter | **Binding-fri**: egen in-game-dag der ikke overlapper andre løb; deler IRL-dato. Man kan altid stille de bedste |
| Div 4 | Kvote = 56 står klar, men **0 løb nu** (ingen ægte hold i tier 4) |

## Datagrundlag (verificeret mod prod 2026-06-27)

- Aktiv sæson = #1 (`00000000-0000-0000-0000-000000000001`), 28 kalenderdage 29/6–26/7.
- Katalog (`race_pool`): ~304 etape-game-days + 72 endags = **376 game-days**. 3 Grand Tours (21), 5 monumenter.
- Behov med cross-division dedup: 140 + 112 + 84 = **336** (div 4 = 0). Passer (40 til overs).
- Puljer pr. division: Div 1 = 1, Div 2 = 2 (A/B), Div 3 = 4 (A–D). Alle puljer i en division kører **samme løb-sæt** (separate resultater).
- Lineups: kun ét hold (div 3-D) har lineup på 2 løb → mister dem ved rebuild (kan sættes igen; motor ikke startet). Lav risiko.

## Arkitektur — genbrug af #1945-pipelinen

Pipelinen er rene, testbare funktioner. Tre ændres; resten genbruges.

### 1. `tierRaceSelection.js` — `selectTierRaceSet`
- **Fra** antal-løb + seed-rækkefølge **til** prestige-rang + præcis game-day-kvote.
- Prestige-rang via `race_class`-orden. Inden for samme rang: deterministisk seed for variation.
- Fyld tieren til **præcis kvote**: tag største-først til ≤ kvote, brug 1-etape-løb til at lukke det sidste gap præcist. Eksponér `quotaHit`/`shortfall` (ingen tavse caps).
- Cross-tier dedup uændret (`tierCalendarMaterializer` håndterer det, øverste tier først).

### 2. `raceCalendarPacker.js` — `packDivisionCalendar`
- `maxStagesPerRealDay = 1` (én etape/løb/IRL-dag). `game_day = real_day` bevares (binding nøgler korrekt).
- Ny parameter `densityPerDay` (5/4/3/2): pak løb så hver dag har præcis tæthed; brug endags-løb til at toppe op.
- `maxConcurrentStageRaces` hæves til tier-tæthed (op til 5 samtidige etapeløb i div 1).
- **Monument-binding-fri:** monumenter (race_class='Monuments') tildeles `game_day` fra et separat højt bånd (fx `MONUMENT_GAMEDAY_BASE = 10000 + idx`) så deres binding-window aldrig overlapper andre løb. `scheduled_at` placeres stadig på en delt IRL-dato. (Binding i `raceBinding.js` nøgler på `game_day` → uændret kode, kun data.)
- Sigt mod præcis tæthed; faktisk fordeling vises i simulering.

### 3. `raceCalendarScheduling.js` — `buildScheduleRows`
- Tider pr. division via slot-tabel (`TIER_STAGE_SLOTS`). Etaper på en dag tildeles slots i rækkefølge.
- Monumenter får et fast slot på deres delte IRL-dato.

### Read-model + UI
- `raceCalendar.js`: hver entry får `stageSchedule: [{ stage, date, time, terrain }]`.
- `CalendarPage.jsx`: gruppér **stage-events** pr. dato (ikke løb pr. startdato). Chip = `Løbsnavn · N. etape · HH:MM` (endags: kun `HH:MM`), sorteret efter tid, `<Link to={/races/${id}?stage=${n}}>`. Terræn-ikon bevares. Bevar division/mine/måned-filtre.
- `RaceDetailPage` understøtter allerede `?stage=N`.

## Proces (destruktiv prod-op — memory-regler)

1. **Backup** `race_stage_schedule` + `races` (+ `race_stage_profiles`, `race_entries`) → `backup_calrebuild_20260627_*`.
2. **Byg + TDD** alle rene funktioner (`node --test`).
3. **Simulér** mod ægte katalog/puljer (dryRun) → vis ejeren: løbsdage/division (præcis?), tæthed/dag-fordeling, overlap, monument-placering, eksempel-uge. **Ejer godkender simuleringen** før apply (owner-reviews-live-regel).
4. **Apply** rebuild i prod (slet sæson-1-løb + re-materialisér via `materializeTierCalendars`). Verificér prod = simulering.
5. **UI** bygges + verificeres (build, node --test, playwright alle 3 projekter), PR.
6. Patch notes + help.json (en+da) + FEATURE_STATUS + NOW.md.

## Verifikation

- Pr. division: `sum(stage_events) = kvote` præcist; tæthed/dag matcher mål; ingen tomme dage i de 28.
- Monumenter: binding-window overlapper intet andet løb (query).
- UI: etaper vises på rette dage med rette tider; navne klikker ind til `/races/:id?stage=N`; alle 3 playwright-projekter grønne.
- Motor-genstart 29/6 08:00 kører rent på den nye kalender.

## Eksplicit ikke i scope
- Op/nedrykning (#1152). Ændring af race-runner/scheduler-cron. Div 4-løb (ingen hold).
