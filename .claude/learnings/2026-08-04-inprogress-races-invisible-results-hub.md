# Postmortem · 2026-08-04 · Igangværende etapeløb usynlige på Resultat-hubben

## Hvad skete der?
Resultat-hubbens Seneste-fane (`ResultaterPage.jsx`) hentede løb med `.eq("status", "completed")`. Et etapeløb beholder `status='scheduled'` under HELE afviklingen (kun `stages_completed` er en pålidelig "i gang"-markør), så alle kørte etaper i et igangværende etapeløb var usynlige. Verificeret i prod (Supabase MCP, read-only SELECT): 19 løb i sæson 2 ramt, heriblandt Vuelta Ibérica med 15 af 21 etaper kørt i Division 1. `CompletedRacesExplorer.jsx` (samme hub, faner nedenunder) brugte et ANDET, mere tilgivende prædikat (`r.results?.length > 0 || r.status === "completed"`) — de to flader på samme side var uenige om hvad "afsluttet" betyder. (#3333, discord-sweep-fund fra @thelamba 3-4/8.)

## Root cause
To uafhængige, aldrig-samlede definitioner af "har løbet resultater at vise" på samme hub, ingen af dem opmærksom på `deriveRaceStatus`'s "live"-tilstand (som allerede var den etablerede, testede afledning brugt af Dashboard/RaceArchiveTable/RaceDetailPage). Desuden havde podium-udregningen (`podiumFor`) kun logik for et FÆRDIGT etapeløbs `result_type='gc'`-rækker — de skrives først ved finalization, så selv med et korrekt "vis dette løb"-filter ville et igangværende etapeløb vise et tomt podie.

## Fix
- `frontend/src/lib/raceResultVisibility.js` (ny) — ÉT delt prædikat `raceHasReportableResults` + `raceIsInProgress`, begge bygget oven på den eksisterende `deriveRaceStatus` (raceHubLogic.js). Brugt i BÅDE `ResultaterPage.jsx` og `CompletedRacesExplorer.jsx`.
- `frontend/src/lib/raceResultsPodium.js` (ny, flyttet ud af `ResultaterPage.jsx` for `node --test`-dækning) — `podiumFor` falder nu tilbage til `buildLiveStandings` (raceLiveStandings.js, #2081) når et etapeløb endnu ikke har `gc`-rækker, i stedet for at vise et tomt podie for et løb der rent faktisk har resultater.
- `frontend/src/lib/raceLatestWindow.js` (ny) — `capLatestRaces` garanterer at `LATEST_LIMIT`-afskæringen (top 9) ikke kan skjule en HEL løbstype. Verificeret mod prod-data: Division 1 pulje 0 har 10 løb i det fulde "har resultater"-vindue efter fixet; en ren top-9-slice ville udelade et færdigt løb (Tour of South Australia) — capLatestRaces bytter det ind på den ældste plads.
- `ResultaterPage.jsx`: query'en henter nu `status.eq.completed OR stages_completed.gt.0` server-side (+ `stages_completed` i select), og resultat-hentningen inkluderer `result_type='leader'` (ikke kun `gc`/`stage`). RaceResultCard viser en "Live"-badge + "Etape N af M" i stedet for det statiske etape-antal.
- `CompletedRacesExplorer.jsx`: samme prædikat, badge og "Live"-metatekst i stedet for den misvisende "N results imported" for et løb der stadig kører.
- i18n: `results:latest.stageProgress` ny nøgle (EN "Stage {done} of {total}" / DA "Etape {done} af {total}"), genbruger ellers eksisterende `races:status.live`.

## Forhindret-fremover
- 3 nye lib-filer med `node --test`-dækning (raceResultVisibility, raceLatestWindow, raceResultsPodium) — pure logik der tidligere enten var duplikeret eller boede utestet i en `.jsx`-fil.
- `raceHasReportableResults` er nu den ENE kilde til sandhed — en fremtidig tredje flade der viser "afsluttede løb" skal importere den, ikke opfinde et tredje prædikat.

## Læring
"status" alene er IKKE en pålidelig fremdrifts-markør for etapeløb i dette spil — det er et gentaget mønster (#1825/#1844/#2074/#3333) at nye flader glemmer `stages_completed`. Enhver ny "hvilke løb skal vises her"-forespørgsel bør starte fra `deriveRaceStatus`/`raceHasReportableResults`, ikke fra et råt `.eq("status", ...)`-filter.
