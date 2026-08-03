# Postmortem · 2026-08-03 · Scorecard HEADLINE FAIL exitede 0 (#3009)

## Hvad skete der?
`backend/scripts/moneySupplyScorecard.js` og `inflationScorecard.js` printede
`HEADLINE: ... ❌ FAIL` — og har gjort det hele tiden, siden de faktiske
sponsor/upkeep-konstanter blev rekalibreret — men processen exitede altid 0.
`npm run economy:moneysupply` var derfor grønt i enhver forstand et CI-job eller
en agent kunne se, mens økonomien reelt dumper sine egne §2.1-mål (pengemængden
4,2-dobles over 5 sæsoner mod et loft på 1,3×). Fundet under backwards-checket i
#2854 (PR #3006), rapporteret som #3009, fixet her.

## Root cause
Begge filers hoved sagde eksplicit **"Report-pattern (ingen exit(1))"** — et
bevidst valg fra dengang scriptet kun var til pre-relaunch-review, aldrig
revideret efter launch. `main()` beregnede `allPass`/`syntheticResult.allPass`
korrekt og printede den rigtige HEADLINE-tekst, men intet sted i den lykkelige
sti satte `process.exitCode`. Den eneste `process.exitCode = 1` sad i
`main().catch(...)` — kun for THROWN errors, aldrig for et beregnet gate-FAIL.
Samme mønster (HEADLINE/GUARD-verdikt beregnet + printet, aldrig fældet til
exit-koden) fandtes i `scripts/sponsorChoiceScorecard.js` — opdaget under
backwards-checket, ikke nævnt i det oprindelige issue.

Tre søster-scorecards (`facilityInvestmentScorecard.js`,
`relegationParachuteScorecard.js`, `scoutTravelScorecard.js`) fik allerede den
rigtige fix i PR #3006 (`process.exitCode = allPass ? 0 : 1`) — men issue
#3009's forfatter turde bevidst IKKE gøre det samme for money-supply/inflation,
fordi de konstanter der faktisk kører var (og er) reelt i FAIL — at wire
exit-koden ville gøre `npm run economy:moneysupply` rødt på et grundlag der
kræver en ejer-beslutning (tærskler forkerte vs. økonomien forkert), ikke en
teknisk fix.

## Fix
- Ny delt hjælper `backend/scripts/lib/scorecardExitCode.js`:
  `gateExitCode(pass, { advisory }) => pass || advisory ? 0 : 1`. Én plads der
  afgør kontrakten, i stedet for at hvert script reimplementerer
  `allPass ? 0 : 1` (og potentielt glemmer det).
- `moneySupplyScorecard.js`: `process.exitCode = gateExitCode(syntheticResult.allPass, { advisory })`
  efter HEADLINE-linjen. Kun A-sektionen (primær gate) fælder — 4-divisions-
  FORSLAGET (`--tiers4`) er en fremtidig kalibrering ejeren granit-fryser
  separat, ikke en dom over nutiden, og gater derfor ikke.
- `inflationScorecard.js`: samme mønster, `gateExitCode(allPass, { advisory })`.
- `scripts/sponsorChoiceScorecard.js`: `gateExitCode(!dRow.guardFail && !eRow.guardFail, { advisory })`.
- Alle tre fik et nyt `--advisory`-flag: rapportér uden at fælde exit-koden.
  Motivation: money-supply/inflation-gaterne er lige nu ægte røde og venter på
  en ejer-beslutning (#3009's "hvad skal rettes: tærskler eller konstanter?").
  `--advisory` giver en report-only-vej der ikke tvinger den beslutning, uden at
  underminere default-adfærden (som nu ærligt reflekterer gate-status).
- Verificeret: ingen `.github/workflows/*.yml`, intet npm-script og intet
  aggregat-script kalder nogen af de tre scripts i dag (repo-wide grep) — så
  fixen bryder ingen eksisterende automatiseret caller. `npm run
  economy:moneysupply` og `node scripts/inflationScorecard.js` vil nu (korrekt)
  exite 1 lokalt indtil ejeren tager #3009's a/b-beslutning; det er selve
  fixen, ikke en sideeffekt.

## Forhindret-fremover
- `backend/scripts/lib/scorecardExitCode.test.js` — ren unit-test af
  `gateExitCode`-kontrakten (PASS→0, FAIL→1, advisory-override), kører uden DB.
- `backend/scripts/scorecardExitCodeWiring.test.js` — integrationstest der
  spawner de to synthetic-only scripts som ægte child-processer og
  sammenligner den PRINTEDE HEADLINE-verdikt mod den faktiske exit-kode
  (`result.status`). Parser den rigtige tekst i stedet for at hardcode
  forventet PASS/FAIL, så testen forbliver gyldig selv når økonomien senere
  kalibreres til PASS — den låser invarianten, ikke det aktuelle tal.
- `sponsorChoiceScorecard.js` kunne ikke få samme spawn-baserede test (kræver
  live Supabase service-role-credentials, ikke bare read-only) — fixet og
  verificeret ved kode-gennemgang + manuel `node --check`; flagget i PR-body som
  en kendt begrænsning.

## Læring
"Prints ❌ FAIL" og "processen fejler" er to helt forskellige garantier, og et
script kan opfylde den første uden den anden i årevis uden at nogen opdager
det — fordi mennesker læser stdout, men CI/agenter/`&&`-kæder læser $?. Enhver
ny scorecard/harness-fil med et HEADLINE-/gate-koncept skal bruge
`gateExitCode()` fra dag 1, ikke reimplementere `allPass ? 0 : 1` ad hoc (det
er præcis den reimplementering-uden-wiring der skabte bugget tre gange —
money-supply, inflation, sponsor-choice — på tværs af to separate PR'er). Ved
et backwards-check: søg IKKE kun efter navnet i issuet — grep hele
`scripts/`-træet for "HEADLINE"/"❌ FAIL"/"GUARD FAIL" og kryds mod
`process.exit`; det var sådan sponsorChoiceScorecard.js's uafhængige instans af
buggen blev fundet.
