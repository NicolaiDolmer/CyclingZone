# 2026-09-15: Feature-liveness-auditen var rød på ALLE PR'er efter #5205 (flag-gated tom tabel)

## Hvad skete

PR #5205 (træningstick pr. løbsdag, merget 15/9 formiddag bag flag `training_tick_per_race_day` = off) tilføjede tabellen `rider_ability_race_day_history` med INSERT-stier i `dailyTrainingEngine.js`. Detector A i `backend/scripts/audit-feature-liveness.js` ("write-but-no-data") flagede tabellen (0 rows + skrivesti) på hver eneste PR resten af dagen. To laner i bølge 1 rapporterede den som "rød, ikke min", og reviewer-agenten skrev "skal være grøn før merge".

## Hvorfor det ikke stoppede noget

`audit` er ikke et påkrævet check; merge-køen (`scripts/merge-queue.ps1`) kigger kun på `gh pr checks --required`. Men et rødt check på alle PR'er er støj der tager tid fra laner og reviewere, og det gør en ægte audit-alarm usynlig.

## Rodårsag

Migrationen for #5205 seedede flaget, men registrerede ikke tabellen i auditens flag-bevidste undtagelsesliste `FLAG_GATED_EMPTY_TABLES` (den selvkorrigerende: flag off → tom tabel er forventet; flag on + tom → ægte fund). Auditen læser flaget som JSON-værdi; `false` er off, men flaget var seedet som tekst `"false"`, så entry'en fik `offValues: ["false", "0"]`.

## Fix

Commit `d7ee2b2c5` på main: `["rider_ability_race_day_history", { flagKey: "training_tick_per_race_day", offValues: ["false", "0"] }]`. Test `audit-feature-liveness.test.js` grøn.

## Forward-guard

- **Regel:** en PR der tilføjer en tabel der KUN skrives bag et flag, skal i samme PR tilføje tabellen til `FLAG_GATED_EMPTY_TABLES` (ikke den statiske whitelist). Skriv det i worker-briefen for migration-PR'er: "ny tabel bag flag → FLAG_GATED_EMPTY_TABLES-entry i samme PR".
- Kandidat til CI-guard: en test der fejler hvis en migration opretter en tabel OG en flag-nøgle i samme PR uden en tilsvarende entry i auditen (ikke bygget; issue ved behov).

## Læring for orkestratoren

"Rød på alle PR'er samtidig" = main-bred årsag, aldrig lanens. Tjek main-CI og det seneste merge FØR laner bruger tid på det. Kostede 15/9 ca. 20 min på tværs af tre laner og en reviewer.
