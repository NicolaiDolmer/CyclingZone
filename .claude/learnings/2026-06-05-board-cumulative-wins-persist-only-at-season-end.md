# Postmortem · 2026-06-05 · Board cumulative wins viste 0 midt i sæsonen

## Hvad skete der?
På 3-/5-årsplanen viste de samlede etapesejr- og GC-sejr-delmål 0 midt i sæsonen, selv når holdet allerede havde vundet etaper. Fremgangen mod de langsigtede mål "stod stille" indtil sæsonen sluttede. (#979)

## Root cause
`GET /board/status` (`backend/routes/api.js`) returnerede `cumulative_stats.{stage_wins,gc_wins}` direkte fra `board.cumulative_stage_wins`/`board.cumulative_gc_wins`. De felter persisteres **kun ved season-end** i `economyEngine.processTeamSeasonEnd` (`newCumulativeStageWins = board.cumulative_* + teamStanding.*`, ~L876 → update ~L1039). Midt i sæsonen er de derfor lig forrige sæsons total, uden den igangværende sæsons sejre.

Det forræderiske: det **samme endpoint** lagde allerede `currentStanding` oveni for outlook-evalueringens `cumulativeStats` (`(board.cumulative_* || 0) + (currentStanding?.* || 0)`). Display-blokken og evaluerings-blokken var altså to separate udtryk for "det samme tal" — og de var driftet fra hinanden. Evalueringen var korrekt; det viste tal var ikke.

## Fix
Beregn værdien én gang og genbrug den begge steder, så de ikke kan drifte:
```js
const cumulativeStageWins = (board.cumulative_stage_wins || 0) + (currentStanding?.stage_wins || 0);
const cumulativeGcWins = (board.cumulative_gc_wins || 0) + (currentStanding?.gc_wins || 0);
```
Brugt i både `outlook`-context (`cumulativeStats: { stageWins, gcWins }`) og det returnerede `cumulative_stats: { stage_wins, gc_wins }`. Ingen dobbelttælling: `board.cumulative_*` = afsluttede sæsoner, `currentStanding.*` = kun indeværende sæson (resettes/ny række ved season-transition). `backend/routes/api.js` board/status-handler. Distinkt fra #914 (fejldiagnose — standings var korrekt populeret; problemet var aggregeringen i endpointet).

## Forhindret-fremover
- Source-level regression-test `backend/lib/boardStatusCumulativeStats.test.js` (4 cases): asserterer den delte beregning + at display og outlook bruger samme variabler + forward-guard mod regression til bart `board.cumulative_*` i display-blokken.
- Strukturelt: ét fælles udtryk i stedet for to kopier fjerner muligheden for drift ved roden.

## Læring
Når "det samme tal" beregnes to steder i samme funktion, er drift et spørgsmål om tid — især når det ene udtryk er en delmængde af det andet (her: display = evaluering minus `currentStanding`-leddet). Beregn én gang, genbrug. Og: en aggregering der kun persisteres ved en periodisk batch-grænse (season-end, cron, månedsskifte) skal næsten altid suppleres med "in-progress siden sidste persist" når den vises live — ellers står live-UI'et stille mellem batch-kørsler. Samme mønster gælder andre season-end-akkumulerede felter.
