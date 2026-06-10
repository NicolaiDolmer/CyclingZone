# Frossen kolonne efterlader døde tærskler + select-liste-huller maskeret af test-fixtures

**Dato:** 2026-06-10 · **Issue:** #1205 · **PR:** #1206 · **Kontekst:** #1101-cutover afkoblede `riders.uci_points`

## Hvad skete

1. **Døde tærskler overlevede afkoblingen.** Efter #1101 var `uci_points` frosset, men fire live paths brugte den stadig funktionelt: force-sale-beskyttelse (`>=100`), `team_star` (`>50000`), `transfer_bargain` (`offer < points/2`) og squad-filler-sortering. To af dem viste sig at have været **døde længe FØR cutoveret**: `team_star`-tærsklen 50.000 var aldrig opnåelig (ægte UCI-skala topper ~11.000), og `transfer_bargain` sammenlignede CZ$ med rå point — meningsløst efter 4000x-skaleringen 2026-04-25. Ingen opdagede det, fordi achievements der aldrig fyrer ikke larmer.
2. **Select-liste-hul maskeret af fixtures.** `selectForcedListingRider` sorterer på `market_value` og bruger den som `asking_price` — men `BOARD_IDENTITY_RIDER_SELECT` (kolonnelisten callers loader riders med) indeholdt ikke `market_value`. I prod: sortering på `undefined` + listing til `asking_price = 0`. Unit-tests var grønne, fordi fixtures håndbyggede rider-objekter MED `market_value`.

## Lærdomme

- **Ved kolonne-afkobling: grep alle funktionelle læsere SAMME dag** (`grep -rn kolonne backend/ --include='*.js'` minus tests/scripts) og konvertér eller flag dem eksplicit. En afkoblet kolonne der stadig læses er værre end en død: den glider lydløst.
- **Tærskel-baserede features skal sanity-tjekkes mod faktisk dataskala** (probe: percentiler + antal over tærskel). `team_star` ville være fanget af ét enkelt "hvor mange kan overhovedet opnå dette?"-tjek ved oprettelse.
- **Pure functions + håndbyggede fixtures = mock-reality gap.** Når en pure function forventer felter, så verificér at PRODUKTIONS-select-listen leverer dem (testen kan asserte på select-strengen, eller fixtures kan bygges FRA select-listen). Samme klasse som [[feedback_match_ui_filter_for_capacity_logic]].

## Forward-guard

- `STAR_RIDER_MARKET_VALUE` dokumenteret i `docs/GAME_INVARIANTS.md` med eksplicit re-kalibrerings-trigger (#1194) og copy-kobling.
- `GAME_INVARIANTS` siger nu: `uci_points` må ikke bruges i nye live paths; eneste dokumenterede rest er `boardIdentity.calculateRiderStarScore` (sporet i #1205).
