# Postmortem · 2026-07-23 · Et flag uden sin tilstands-ændring er en halv overgang

## Hvad skete der?

Pensionsmekanikken satte `is_retired = true` på rytteren, men ryddede aldrig `team_id`. Rytteren blev derfor hængende på holdet for evigt: usynlig for løbsudtagelse, men fuldt tællende i alt der måler trupstørrelse — én af 30 pladser optaget permanent af en rytter der aldrig kan køre igen, plus løn hver sæson. Fundet i tide: pension har aldrig fyret i prod (0 rækker med `is_retired = true` af 7.034), så første skade ville være opstået ved S1→S2 den 27/7.

## Root cause

`riderProgressionEngine.developRidersForSeason` byggede en `riderPatch` med `is_retired = true` og sendte den gennem `apply_rider_development`-RPC'en. Flaget blev sat; ejerskabet blev ikke rørt.

Det der gjorde hullet svært at se, var at flaget **blev** respekteret ét sted: `riderEligibility.applyRiderEligibilityFilter` ekskluderer pensionerede fra løbsudtagelse. Systemet opførte sig altså korrekt på den flade man ville teste først (han kan ikke køre løb), mens `getSquadSnapshot`, `getTeamMarketState` og alle manager-vendte trup-tællinger stille talte ham med. Ét subsystem der honorerer flaget skaber en falsk tryghed om at alle gør det.

Værre: `squadRiskGuard` (#2748-A) var allerede shippet med kommentaren at en pensionsmoden rytter "forlader holdet AF SIG SELV ved næste transition" — og spærrede salg på det grundlag. En guard var altså bygget på en semantik som datalaget aldrig implementerede. Præcedensen fandtes endda i `legacyRiderRetirement.js`, der pensionerer med `{ is_retired: true, team_id: null }`; den korrekte form lå i repoet hele tiden.

## Fix

- Ny `backend/lib/retirementRelease.js` + fase `retirement_release` i `backend/lib/seasonTransition.js` (efter `processSeasonStart`, hvor pensioneringen sættes). Nulstiller `team_id`, `pending_team_id`, `salary`, `contract_length`, `contract_end_season`, `acquired_at`.
- Forespørgslen er **tilstands-baseret** (`is_retired = true AND team_id IS NOT NULL`), ikke sæson-baseret — derfor selv-helende og idempotent uden ekstra bogholderi.
- Backwards-check: `is_retired` ekskluderet i `getTeamMarketState`, `getSquadSnapshot`, `dashboardSquadStats`, Dashboard, TeamPage, AuctionsPage.
- Forward-guard: `findCheapestAvailableRiders` filtrerer `is_retired`, så auto-købet ikke kan købe en pensioneret fri agent nu hvor de lander i puljen.

PR #2839, Refs #2835 #2748 #2744.

## Forhindret-fremover

- `retirementRelease.test.js` låser **query-formen** fast med en assertion, ikke kun release-logikken. Det er den der bærer idempotensen; driver den, holder fasen op med at selv-hele uden at nogen test bliver rød.
- Wiring-test i `seasonTransition.test.js` på fase-**rækkefølgen**: frigivelsen skal ligge efter `processSeasonStart`. Flyttes den op, er der ingen nypensionerede at frigive, og bugget er tilbage i stilhed.
- S8-generalprøven har fået en konkret måling: efter skiftet skal `SELECT count(*) FROM riders WHERE is_retired = true AND team_id IS NOT NULL` give 0.

## Læring

**Når et flag markerer at nogen har forladt en tilstand, så find den ejerskabs-kolonne der også skal ændres — og tjek derefter hver eneste forbruger af den kolonne, ikke kun den ene der føles relevant.** `is_retired` og `team_id` er to halvdele af den samme overgang; at sætte den ene er at bede alle læsere om at huske at kombinere dem korrekt, og det gjorde tre ud af fire ikke.

To generaliserbare lugte fra denne sag:

1. **Et subsystem der honorerer flaget beviser ingenting om de andre.** At løbsmotoren gjorde det rigtige var netop grunden til at ingen kiggede videre. Spørg i stedet: hvem SELECTer på den kolonne flaget burde have ændret?
2. **En guard hvis kommentar beskriver adfærd, er en påstand der skal verificeres mod datalaget.** `squadRiskGuard` beskrev en afgang som ikke fandtes. Når man skriver "X sker automatisk ved Y" i en kommentar, er det værd at åbne Y og se efter.

Cluster: `feedback_backwards_check_forward_guard`, `feedback_match_ui_filter_for_capacity_logic`, `feedback_runtime_verify_first`.
