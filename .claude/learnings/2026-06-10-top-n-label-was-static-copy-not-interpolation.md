# "Top n finish"-bugen var statisk copy — ikke en interpolations-fejl (#1233)

**Dato:** 2026-06-10 · **Issues:** #1233 (+#1232/#1240/#1241 i samme PR)

## Hvad skete

Issue-teksten antog en manglende variabel-substitution ("sandsynligvis manglende
interpolation i locale-streng eller formatter"). Grep efter `"Top n"` i kode,
locales, SQL og FULD git-historik (`git log --all -S`) gav nul hits — strengen
havde aldrig eksisteret som template. DB-tjek (board_profiles.current_goals)
viste at alle gemte labels interpolerede korrekt ("Top 7 i divisionen").

Rod-årsagen blev først fundet ved at hente ejerens Discord-screenshot og matche
det mod UI'et: teksten var den STATISKE empty-state-/tour-copy
`emptyState.kpis.results.text` = "etapesejre, top-N-finish, samlede sejre" —
"N" var bevidst jargon i copy, ikke en uudfyldt placeholder.

## Læring

1. **Screenshot før kode-jagt.** Når et issue stammer fra et screenshot, så match
   screenshot → komponent FØR du leder efter den formodede tekniske fejlklasse.
   Issue-antagelsen ("interpolations-fejl") kostede en lang søgning i forkert
   retning; screenshotet pegede direkte på copy'en.
   Hent via `scripts/discord/dump-threads.mjs`-mønstret (token via Infisical env,
   aldrig printet).
2. **"Literal placeholder"-symptomer kan være copy-jargon.** Tekniske
   pladsholder-konventioner (N, X, n) i spiller-vendt copy læses som bugs af
   brugere. Forward-guard: `boardGoalLabel.test.js` asserterer nu at hverken
   mål-labels eller KPI-copy indeholder fritstående "n"/"N" (en+da).
3. **Sekundært fund:** mål-labels fra DB er dansk råtekst uden `label_key` for
   de fleste typer → EN-brugere så dansk. `top_n_finish` er nu type-styret
   oversat (mønster fra #815 signature_rider); de øvrige typer lækker stadig
   dansk i EN-mode — kandidat til opfølgnings-issue.
