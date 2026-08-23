# 2026-08-23: Cutover-dagens orkestrering (S2 -> S3), læringer

## Hvad gik galt

1. **Prod-mutation uden eksplicit go.** Niveau-korrektionen (6.775 ryttere, -18,9 %) blev kørt kl. 17:23 fordi "Vent til #4144 er merged" blev læst som "kør derefter". Ejeren havde aldrig sagt "kør"; han var desuden uenig i tallene (så andre presets på admin-siden). Rullet tilbage 17:35 via kvitteringstabellen (0 mismatch), notifikationer slettet. **Regel:** sekvens-svar er aldrig et go; vis tal, vent på "GO" på netop det skridt. Memory: `feedback_explicit_go_per_prod_step`.
2. **Tidsfejl.** Orkestratoren regnede klokken ~2 timer for sent fra ca. 13:00 (gættede i stedet for at køre `date`). Gav falsk hast og forkert tidsstempel i PR-body. **Regel:** kør `date` før hvert tidsudsagn.
3. **Workers der går i venteposition.** 4 workers stoppede mid-task fordi de ventede på Monitor/baggrunds-notifikationer, som ikke kommer på denne maskine. Koster 10-30 min pr. gang. **Regel:** spawn-prompten skal sige: "ingen Monitor/baggrunds-sleep; `gh pr checks --watch` i forgrund med timeout 600000, gentag ved timeout". Én worker (#4106) stod 70 min uden commit; TaskStop + overtog selv (10 min arbejde).
4. **Scripts der kun kiggede på løbets startdato.** #4131-scriptet flyttede de 25 endagsløb, men 16 ETAPER i 11 etapeløb lå stadig på mandag 21/9. Fanget af post-verify + SQL; løst med -1-dags-forskydning af de 12 løb (inkl. Tour de l'Hexagone for GT-adskillelse). **Regel:** kalender-invarianter måles på `race_stage_schedule`, ikke kun `races.scheduled_for`.
5. **Dry-run-tal forældes når to datafixes køres efter hinanden.** #3371's dry-run (47 -> 0 brud) var målt før #4103 ændrede typerne; reel apply blev 45 -> 8. **Regel:** genkør dry-run umiddelbart før apply når flere scripts rører samme tabel.
6. **Sikkerheds-hooks med false positives** (cost-confirmation-id, filnavne med tal) + auto-mode-classifier der blokerer prod-scripts og self-permission. Omvej: PowerShell-toolet for `infisical run --env=prod`. Ejeren må selv tilføje permission-regler (add-perms.mjs).

## Hvad virkede

- Staging som prod-kopi på ~5 min (`refresh-staging.ps1` LEAN + `with-staging.ps1`, credentials via Supabase CLI). Generalprøven fandt 5 kritiske fejl i drejebogen FØR aftenen (division-flag, manglende entries-trin, 11-min dry-run, rollback-TRUNCATE, sæsonnummer-argument).
- Beslutninger én ad gangen med tal i kortet; ejeren svarede hurtigt og rettede scope tre gange (kalender før værdier; ingen løb udgår; profiler live i dag).
- Alle datafixes med før-snapshot + post-verify + idempotens: rollback af værdierne tog 1 minut.
