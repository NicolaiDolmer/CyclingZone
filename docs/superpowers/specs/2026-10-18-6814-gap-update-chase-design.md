# #6814 Design: jagtafstand på `gap_update` (kun `s5_profiles_v2`)

Status (opdateret 26/10): bygget og merget i PR #7151 (jagtafstand på `gap_update`; kodenavn i `segmentLoop.ts`, test `gapUpdatePursuit6814.test.ts`) og aktiv under `s5_profiles_v3` (aktuel 26/10). Designet herunder nævner `s5_profiles_v2` og "ingen motorkode"; det var status 18/10. Refs #6814 #6803 #6809 #5954 #6748.
AGENTS 36 (design + målt baseline før 1. motor-PR) og 17 (ingen balance-tal: tærskler nævnes kun ved navn).

## 1. Problem (bekræftet)

Løbsfilmens gab-kurve (`frontend/src/lib/stageTimelineFilm.js` `buildFilmTimeline`) tegner for v4-tidslinjer kun punkter fra et `gap_update` hvor
`group_id === breakaway_formed.group_id` OG `chase_group_id` (streng) OG `separation_seconds` (endeligt, >= 0) findes (#5954-reglen, bevidst konservativ).

Motoren (`backend/lib/engine/v4/segmentLoop.ts`, gap-loopet efter merge-trinnet) udsender kun `{ group_id, gap_seconds }`, og springer enhver gruppe med `gap_seconds === 0` over. Et udbrud der fører, ER fronten (gap 0), så det får aldrig et `gap_update`. Begge betingelser fejler altså.

Målt (read-only probe, Giro-baseline `backend/scripts/baselines/giro-field-6088-2026-10-02.json`, 17 etaper, seedTag `gate1`), samme billede på `official_times_v5`, `s5_profiles_v1` og `s5_profiles_v2`:

| | i dag |
|---|---|
| etaper med udbrud | 15 |
| `gap_update` i alt | 915 |
| heraf på udbruddets id | 11 (kun når udbruddet IKKE førte) |
| heraf med `chase_group_id` | 0 |
| segmenter hvor udbruddet førte (gap 0) | 128 |
| filmens kurve-punkter, alle etaper | 0 |

S5 flad etape 2 (nyt udbrud): 2 `gap_update` i alt, ingen med jagtafstand (samme fund som #6814).

## 2. Felter

Ét nyt sæt params på det eksisterende `gap_update`, kun for et udbrud:

```
gap_update { group_id, gap_seconds, chase_group_id, separation_seconds }
```

- `group_id`: udbrudsgruppen. "Udbrud" = samme prædikat som `neutralizeBreakawayTempoDrift`: `kind === "breakaway" && origin === "breakaway"`. Efter en sammenlægning med ikke-udbrydere giver `mergedOrigin` den anden parts oprindelse, så et felt der har overtaget `breakaway-0`'s id (#6369-sagen) får aldrig jagtfelter.
- `gap_seconds`: uændret betydning (afstand til fronten, ofte 0). `raceStory.js` (lederlinjen `exact_time - gap_seconds`), `stageSplitTimes.ts` og `stageTimelineKmSpan.ts` læser fortsat præcis det.
- `chase_group_id`: `findChaseGroup(mergedGroups, escape)` (mechanics/chaseGroup.ts). Samme funktion som M5 bruger til `breakaway_caught.chase_group_id`, så kurven og indhentningen peger på samme jagtgruppe.
- `separation_seconds`: `round2(chase.gap_seconds - escape.gap_seconds)`. `findChaseGroup` filtrerer `gap_seconds >= target.gap_seconds`, så værdien er altid >= 0 (filmens krav).

Ingen nye event-typer, ingen nye tidslinjeversioner, ingen ændring i tid/grupper/RNG: kun tidslinje-events.

## 3. Hvornår udsendes de

I gap-loopet i `segmentLoop.ts` (efter `group_merged`-kvitteringerne, samme `segment.to_km`), kun når `isS5ProfilesV2OrLater(rulesRevision)`:

1. For hver gruppe i `mergedGroups` der er et udbrud: find jagtgruppen. Ingen jagtgruppe → intet jagt-event (og den almindelige regel gælder som i dag).
2. Udsend `gap_update` med jagtfelter når (a) der ikke er meldt jagtafstand for gruppen før, ELLER (b) `chase_group_id` har skiftet, ELLER (c) `|separation - sidst meldte| >= tuning.groups.gapUpdateThresholdSeconds` (samme tærskel som i dag, intet nyt tal).
3. Det gælder også når udbruddet fører (gap 0): her ophæves `gap_seconds === 0`-springet KUN for udbrud under v2.
4. Når udbruddet udsender et jagt-event på et segment, erstatter det gruppens almindelige `gap_update` på samme km (ét event pr. gruppe pr. km, aldrig to).
5. Separat kort `lastEmittedSeparation` (Map pr. gruppe-id: `{ sep, chaseId }`), ryddes ved `group_merged` for den opslugte gruppe, præcis som `lastEmittedGap`.

`exactPlace.annotateExactPlaces` stempler fortsat `exact_km`/`exact_time` på eventet (uændret, gælder alle events i segmentet).

## 4. Nye udbrud (`separate_formation`)

- Et nyt udbrud (#6369/#6748, `breakaway_formed { reformation: true, separate_formation: true }` under v2) har sit eget gruppe-id. Det er et udbrud efter prædikatet i §2 og får sine egne jagt-events fra første segment, uden at arve det hentede udbruds `lastEmittedSeparation` (nyt id = ny nøgle).
- Det hentede udbrud forsvinder via `group_merged`, og nøglen ryddes; der udsendes intet jagt-event efter indhentningen.
- Filmen på main læser kun første formations id. #6809 (åben PR) udvider til det nye udbruds id med samme eksplicitte regel; de to ændringer er uafhængige og hver for sig sikre (uden #6809: kun morgen-kurven; uden #6814: ingen kurve).
- Findes der to udbrud samtidig (kun teoretisk, reformation sker efter indhentning): hvert sit jagt-event, hver sin `findChaseGroup`, som ekskluderer `kind === "breakaway"` og dermed aldrig peger et udbrud på et andet.

## 5. Revisions-gate

- Kun `s5_profiles_v2` (og senere, via `isS5ProfilesV2OrLater`). `s5_profiles_v2` er i dag slukket og = `s5_profiles_v1` i motoren (probe: identiske event-tal på de to).
- Alle ældre revisioner (legacy, orders_gc_*, official_times_*, s5_profiles_v1) går den nuværende gren urørt: byte-identisk tidslinje.
- Tidskørsler: ingen udbrud → ingen ændring; `teamTimeTrial.ts` har sit eget `gap_update` og røres ikke.

## 6. Testporte (alle i 1. PR)

1. **v1-identitet**: digest af `simulateStageV4`-output (resultater + hele tidslinjen + snapshots) på Giro-baselinen for `official_times_v5` og `s5_profiles_v1` er uændret før/efter (mønster: `oldRevisionDigests6199.test.ts`).
2. **v2 kun tidslinje**: på `s5_profiles_v2` er resultater, tider, `group_snapshots` og alle ikke-`gap_update`-events identiske med v1; kun `gap_update` adskiller sig.
3. **Film-kontrakt**: kør `buildFilmTimeline` (frontend/src/lib/stageTimelineFilm.js) på en rigtig v2-tidslinje med udbrud: `gapCurve` er ikke tom, alle punkter har `gapSeconds >= 0`, sidste punkt er 0 ved `catchKm` når udbruddet hentes. Kontrakt-test i frontend-suiten mod en lille fikseret motor-tidslinje (genereret fra motoren, ikke håndskrevet).
4. **Jagt-konsistens**: på samme km som `breakaway_caught` er `gap_update.chase_group_id` = `breakaway_caught.chase_group_id`.
5. **Genbrugt id** (#6369 test 2-scenariet): et felt der har overtaget `breakaway-0` får ingen jagtfelter.
6. **Nyt udbrud**: på en S5-etape med reformation får det nye udbruds id egne jagt-events; det hentede udbrud har ingen efter sin indhentning.
7. **Downstream**: `raceStory.js` (lederlinje, checkpoints, `race_stage_moments`), `stageSplitTimes.ts` og `stageTimelineKmSpan.ts`-ankre giver samme output på v2-tidslinjen med og uden de nye events (eller dokumenteret, ønsket forskel).

## 7. Tidslinjens størrelse (målt, offline simulering af reglen i §3 på de faktiske gruppe-snapshots, `s5_profiles_v2`, Giro 17 etaper)

| | i dag | med design |
|---|---|---|
| events i alt | 1982 | +79 (+4,0 %) |
| tidslinje-bytes (JSON) | ca. 372 KB | +ca. 11 KB (+3,0 %) |
| nye km-ankre (km uden et eksisterende `gap_update`) | | 0 |
| filmens kurve-punkter | 0 | 88 |

Nul nye km-ankre: når udbruddet fører, er jagtgruppens egen gap til fronten = separationen, så jagtgruppens eksisterende `gap_update` udsendes på de samme km. `stageTimelineKmSpan` (ærlige km-spænd) og `raceStory`-checkpoints får derfor ingen nye tjekpunkter i målingen. Testport 7 holder det.

## 8. Risiko

- Lav for spillet: ingen tider, grupper eller resultater ændres; kun tidslinje-events under en slukket revision.
- Mellem for læsere af `gap_update`: `raceStory.js` beskriver i dag `gap_update` som "pr. gruppe BAG fronten". Et udbrud på gap 0 bryder den beskrivelse (ikke logikken: lederlinjen bliver `exact_time - 0`). Kommentaren opdateres i samme PR; testport 7 er porten.
- Ingen ny tærskel eller konstant (AGENTS 17).

## 9. Byg-plan (efter ejer-go)

1. `segmentLoop.ts`: v2-gren i gap-loopet (§3), `lastEmittedSeparation`, ryd ved merge. Ingen ændring i `chaseGroup.ts`.
2. Tests: porte 1-7 (backend `engine/v4/*6814*.test.ts`, frontend kontrakt-test ved `stageTimelineFilm.causalEvents.test.ts`).
3. Opdatér kommentaren i `raceStory.js` og `timeline.ts` (v4-udvidelsen af `gap_update`).
4. Ingen spillertekst, ingen patch note før `s5_profiles_v2` tændes (ejer-gated).

## Åbne review-fund (Codex 19/10), løses i bygge-PR'en før første motorændring

- **P2 Emit the catch sample before merging away the escape:** At an actual catch, `mechanics/breakaway.ts` first makes the escape and chase gaps equal, after which `segmentLoop.ts` calls `mergeGroupsDetailed` before this proposed gap loop; `groups.ts::mergedOrigin` then removes the breakaway origin when it joins a non-breakaway group. Consequently, no group in `mergedGroups` satisfies the escape predicate on the catch segment, so the design cannot emit the same-km `gap_update` required by test gate 4. Emit or synthesize the terminal pursuit sample from the pre-merge/catch state instead.
- **P2 Cite the race-engine SSOT before approving the design:** This is a new race-engine design, but its metadata cites only AGENTS rules and nowhere references `docs/RACE_ENGINE_RULES.md`. The repository contract explicitly requires every new design document to cite its area's SSOT and identifies that file as the race-engine SSOT, so this document is not approved for build until the citation and contract reconciliation are added.
- **P2 Add the required preview verification plan:** The test-gate section lists automated assertions, but it never declares the test tier or what the owner must inspect on preview/staging. Because this feature changes the player-visible race-film gap curve, the design's verification plan is incomplete and cannot serve as build approval until those explicit preview checks are documented.
