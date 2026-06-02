# Division-kapacitet talte test-konti med (#962)

**Dato:** 2026-06-02
**Type:** Bugfix-postmortem (samme-dags-regression på egen feature)
**PRs:** #967 (feature), #968 (fix)

## Symptom
Ejer opdagede at ranglisten viste **Division 1 (17)** mens 3 rigtige hold lå i **Division 2** — trods tilsyneladende ledig plads i div 1.

## Rod-årsag
Fyld-fra-toppen (#962) tildeler nye hold den højeste division med ledig plads, cap = `DIVISION_CAPACITY` (20). Optællingen ekskluderede `is_ai` og `is_frozen`, men **ikke `is_test_account`**.

Ranglisten (`frontend/src/pages/StandingsPage.jsx:51`) viser kun "rigtige" hold:
`is_ai = false AND is_test_account = false AND is_frozen = false`.

Prod havde 3 test-konti i div 1. De talte mod cap=20 (17 rigtige + 3 test = 20), så de næste 3 rigtige hold blev skubbet til div 2 — men test-kontiene var usynlige på ranglisten, så uoverensstemmelsen (17 vist, men div 2 fyldt) så ulogisk ud.

## Hvorfor tests ikke fangede det
`teamProfileEngine.test.js` seedede kun AI/frosne/menneske-hold — ikke test-konti. Testene kodede præcis den samme ufuldstændige antagelse som produktionskoden, så de var grønne mens koden var forkert. Klassisk blind plet: test og kode delte fejlen.

## Fix
- `pickDivisionForNewTeam` + `rebalanceDivisions`: tilføj `.eq("is_test_account", false)` → optælling matcher ranglistens filter.
- Korrigerende migration `database/2026-06-02-division-fill-from-top-exclude-test-accounts.sql`.
- Tests: regression med 17 rigtige + 3 test-konti → der er stadig plads i div 1; AI/test/frosne-eksklusion.

## Forebyggelse (forward-guard)
- **Kapacitets-/optællings-/"findes"-logik skal matche det filter UI'et viser data med.** Grep efter frontend-queryen for samme entitet og kopiér HELE filter-kæden, før du skriver backend-tællingen.
- "Rigtige hold" = ikke-AI, ikke-test, ikke-frosne. Overvej delt helper hvis filteret bruges 3+ steder.
- Test-fixtures skal indeholde de skjulte varianter (AI/test/frosne), ellers tester man den samme blinde plet.
- Verificér slut-tilstand mod UI-tallet brugeren ser (fane-count), ikke kun rå tabel-tal.

Memory: `feedback_match_ui_filter_for_capacity_logic`.
