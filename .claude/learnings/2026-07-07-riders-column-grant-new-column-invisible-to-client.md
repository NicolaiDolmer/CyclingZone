# Ny riders-kolonne usynlig for klienten — kolonne-niveau grants + PostgREST-filter

**Dato:** 2026-07-07 · **Issue/PR:** #2238 / PR #2239 · **Alvor:** prod-brud (rytter-siden tom for alle brugere)

## Symptom
Efter merge af rytter-side-toggle (#2238) viste `/riders` **0 ryttere** når toggle var slået fra (default). DB-verifikation (execute_sql) viste 2514 korrekte rows — men brugerne så intet.

## Rod-årsag
`public.riders` har **kolonne-niveau SELECT-grants**, ikke table-level (ingen `GRANT SELECT ON riders`; i stedet `GRANT SELECT (col1, col2, …)` for ~82 kolonner). Det blev indført for at skjule `potentiale`/`ability_caps` (#1162, #2098). En **ny kolonne arver IKKE** disse grants — den er usynlig for `authenticated`/`anon` indtil eksplicit grantet.

`riders.owner_is_ai` (ny denormaliseret kolonne) blev ikke grantet. RidersPage filtrerer klient-side via PostgREST: `.eq("owner_is_ai", false)`. **Et filter på en kolonne rollen ikke må læse → PostgREST permission denied → HELE queryen fejler → tom liste.**

## Hvorfor det slap forbi verifikationen
Al DB-verifikation kørte som **service_role** (execute_sql), som **bypasser column grants + RLS**. Den så 2514 korrekte rows. Fælden var kun synlig for `authenticated`/`anon`. Playwright-smoke bruger mock (ingen ægte PostgREST-grants). Ingen af verifikations-lagene ramte den ægte klient-privilege-sti.

## Fix
`GRANT SELECT (owner_is_ai) ON public.riders TO authenticated, anon;` + `NOTIFY pgrst`. Anvendt direkte mod prod (incident) + `database/2026-07-07-riders-owner-is-ai-grant.sql` som git-record.

## Læring / forward-guard
1. **Enhver ny `riders`-kolonne skal grantes eksplicit** til authenticated/anon (medmindre bevidst skjult som potentiale). Samme gælder andre tabeller med kolonne-niveau grants.
2. **Verificér som `authenticated`, ikke kun service_role.** `SET LOCAL ROLE authenticated; SELECT …` afslører privilege/RLS-fælder uden en HTTP-key. Tilføjet til rutinen.
3. Cluster: [[feedback_match_ui_filter_for_capacity_logic]] (service_role bypasser det UI'et ser), [[feedback_test_real_endpoint_not_just_mocked]].
4. Forward-guard foreslået: CI-check der fanger nye riders-kolonner uden klient-grant (follow-up-issue).
