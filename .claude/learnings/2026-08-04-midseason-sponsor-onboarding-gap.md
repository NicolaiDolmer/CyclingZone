# Postmortem · 2026-08-04 · Nye mid-season-hold fik aldrig sponsorkontrakt (0 sponsorindtægt hele første sæson)

## Hvad skete der?
Sponsor-audit 4/8 (read-only SQL mod prod, jf. [#3316](https://github.com/NicolaiDolmer/CyclingZone/issues/3316)):
D2 og D3 havde 100% kontrakt-dækning (48/48 og 96/96), men D4 kun 12/33. De 21
D4-hold uden aktiv kontrakt var ALLE oprettet efter S2-sæsonstart. 16 af dem havde
ALDRIG haft nogen `sponsor_contracts`-række overhovedet — de havde spillet 1-8
løbsdage uden nogensinde at modtage et tilbud. Da nye signups altid lander i D4
(pyramide, #1688), betød det at enhver ny spiller spillede hele sin første sæson
uden sponsorindtægt (hverken base, race-day eller bonus), uanset hvad de gjorde.

## Root cause
`sponsorContractsService.getNegotiationState` returnerede `negotiable: true` for
et hold uden aktiv kontrakt (korrekt), men beregnede altid tilbud for
`currentSeasonNumber + 1` — "næste sæson". `acceptOffer` skrev derfor altid en
`status='pending'`-række med `start_season = kommende sæson`, som først blev
aktiveret af `expireAndRenewContracts` ved det NÆSTE sæsonskifte
(`sponsorContractsService.js:339-416`, uændret siden #2948). Et hold der meldte
sig ind midt i en sæson havde derfor ingen kode-sti overhovedet der kunne give det
sponsorindtægt i den sæson det faktisk spillede — kun i sæsonen efter.

## Fix
Ejer-godkendt løsning A (4/8): et hold uden aktiv kontrakt forhandler for
INDEVÆRENDE sæson og aktiverer med det samme ved accept.
- `backend/lib/sponsorContractsService.js`: `getNegotiationState` forgrener nu på
  `!active` — intet aktiv kontrakt → tilbud for `currentSeasonNumber` (ikke
  `+1`) og `immediate: true`. Ny `acceptOfferImmediately(...)` skriver
  `status='active'` + `activated_at=now()` direkte (ikke `pending`), genberegner
  `per_race_day_rate` mod holdets EGEN etape-divisor (samme #2913-mønster som
  `expireAndRenewContracts`) og krediterer signing bonus ved aktivering — men
  INGEN `guaranteed_base`-udbetaling (den sker kun via
  `economyEngine.processSeasonStart`, som ikke kører om igen for et hold der kom
  til efter sæsonstart, så feltet er skrevet, men aldrig krediteret denne sæson).
  En eksisterende pending for en SENERE sæson (de 5 D4-hold der allerede har
  valgt et tilbud for næste sæson) røres bevidst ikke.
- `backend/lib/sponsorRaceDayIncome.js`: nyt `activated_at`-felt på kontrakten
  (migration `database/2026-08-04-3316-midseason-sponsor-activation.sql`,
  nullable, NULL for alle eksisterende season-start-aktiverede kontrakter = ingen
  filtrering, uændret adfærd). `payRaceDaySponsorsToDate` bygger nu
  `resultTimeByTeam` fra `race_results.imported_at` og
  `computeRaceDayCredits`/`computeResultBonusCredits` springer et hold over hvis
  løbets resultat er ældre end `activated_at` — ellers ville en mid-season-
  aktivering kunne bagudbetale for løb holdet allerede kørte uden kontrakt.
- `backend/routes/api.js`: `POST /sponsor/offers/accept` kalder
  `acceptOfferImmediately` når `state.immediate`, ellers uændret `acceptOffer`.
- Ingen ændring i `teamProfileEngine.upsertOwnTeamProfile` (holdoprettelse):
  tilbud genereres deterministisk on-demand, ikke eagerly ved oprettelse, så de
  16 kontraktløse hold rammer den nye sti automatisk næste gang de henter
  `/api/sponsor/offers` (Board-siden kalder det allerede ved hvert mount) — ingen
  separat backfill-cron nødvendig.

## Forhindret-fremover
- TDD, rød→grøn i alle tre lag: `sponsorContractsService.test.js` (immediate-
  branch + `acceptOfferImmediately`, inkl. et eksplicit test for at en pending
  for en SENERE sæson IKKE røres), `sponsorRaceDayIncome.test.js` (bevis-test:
  et løb completet FØR `activated_at` giver 0 kr., et løb EFTER krediterer
  normalt) — alle kørt fejlende (rød) mod den gamle kode først.
- Backfill-valget (on-demand generering rammer eksisterende kontraktløse hold
  automatisk) er bevidst dokumenteret her og i PR-body, så en senere session ikke
  genopfinder et cron-job der ikke er nødvendigt.

## Læring
En "generér on-demand, ingen eager write ved oprettelse"-arkitektur (offers er
en ren funktion af team+season, ingen DB-række før accept) er normalt et
simplicitets-plus, men den gjorde her et helt segment af nye spillere usynlige
for en implicit antagelse andre steder i koden: at "forhandling" altid betyder
"for NÆSTE sæson". Når en funktion har to reelt forskellige kald-kontekster
(frisk hold vs. fornyelse af udløbende kontrakt), skal grenen eksplicit
diskriminere på den forskel i selve domænelogikken — ikke antage at "ingen aktiv
kontrakt" og "aktiv kontrakt der snart udløber" opfører sig ens, bare fordi de
begge gav `negotiable: true` i den gamle kode.
