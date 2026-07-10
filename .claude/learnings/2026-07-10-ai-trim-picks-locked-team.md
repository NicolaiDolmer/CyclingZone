# 2026-07-10 — AI-trim valgte deterministisk et hold DB-guarden aldrig ville slippe (#2269)

## Symptom
Sentry CYCLINGZONE-20: 15 events / 15 brugere på `PUT /api/teams/my` med
`AI-rider delete: block_rider_delete_with_inflight_entries: ...` (#2074-guarden).
Lignede umiddelbart et frontend-UX-problem ("brugere prøver at fyre ryttere i låste
felter") — det var det ikke.

## Rod-årsag
`removeAiTeams` (aiTeamGenerator.js) valgte ALTID AI-holdet med lavest id til trim,
uden at tjekke om holdets ryttere havde `race_entries` i et igangværende løb.
DB-forward-guarden fra #2074 kastede korrekt → trimmen fejlede. Fordi udvælgelsen var
deterministisk, valgte HVER efterfølgende signup i puljen det SAMME låste hold →
fejlen gentog sig pr. signup, og puljen voksede over target (pulje 10: 26/24).
Fejlen var non-fatal for signup (try/catch i teamProfileEngine) — brugerne mærkede intet.

## Fix
`removeAiTeams` henter igangværende løb én gang, springer låste kandidater over i
id-ordenen, og trimmer færre end ønsket hvis alle er låst (deferred + console.warn).
DB-guarden står uændret som sidste forsvarslinje. PR #2271.

## Læringer
1. **En forward-guard skal følges op af at KALDERNE lærer at respektere den.**
   #2074-guarden blev shippet uden at nogen af de eksisterende hard-delete-stier
   (AI-trim, clearAllAiTeams) fik et pre-check. Guard + uændret kalder = permanent
   fejlende operation + Sentry-støj, ikke sikkerhed.
2. **Deterministisk kandidat-udvælgelse + permanent blokeret kandidat = evig retry
   af samme fejl.** Vælg-næste-ledige er den robuste form.
3. **Sentry-fejltekster nedarves fra det inderste lag.** "rytter kan ikke slettes"
   lugtede af bruger-handling, men culprit var en AI-oprydningssti. Tjek
   `component`-tag + stacktrace før symptom-hypotesen accepteres — beskrivelsen i
   opgaven ("frontend lader brugere forsøge...") var forkert, og et frontend-fix
   havde været spildt arbejde.
