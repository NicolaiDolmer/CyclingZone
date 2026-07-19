# Postmortem · 2026-07-19 · Ny "usøgbar rytter i rapport"-klasse: AI-holds ryttere

## Hvad skete der?
Opfølgning på #2644 (`.claude/learnings/2026-07-18-scouting-report-visibility-view-time-guard.md`):
den fix ekskluderede offered-akademi-intake og pending-transfer-ryttere fra
spejder-rapporter i to lag (generering + visning). #2581 blev genåbnet 19/7
fordi en TREDJE klasse af samme symptom ("rapporten peger på en rytter jeg
ikke kan finde") slap igennem: ryttere ejet af et AI-hold.

## Root cause
`RidersPage` skjuler AI-ejede ryttere for spillere som default
(`frontend/src/lib/useRiderFilters.js:191-193` — `.eq('owner_is_ai', false)`
medmindre `show_ai`-filteret er slået til), men INGEN af de to spejder-lag
kendte til `owner_is_ai`:
- `backend/lib/scoutSweep.js` `defaultLoadCandidates` filtrerede
  `other_teams`-poolen kun på `team_id IS NOT NULL` — ikke `owner_is_ai=false`.
- `backend/lib/scoutReportVisibility.js` `isRiderHiddenFromReport` kendte kun
  `pendingTeamId` + `hasOpenIntakeOffer` — ikke ejerens AI-status.

Samme rodfejl som #2644, bare med en anden diskriminator: en RLS/frontend-
synligheds-regel eksisterede ét sted (RidersPage-filteret) uden at spejder-
laget vidste det.

## Fix
Mirror af #2644-mønsteret for `owner_is_ai`:
1. Generering: `defaultLoadCandidates` tilføjer `.eq('owner_is_ai', false)`
   til `ridersQuery` — no-op for `free_agents` (kontraktfrie ryttere har
   altid `owner_is_ai=false`), strips AI-holds ryttere fra `other_teams`-poolen.
2. Visning: `isRiderHiddenFromReport({ ...ownerIsAi })` returnerer `true` hvis
   `ownerIsAi === true`; `hydrateCompletedVisibility` henter nu `owner_is_ai`
   i sin `riders`-select og sender den med. Strips allerede-genererede
   shortlists ved servering, ingen data-migration nødvendig
   (`owner_is_ai` er `boolean NOT NULL DEFAULT false`, trigger-vedligeholdt).

## Forhindret-fremover
`isRiderHiddenFromReport` er nu det ENE sted der definerer "kan spejder-
rapporten pege på denne rytter" — tre diskriminatorer (`pending_team_id`,
`hasOpenIntakeOffer`, `owner_is_ai`), alle spejlet fra RidersPage/RLS'ens
egne synligheds-regler. Næste gang RidersPage får et nyt default-filter der
skjuler en rytter-klasse for spillere, er tjeklisten: (1) tilføj samme filter
til `scoutSweep.js`s `defaultLoadCandidates`, (2) udvid
`isRiderHiddenFromReport`s parametre + `hydrateCompletedVisibility`s
`riders`-select. To-lags-mønsteret (generering + visning) selv behøver ikke
ændres — kun diskriminator-listen vokser.

## Læring
"Match UI'ets filter i kapacitets-/synligheds-logik" (allerede en HOT-memory-
regel, `feedback_match_ui_filter_for_capacity_logic.md`) gælder også baglæns:
når UI'et TILFØJER et nyt default-skjul-filter (her: `show_ai`-toggle), er
det ikke nok at opdatere UI'ets egen query — enhver anden kode-sti der
genererer eller viser referencer til de samme rækker (her: spejder-rapporter)
skal opdateres i samme ombæring, ellers opstår klassen "server-side data
findes, men UI'et der skulle vise den har allerede filtreret den væk" igen,
med en ny diskriminator hver gang.
