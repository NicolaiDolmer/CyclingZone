# Løbsfilm-pakken: jagtafstand, gab-kurve og film til endagsløb (design)

Status: design-udkast fra undersøgelsesspor 22/10, ingen kode. Refs #6814 #6803 #6512 #6804.
SSOT: `docs/RACE_ENGINE_RULES.md` (motor). Bygger videre på `2026-10-18-6814-gap-update-chase-design.md` (godkendt design for jagtafstanden) og lukker dens tre åbne Codex-fund.
AGENTS 36 (design + målt baseline før 1. kode-PR), AGENTS 17 (tal kun i `balance-internals/loebsfilm/2026-10-22/`).

## 1. Problem i klar tekst

1. **Kurven er tom (#6814).** Løbsfilmen tegner udbruddets forspring som en kurve. Kurven kræver at motoren siger hvem der jager udbruddet, og hvor langt efter de er. Det gør motoren ikke: den skriver kun hver gruppes afstand til fronten, og et udbrud der fører, får slet ingen afstand skrevet. Derfor er kurven tom på alle rigtige etaper.
2. **Kun første udbrud (#6803).** Filmen kan nu følge et nyt udbrud efter en tidlig indhentning (frontend-delen er på main via #6809), men der er intet at følge, fordi punkt 1 også gælder det nye udbrud.
3. **Ingen film på endagsløb (#6512).** Endagsløb gemmer en tidslinje, men siden viser den kun i opsummeringen. Filmknappen ("The story of the stage" + "Watch the race film") findes kun på etapeløbenes etapefane.

## 2. Målt baseline (kvalitativt; tal i balance-internals)

Målt read-only i prod (alle tidslinjer sidste 60 dage) 22/10:

- Ingen af v4-tidslinjernes `gap_update` har `chase_group_id`/`separation_seconds`, på tværs af alle regelrevisioner og både endagsløb og etapeløb. Filmens kurve er derfor tom på samtlige etaper med udbrud.
- Motoren har imens et gab-signal i udbrudsvinduet (mellem udbruddets dannelse og indhentning) på næsten alle de etaper. Afvigelsen mellem film og motor er altså total: motoren ved det, filmen viser intet. Størrelserne står privat i `balance-internals/loebsfilm/2026-10-22/`.
- Nye udbrud efter en indhentning forekommer kun under `s5_profiles_v1` og på en mærkbar andel af dens etaper, både endagsløb og etaper.
- Endagsløb: tidslinjen findes på alle nyere endagsløb. Det der mangler, er visningen (`RaceDetailPage.jsx` endagsgren renderer ikke `StoryOfTheStageSection`).
- Den præcise "med design"-effekt (kurvepunkter, tidslinjestørrelse) er målt offline i 18/10-designet §7 og gælder fortsat (motorkoden i gap-loopet er uændret siden).

**Byggegate for A (AGENTS 36) er IKKE opfyldt endnu.** Ovenstående er en read-only prod-måling plus 18/10-designets offline-simulering. Før første motor-PR for A skal der køres en lokal PG17-baseline (samme målinger før/efter på samme revision) og resultatet skrives privat. C og B kræver den ikke (ren visning/tests).

## 3. Løsning pr. del

### A. Jagtafstand på `gap_update` (#6814, motor)
Som 18/10-designet §2-§5: ét `gap_update { group_id, gap_seconds, chase_group_id, separation_seconds }` for udbrudsgrupper, `findChaseGroup` som jagtkilde, samme tærskel som i dag, ophæv gap-0-springet kun for udbrud, `lastEmittedSeparation` ryddet ved merge. Lukker de åbne fund:
- **Indhentnings-punktet:** udsend det sidste jagtpunkt fra tilstanden FØR `mergeGroupsDetailed` (hvor udbruddet stadig findes), samme km som `breakaway_caught`, med `chase_group_id = breakaway_caught.chase_group_id` og separation 0. Ellers kan testport 4 ikke holdes.
- **Baseline mod sig selv:** gate 2 sammenligner før/efter på samme revision (ikke mod v1), fordi v2 allerede afviger fra v1 på reformation.
- **Preview-plan:** se §6.

### B. Gab-kurven for nyt udbrud (#6803, frontend)
Ingen ny frontendkode: `buildFilmTimeline` + `findReformationCatches` læser allerede det nye udbruds id. #6803 lukkes ved at A leverer data, verificeret med en rigtig motortidslinje med reformation (testport 6).

### C. Film til endagsløb (#6512, frontend)
Endagsgrenen i `RaceDetailPage.jsx` renderer `StoryOfTheStageSection` med `oneDayTimeline` (stageNumber 1), samme komponent og props som etapefanen; T3/T2-skabelon og TASTE uændret (ingen ny markup). Uafhængig af motoren og kan bygges straks: kurven er tom indtil A tændes, men feedet, stignings-markører og indhentningsmærket virker allerede.

## 4. Rækkefølge og ejerskab

1. **C først** (frontend, ingen motor, ingen revision): ejer-preview af endagsløb med film.
2. **A** bygges i #6804's v3-pakke efter P6, så kun én session skriver i `mechanics/breakaway.ts` / `segmentLoop.ts` (koordinering 21/10). Denne lane rører ingen v3-filer.
3. **B** verificeres i samme PR som A (kun tests).

## 5. Revision/flag

- A: kun bag `isS5ProfilesV2OrLater` (eller v3, hvis pakken ender der). Ældre revisioner byte-identiske. Ingen spillertekst/patch note før revisionen tændes (ejer-gated).
- B: ingen gate (læser kun eksplicitte felter).
- C: ingen motor-gate; ren visning af eksisterende data. Patch note ved merge (brugerrettet).

## 6. Testplan

- A: testporte 1-7 fra 18/10-designet, med gate 2 ændret til før/efter samme revision og gate 4 fra pre-merge-tilstanden. Tier FULL (`scripts/verify-local.ps1`).
- B: kontrakt-test med motorgenereret tidslinje med reformation: kurve for begge udbrud, nul mellem dem.
- C: komponent-/e2e-test at endagsløbets resultatfane viser filmknappen når tidslinjen findes, og intet når den ikke gør; snapshots i alle 3 Playwright-projekter.
- **Preview (ejer):** C: et endagsløb fra prod-listen åbnes på preview, film afspilles (Android). A: en v2-genkørt etape med udbrud på preview, kurven stiger mens udbruddet kører og går til 0 ved indhentningen.

## 7. Ejer-beslutninger der mangler (én ad gangen)

1. Må C (film til endagsløb) bygges og merges nu, før motordelen, så spillerne får filmen uden kurve først? Anbefaling: ja.
2. Skal A ligge under `s5_profiles_v2` (som 18/10-designet) eller flyttes til v3-pakken sammen med #6804? Anbefaling: v3-pakken, af hensyn til én skriver i `breakaway.ts`.
