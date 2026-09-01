# Board: DNA-tradition-mål manglede cumulative-flag på en multi-year-only sti (#4377)

**Dato:** 2026-09-01 · **Issue:** #4377 · **Præcedens-klasse:** #914, #56, #3095

## Symptom

Spiller-rapport (Discord, @egomadsen 28/8): "Hvis ikke vi har fået et nyt mål,
så har min glemt at jeg fik trøjer sidste sæson for den står på 0/2." Et
5-årsplans jersey_wins-mål viste 0/2 selvom trøjerne var vundet en tidligere
sæson inden for planperioden.

## Rod-årsag

`sprint_kommerciel`-DNA'ens `tradition_goal` (`boardClubDna.js`) er
`{ type: "jersey_wins", target: 2, ... }` — uden `cumulative: true`. Målet
tilføjes KUN til 5yr-forslag (`buildBoardProposal`: `planType === "5yr" &&
dnaKey`), så det er altid multi-year. Men `evaluateGoal`/`evaluateGoalProgress`
(`boardGoals.js:810-817, 1055-1082`) grener jersey_wins-evalueringen på netop
`goal.cumulative`: uden flaget læses `seasonJerseyWins` (nulstiller hvert
sæsonskifte) i stedet for `cumulativeJerseyWins` (summerer trøjer over hele
plan-vinduet, allerede korrekt implementeret i `loadGoalContextForBoard`).
Frontend arver samme fejl: `boardGoalLabel.js`'s `isPlanPeriod`-check læser
også `goal.cumulative` for at vælge mellem "per sæson"- og "over
planperioden"-labelen.

Query-laget (`loadGoalContextForBoard`) har ALTID summeret korrekt over hele
plan-cyklussen — bekræftet med en ny test. Bugget var udelukkende i den
STATISKE mål-definition, ikke i evaluerings- eller query-mekanikken.

## Fix

`cumulative: true` sat direkte på DNA-kildedataen (ikke en patch i
`buildDnaTraditionGoal` — fejlen sad i selve dataen, patches pr. kaldested
ville gentage #2469-klassens fælde). Label + help.json-copy rettet fra
"pr. sæson" til "over planperioden" for konsistens med de øvrige kumulative
mål-labels.

## Fejlklassificering af de to andre rapporterede symptomer

- **Sponsor-vækst-målets nævner (8→12 mellem sæsoner):** IKKE samme
  rod-årsag. Det er `evaluateGoalProgress`'s allerede-dokumenterede
  pro-ratering af target (`target × seasonsCompleted/planDuration`) — en
  legitim "on pace"-visning — kombineret med det allerede kendte, ejer-gatede
  #3494 (`teams.sponsor_income` er frosset for alle hold, så vækst altid
  måler 0%). Ingen kode ændret for dette symptom under #4377.
- **Sejre S1+S2 (kun 1 af 2 tæller):** dækkes af #3948 (endagssejr
  registreres som en `gc`-række, ikke en etapesejr). Regressionstest tilføjet
  for at låse at cumulative stage_wins summerer korrekt på tværs af sæsoner,
  men ingen ny fix var nødvendig her.

## Åbent fund — IKKE rettet (ejer-beslutning krævet)

`getBoardRenegotiationLock` (#915) tillader gen-signering af en ALLEREDE
aktiv, ikke-udløbet flerårsplan tidligt i en ny sæson (lav
`race_days_completed`) — låsen kender kun sæsonens egen progress, ikke
planens (`seasons_completed` vs. `planDuration`). `/board/sign` (api.js)
nulstiller da ubetinget `seasons_completed`, `cumulative_stage_wins`,
`cumulative_gc_wins` og `plan_start_season_number` for hele planen, uanset om
den reelt er udløbet. #3575 bekræfter at UI'et eksplicit lover en "reset" ved
genforhandling — så dette kan være tilsigtet — men det modsiger #4377's
udgangsantagelse om at genforhandling kun ændrer mål, ikke historik.
Dokumenteret med en test (`boardRenegotiationLock.test.js`), ikke rettet:
ændring af reset-omfanget er en produktbeslutning med bred blast radius
(rammer signeringsflowet for alle tre plan-typer).

## Læring

- **En manglende boolean-flag på statisk DNA-data kan reproducere samme
  fejlklasse som en fan-in-context-drift** (#2469-familien), selvom
  evaluerings- og query-lagene begge var korrekte. Tjek altid DATAEN et mål
  fødes med, ikke kun motoren der evaluerer den — særligt for mål der kun
  eksisterer via én bestemt kaldevej (her: kun 5yr + én specifik DNA-nøgle).
- **"Formodet fælles rod-årsag" i en bug-rapport skal verificeres PR mål-type
  — ikke antaget.** To af de tre rapporterede symptomer i #4377 havde
  forskellige, allerede-kendte rod-årsager (#3494, #3948); kun trøje-symptomet
  var en ny fejl.
