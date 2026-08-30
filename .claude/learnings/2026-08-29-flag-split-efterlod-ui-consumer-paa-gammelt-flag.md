# Postmortem · 2026-08-29 · Flag-split efterlod en UI-consumer på det gamle flag (#4375)

## Hvad skete der?
Efter #4277 slukkede løbsdags-udviklingen for S3 blev spillerne ved med at se
løbsdags-badgen på træningssiden, og intensitets-knapperne blev ved med at være
dæmpede for ryttere med løb samme dag. Motoren gav dem i virkeligheden et helt
normalt træningspas. Mindst tre spillere rapporterede det i Discord, og én af dem
trænede slet ikke fordi han troede rytterne var blokerede.

## Root cause
#4277 splittede ét flag i to: `race_day_engine_enabled` (D3 recovery-konstanter +
D4 AI-hold) og `race_day_development_enabled` (D1 løbsdags-lookup + D2
udviklings-tick). Splittet blev gennemført i `backend/lib/dailyTrainingEngine.js`,
men `GET /api/training/me` i `backend/routes/api.js` blev overset. Route'n gatede
stadig sit `racingToday`-felt på motor-flagget, som forblev on. Feltet blev derfor
leveret videre til `useTraining` og `TrainingPage`, hvor tilstedeværelse pr. rytter
ER hele gaten for badge + dæmpning. UI og motor kørte to forskellige regler.

## Fix
`backend/routes/api.js`: `/training/me` læser nu `RACE_DAY_DEVELOPMENT_FLAG_KEY` i
stedet for `RACE_DAY_ENGINE_FLAG_KEY`, og både loader-kaldet og response-spreadet
hænger på `raceDayDevelopmentOn`. Ingen frontend-adfærd ændret: `useTraining`
normaliserede allerede et manglende felt med `?? {}`, så tomt felt giver hverken
badge eller dæmpning.

## Forhindret-fremover
`backend/lib/apiTrainingMeRaceDay.routes.test.js` har nu (a) en regressions-guard
der fejler hvis `/training/me`-blokken overhovedet nævner motor-flagget, og (b)
adfærds-tests for flag-off (udvikling off + motor on), manglende app_config-række,
ukendt værdi, beta-stage og flag-on, kørt mod de ægte `readFlagStage` /
`evaluateFlagStage`. Plus en test der låser frontendens `?? {}`-normalisering fast.

## Læring
Når ét flag splittes i to, er motoren ikke den eneste consumer. Grep efter den
GAMLE flag-nøgle i HELE repoet (routes, sweeps, scripts, frontend-kommentarer) som
en del af split-PR'en, ikke kun i det modul splittet handlede om. Og et rent
visuelt signal, der ikke matcher hvad motoren faktisk gør, koster spillerne rigtige
handlinger: her holdt en spiller op med at træne, fordi UI'et så slukket ud.
