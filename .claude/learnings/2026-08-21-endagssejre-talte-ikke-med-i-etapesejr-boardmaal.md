# Postmortem · 2026-08-21 · Endagssejre talte ikke med i "etapesejre"-bestyrelsesmålet

## Hvad skete der?
Spiller-rapport i forummet (20/8): en spiller havde vundet to endagsløb, men
bestyrelsens "1 stage win"-mål stod stadig som ikke opfyldt. En anden spiller
bekræftede at det havde været nævnt siden S1. Ejeren svarede "Yes. This can
absolutely be changed" (#4034).

## Root cause
Endagsløb (`races.race_type = "single"`) skriver deres vinder som en
`race_results`-række med `result_type = "gc"` (samme model som en etapeløbs
SAMLEDE klassement) — der findes ingen separat "one-day win"-`result_type`.
Bestyrelses-evaluatoren for `stage_wins`-målet (`boardGoals.js`) læste kun
`standing.stage_wins` / `cumulativeStats.stageWins`, som udelukkende tælles op
fra `result_type = "stage"`-rækker (etaper i et etapeløb). En endagssejr endte
derfor i `gc_wins`-tallet i stedet, og `stage_wins`-målet kunne aldrig nås af
et endagsløbs-tungt hold — uanset hvor mange løb de vandt.

Rytter-siden (`frontend/src/lib/riderPalmares.js`) havde allerede løst præcis
samme tvetydighed korrekt for individuelle ryttere (`gcWins` vs. `oneDayWins`,
begge afledt af `result_type='gc'` + `race_type`) — men bestyrelses-motoren
genbrugte aldrig det mønster.

## Fix
`backend/lib/boardGoalContext.js` (`loadGoalContextForBoard`): ny query der
tæller `race_results` med `result_type='gc'`, `rank=1`, `races.race_type='single'`
separat, split i `seasonOneDayWins` (indeværende sæson) og
`cumulativeOneDayWins` (hele planperioden). `buildBoardEvalContext` lægger
`cumulativeOneDayWins` oveni `cumulativeStats.stageWins` (kumulative
multi-year-mål). `backend/lib/boardGoals.js` (`evaluateGoal` +
`evaluateGoalProgress`) lægger `seasonOneDayWins` oveni `standing.stage_wins`
for den ikke-kumulative variant.

Bevidst IKKE ændret: `season_standings.stage_wins`/`gc_wins` (den
Postgres-RPC'ede standings-aggregering, `recompute_season_standings`) — den
bruges bredt til literal team-statistik (StandingsPage, TeamProfilePage,
HallOfFamePage, TeamPalmaresTab m.fl.), hvor "etapesejre" fortsat SKAL betyde
etaper i et etapeløb. Fixet er scopet til bestyrelses-mål-evaluatoren via en
live query (samme mønster som eksisterende monument/klassiker/trøje-optælling
i `loadGoalContextForBoard`), ikke en ombygning af den delte stats-kilde.

Copy: `goal.stageWins`/`goal.stageWinsPlanPeriod`/`cumulative.stageWins`/
`goalType.stage_wins` i `frontend/public/locales/{en,da}/board.json` omdøbt
fra "stage win(s)"/"etapesejr(e)" til "race win(s)"/"sejr(e)", så teksten
matcher at målet nu dækker begge sejrs-typer. `help.json`
(`raceClassificationsFaq`, EN+DA) fik en tilføjet sætning om undtagelsen.

## Forhindret-fremover
Nye backend/frontend-tests dækker eksplicit: query-filtrering
(`boardGoalContext.test.js`), sæson- vs. kumulativ-split, og
evaluateGoal/evaluateGoalProgress-additionen (`boardGoalTypes.test.js`).

## Læring
Når et resultat-felt kun har ÉN `result_type`-værdi til at repræsentere to
semantisk forskellige begivenheder (endagssejr vs. etapeløbs-GC), skal enhver
NY forbruger af feltet (her: bestyrelses-mål) eksplicit slå `race_type` op —
ellers arver den samme conflation stille og roligt. Søg efter eksisterende
præcedens (riderPalmares.js havde allerede løst det) før man antager at et
simpelt `result_type='gc'`-filter er nok.
