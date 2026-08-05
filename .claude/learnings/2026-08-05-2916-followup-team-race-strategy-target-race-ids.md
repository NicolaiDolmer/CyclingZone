# Postmortem · 2026-08-05 · #2916-opfølgning: team_race_strategy.target_race_ids går lydløst i stykker ved sæsonskifte

## Hvad skete der?
Ved genoptaget verifikation af #2916 (som allerede var lukket 30/7 med prod-evidens for de oprindelige 5 flader) blev der fundet en 6. manager-opsætnings-flade der IKKE står i `MANAGER_SETUP_REGISTRY`: `team_race_strategy.target_race_ids` (Race Hub S3 Fase 2, "prioritér dette løb"). Verificeret i prod 2026-08-05: 44 af 115 target_race_ids-referencer på tværs af 14 hold peger allerede på løb fra S1 (den sæson der sluttede 27/7) — samme lydløse fejl-shape som #2916's oprindelige træningsplan-bug, blot i en anden tabel, og den er ALLEREDE sket én gang uden at nogen opdagede det.

## Root cause
`team_race_strategy` har ingen `season_id`-kolonne (PK = team_id, tabellen er bevidst ikke sæson-scoped fordi a_chain/captain_priorities/role_rules skal overleve af sig selv). Men `target_race_ids` er en JSONB-liste af konkrete `race_id`-værdier, som ER sæson-scopede data gemt i en ikke-sæson-scoped tabel. #2916's forward-guard-scanner (`seasonCarryOverRegistry.test.js`) fanger kun tabeller hvis KROP har både `season_id` og `team_id`/`rider_id` som kolonner — den kan strukturelt ikke opdage en tabel der INDEHOLDER sæson-scopede referencer uden selv at have en season_id-kolonne. `raceEntryGenerator.js`'s `isTargetRace: !!strategy.targetRaceIds?.has(race.race_id)` matcher derfor aldrig noget mod den nye sæsons løb, og holdets prioritering forsvinder uden fejl, log eller besked.

## Fix
`backend/lib/seasonCarryOver.js`: ny handler `revalidateTargetRaceIds()` (REVALIDATE — tæller `stale_refs` mod races i mål-sæsonen + `wrong_pool_refs` mod holdets pulje, rører intet). Registreret i `MANAGER_SETUP_REGISTRY` sammen med `team_rider_role_rules` (PERSISTS, dokumentations-only — allerede roster-filtreret ved læsning). Wiret ind i `carryOverManagerSetup()` og dermed automatisk med i både dry-run-previewet og selve transitionen. `backend/scripts/simulateSeasonTransitionDryRun.js` printer nu alle carry-over-flader, ikke kun invarianterne.

## Forhindret-fremover
Scanneren fanger stadig kun kolonne-formen `season_id` + `team_id`/`rider_id`. Denne bug-klasse (sæson-scopede VÆRDIER i en ikke-sæson-scoped tabel) kræver fortsat manuel audit — det er en eksplicit dokumenteret begrænsning i `seasonCarryOver.js`'s filhoved nu. Ingen automatiseret forward-guard bygget for dette denne omgang (vurderet for bredt/usikkert til en natbølge-session); flagget som en åben opfølgning.

## Læring
"Verificér runtime, ikke kun tabellen" gælder også carry-over-registrets EGEN dækning: en forward-guard der scanner efter et strukturelt mønster (kolonne-navne) fanger ikke en semantisk variant af samme bug (værdier der refererer til sæson-scoped data uden selv at bo i en sæson-scoped tabel). Når et issue lukkes som "løst" ud fra en eksplicit liste, er listens FULDSTÆNDIGHED selv en antagelse der bør revurderes ved næste relaterede audit — ikke kun om de listede punkter stadig holder.
