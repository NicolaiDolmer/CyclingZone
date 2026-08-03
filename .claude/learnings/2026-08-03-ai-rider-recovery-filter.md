# Postmortem · 2026-08-03 · AI-holdenes ryttere restituerer aldrig (#3015)

## Hvad skete der?
Den daglige assistent-sweep for træning (`backend/lib/trainingSweep.js`) kører kun for
"rigtige hold" (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false).
Det filter er korrekt for bestyrelsesbeskeder/gældsadvarsler, men det samme filter
udelukkede også AI-hold fra den daglige trætheds-restitution — en ren
rytter-fysiologisk mekanik, ikke en spiller-notifikation. Konsekvens: AI-ryttere
akkumulerer træthed (race-belastning) men får aldrig recovery, og drifter monotont
mod loftet (100). Målt i prod 2026-08-03 (sæson 2, 8 løbsdage inde efter en fuld
nulstilling 27/7): 1.977/3.238 AI-ryttere (61%) allerede tilbage på loftet, mod
1.388/3.033 (46%) for menneskeryttere. Træthed er et lige-ud fradrag i
raceSimulator.js's score, så AI-hold var systematisk svagere end deres rytterværdier
tilsagde — relevant for #2731/#2557's AI-dominans-analyse.

## Root cause
`backend/lib/trainingSweep.js:75` filtrerer `.eq("is_ai", false)` på den query der
finder hvilke hold der skal have et dagligt tick. Filteret er "rigtigt
manager-hold"-diskriminatoren (samme som `boardAutoAccept.js`/`checkDebtWarnings`),
genbrugt et sted hvor den semantisk ikke passer: fatigue/form indgår direkte i
løbsmotoren (`raceSimulator.js:157+631`) og er ikke en spillernotifikation. AI-hold
har derfor ALDRIG kørt igennem `riderCondition.nextFatigue`, uanset hvor meget
race-belastning de akkumulerede.

## Fix
Ny, dedikeret sweep — `backend/lib/aiRecoverySweep.js` — kører SAMME
`riderCondition.nextFatigue`/`nextForm`-funktioner med `intensity: "rest"` for
AI-holdenes ryttere, gated af samme `daily_training_enabled`-flag og samme kl.
22-dansk-tid-vindue som `trainingSweep.js`. Rører KUN `fatigue`/`form` (+
`updated_at`) — ingen ability-progression, ingen skaderisiko, ingen træningsplan
(AI-ryttere får IKKE spillerens træningsvalg, kun den fysiologiske restitution).
Egen mutex-tabel `ai_recovery_runs` (migration
`database/2026-08-03-ai-recovery-runs.sql`) i stedet for at genbruge
`training_day_runs` (som har et menneske-rettet `executed_by`-CHECK og
rapport-skema). Wired ind i `backend/cron.js` som sin egen 5-min-cron-entry,
parallelt med — men uafhængigt af — `trainingSweep`. `trainingSweep.js` og
`dailyTrainingEngine.js` er UÆNDREDE.

## Forhindret-fremover
9 nye tests i `backend/lib/aiRecoverySweep.test.js` dækker: tidsvindue, feature-flag,
korrekt is_ai=true-filtrering, allerede-kørt-i-dag (mutex), reservations-race
(23505 tælles hverken som swept eller failed), per-hold fejl-isolation, og den
faktiske fatigue/form-beregning (inkl. default recovery-ability=50 for ryttere uden
abilities-række). Ingen ny balance-konstant — genbruger de eksisterende, allerede
kalibrerede tal fra `riderCondition.js`.

## Læring
Den kanoniske "rigtigt hold"-diskriminator (`is_ai`/`is_bank`/`is_frozen`/
`is_test_account`, se `humanTeamFilter.js`) er IKKE universelt korrekt at genbruge —
den er rigtig for alt der er spiller-/manager-rettet (notifikationer, bestyrelse,
akademi-rekruttering), men forkert for mekanikker der er en del af selve
spilsimulationen (fysiologisk tilstand, race-score-input). Næste gang et nyt dagligt
tick/sweep bygges: spørg eksplicit "er dette en MANAGER-facing feature, eller en
SIMULATIONS-mekanik AI-hold også skal opføre sig fysisk korrekt under?" før filteret
kopieres blindt fra et naboliggende sweep.
