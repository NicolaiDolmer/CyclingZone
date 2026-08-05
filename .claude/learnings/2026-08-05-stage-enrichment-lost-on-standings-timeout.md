# Postmortem · 2026-08-05 · etape-berigelse tabt permanent når standings-recompute fejler

## Hvad skete der?
Når en etape afvikles, skrives resultaterne (placeringer/point/præmier) atomært
via `apply_stage_result`-RPC'en (#1598) — DEN bump'er `stages_completed`. Lige
efter kaldte `simulateStageByIndex` (raceRunner.js) og `applyRaceResults`
(raceResultsEngine.js, brugt af `simulateRace` for endagsløb) et
standings-recompute (`ensureSeasonStandings`/`updateStandings`) UHÅNDTERET —
fejlede det (Sentry CYCLINGZONE-3D/3E: `canceling statement due to statement
timeout`, 57014, under samtidige etape-afviklinger — `race_results` er nu
458.553 rækker mod ~166k funktionen blev skrevet til under #2391), væltede
resten af funktionen FØR berigelsen (runs/moments/incidents + træthed) blev
skrevet. Fordi `stages_completed` allerede var bumpet, kørte etapen aldrig
igen — berigelsen var tabt for evigt, resultaterne stod korrekt.

Verificeret mod prod (read-only, 2026-08-05): **20 etaper i 15 løb** har
resultater men 0 runs/moments/incidents — IKKE 19/14 som issuet oprindeligt
målte 25/7. Alle 20 timestamps (`race_results.imported_at`) ligger mellem
2026-07-01 og 2026-07-25 16:28 UTC; Tour du Jura etape 2 (25/7 16:28) er
formentlig sket EFTER issuets 25/7-snapshot blev taget — deraf differencen.
Alle 15 løb er partielle (har runs på andre etaper) — ingen kan bortforklares
som pre-v3/legacy.

## Root cause
`raceRunner.js` (simulateStageByIndex, linje ~1967-1973 før fix) og
`raceResultsEngine.js` (applyRaceResults, linje ~120-121 før fix) kaldte
`ensureSeasonStandings`/`updateStandings` uden try/catch, MELLEM den atomære
result-write og de efterfølgende berigelses-skrivninger
(persistRuns/persistPassages/persistIncidents/persistStageMoments +
applyFatigue). PR #2878 tilføjede retry (`withSupabaseRetry`) på selve RPC'en
— reducerer hyppigheden, men fjerner ikke muligheden, og retter ikke
kob­lingen: en fejl der overlever retry'et væltede stadig hele resten.

## Fix
Begge steder pakket i try/catch + `captureException` (Sentry), matcher det
mønster `applyFatigue`/`processBoardWeekend`/`notifyStageInApp` allerede
brugte i samme funktion — standings er en fuld re-derivation fra
`race_results` og dermed inhærent idempotent/self-healing (næste
etape/recompute retter den); berigelsen er IKKE self-healende og må ikke
være gidsel for et recompute den intet har med at gøre:

- `backend/lib/raceRunner.js` (`simulateStageByIndex`, ~linje 1967-1990)
- `backend/lib/raceResultsEngine.js` (`applyRaceResults`, ~linje 117-135) —
  samme anti-mønster rammer `simulateRace` (endagsløb) og deles med
  `pcmResultsImport`; fikset her beskytter begge kaldere uniformt.

Fejlen er stadig SYNLIG (console.error + Sentry-capture med
race/stage-tags) — ikke en tavs try/catch der skjuler problemet.

## Bagudrettet: kan de 20 (nu) ramte etaper regenereres?
**Nej — inputtet er ikke længere pålideligt til stede.** Undersøgt mod prod:
- `rider_condition` (fatigue/form) har INGEN historik-tabel — kun ét
  nuværende tal pr. rytter. Trætheden der skulle være anvendt for disse 20
  etaper (via `applyFatigue`, som heller aldrig kørte) er uigenkaldeligt
  overskrevet af hver efterfølgende dags henfald/træning/løb siden.
- `race_entries` (startfeltet) er IKKE en frossen per-etape-snapshot — den
  reflekterer holdets AKTUELLE tilmelding. For de fleste af de 15 løb er den
  nu tom eller har kun 0-6 rækker tilbage (mod 60-190 ved afviklingstidspunktet),
  fordi holdene er rykket videre til andre løb siden.
- `race_stage_profiles` (rute/profil-data) er derimod INTAKT for alle 20
  etaper — men det er kun ÉT af de nødvendige simulerings-input.

Konsekvens: et gen-kørt `simulateStageByIndex`/`buildStageRowsAccumulated`-
kald ville simulere med DAGENS entrant-state (anden træthed, muligvis andre
abilities efter en måneds træning), ikke tidspunktets — og ville derfor
sandsynligvis IKKE reproducere de allerede udbetalte/publicerede ranks i
`race_results`. Der findes ingen "byg berigelse der matcher et KENDT
facit"-funktion i motoren (kun "simulér og LAD facittet falde ud"); at bygge
én nu ville være en ny funktion, ikke en genskabelse, og risikerer at vise
spillere en runs/moments-fortælling der modsiger de officielle, allerede
udbetalte resultater — værre end den nuværende tomme tilstand.

**Ingen regenererings-script skrevet** — per opgavens eget forbehold ("kan
de, så skriv... ellers ikke"). Matcher issuets egen vurdering ("lav
prioritet... lad de 19 [nu 20] stå").

## Forhindret-fremover
- Regressionstest i `raceRunnerStage.test.js` (#2877) og
  `raceResultsEngine.test.js` (#2877): standings-recompute-fejl (57014-stub)
  → run-snapshot/fatigue skrives stadig, funktionen kaster ikke videre.
- Åbent forbedringsforslag (ikke implementeret her): en `rider_condition`-
  historik-tabel ville have gjort bagudrettet reparation mulig for lignende
  fremtidige hændelser — værd at overveje separat, ikke i dette issues scope.

## Læring
En kommentar der kalder noget "self-healing" (som standings-recompute'en
retmæssigt er) retfærdiggør IKKE at lade en fejl i den vælte NABO-kode der
IKKE er self-healende. Enrichment-skrivninger der kun sker ÉN gang pr. etape
skal aldrig dele fejl-skæbne med et recompute-kald de ikke afhænger af —
selv når begge ligger i samme funktion, samme transaktion-vindue.
