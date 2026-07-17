# Postmortem · 2026-07-17 · Dashboard + liga-overblik loader langsomt (#2444)

## Hvad skete der?
Ejeren rapporterede at Dashboardet og Liga → Overblik/Resultater loader markant
langsommere end resten af sitet.

## Root cause
Tre uafhængige rod-årsager, alle "serial await chains" / genopfundet client-agg:

1. **`/api/board/status`** (kaldes af Dashboard via `boardStatusPromise`):
   et `for`-loop over op til 3 plan-typer (1yr/3yr/5yr) kørte `await loadGoalContextForBoard(...)`
   SEKVENTIELT pr. plan-type. Inde i `loadGoalContextForBoard` kørte yderligere
   3 uafhængige queries (klassiker-podier, trøjer, transfer-balance) også
   sekventielt. Værste tilfælde: 3 plan-typer × 3 queries = op til 9 sekventielle
   round-trips oveni de indledende 8+3. `getActiveConsequencesForTeam` +
   `isWithinFirstSeasonForTeam` kørte desuden EFTER loopet i stedet for parallelt.
2. **StandingsPage.jsx** (`Liga → Overblik`): `loadAllInner` kædede
   `getUser()` → `mine`-query → `season`-query sekventielt, selvom `mine` og
   `season` er uafhængige af hinanden. `teams`/`league_divisions`-queries (helt
   uafhængige af user/season) ventede til en 4. Promise.all i stedet for at
   starte med det samme. Matview-reads (`team_standings_ext_mv`/`team_race_points_mv`)
   ventede unødigt på hovedbolkens Promise.all selvom de kun afhænger af
   `activeSeason.id`.
3. **ResultaterPage.jsx** (`Liga → Resultater`): hentede ALLE sæsonens races +
   ALLE deres `race_results` (paginated `fetchAllRows`, potentielt titusindvis af
   rækker) og aggregerede top-5-ryttere i JS — præcis det mønster #2175/#2206
   allerede havde fjernet fra RiderRankingsPage/StandingsPage til fordel for den
   færdig-aggregerede `rider_rankings_mv`. ResultaterPage var aldrig migreret.

EXPLAIN ANALYZE mod prod bekræftede at de underliggende queries selv er hurtige
(races=423 rows, alle relevante joins indeks-dækkede, <1ms exec) — flaskehalsen
var udelukkende round-trip-antallet og payload-størrelsen, ikke manglende index.

## Fix
- `backend/lib/boardGoalContext.js`: de 3 uafhængige queries i
  `loadGoalContextForBoard` parallelliseret med `Promise.all`.
- `backend/routes/api.js` (`/board/status`): plan-loopet konverteret til
  `Promise.all(PLAN_SEQUENCE.map(...))`; `getActiveConsequencesForTeam` +
  `isWithinFirstSeasonForTeam` løftet op og kørt parallelt med plan-loopet.
- `frontend/src/pages/StandingsPage.jsx`: `mine`+`season`-queries
  parallelliseret; `teams`/`league_divisions`-queries startet før auth-kæden;
  matview-reads startet parallelt med hovedbolkens Promise.all i stedet for
  bagefter.
- `frontend/src/pages/ResultaterPage.jsx`: topRiders bruger nu
  `rider_rankings_mv` (top-5 + let display-join for 5 id'er) i stedet for
  fuld races+race_results-fetch og JS-aggregering.

## Forhindret-fremover
Del 2 af #2444 (automatisk drift-detektion pr. underside) dækker det
strukturelt — se #2096. Ingen ny test tilføjet i denne PR (ren perf-refactor,
output uændret; eksisterende test-suite + e2e core-smoke dækker regressions).

## Læring
Når en side "føles langsom" i denne kodebase, tjek FØRST for (a) `for`-loops
med `await` indeni der kunne være `Promise.all`, og (b) om en tilsvarende
matview allerede findes (`rider_rankings_mv`, `team_standings_ext_mv`,
`team_race_points_mv`) før man antager manglende index er problemet — EXPLAIN
ANALYZE her viste at alle queries i sig selv var <1ms; problemet var altid
antallet af sekventielle round-trips eller en glemt migrering til en
matview der allerede løste præcis samme problem et andet sted.
