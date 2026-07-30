# Postmortem · 2026-07-30 · Squad-risiko-spærren virkede, men var usynlig for manageren

## Hvad skete der?
@soren1207 rapporterede i Discord 27/7 at han ikke kunne sælge en "rask" rytter,
selvom han havde 8 senior-ryttere uden for risiko. Fejlbeskeden (`cannot_auction_squad_risk`)
sagde kun "du må ikke komme under 8 ryttere" — den nævnte aldrig HVILKE ryttere
guarden talte som "i risiko". Prod-scorecard 27/7 viste ~60% af hold (95/159)
ramte præcis denne blinde vinkel dag 1 i S2.

## Root cause
Guarden (#2748, `backend/lib/squadRiskGuard.js` + `marketUtils.getSquadRiskViolation`)
var korrekt implementeret og korrekt matematik — men to kommunikations-huller
gjorde den uforklarlig:
1. `fetchAtRiskCount` (api.js) hentede kun et TAL, aldrig rytter-rækkerne, så
   fejlbeskeden kunne ikke navngive nogen.
2. TeamPage.jsx (hvor salg besluttes) manglede badges for begge risiko-mekanismer
   (retireRisk fandtes kun på auktionskort/rytterprofil; kontrakt-udløb-badge
   fandtes slet ikke).

## Fix
- Ny `fetchAtRiskRiders` (squadRiskGuard.js) — samme fetch+filter som
  `fetchAtRiskCount`, men returnerer rytter-rækkerne. Ny ren `buildAtRiskErrorParams`
  udleder `{ minRiders, atRiskCount, atRiskNames }` til errorParams.
- `backend/routes/api.js`: auction-start (~4627) + release (~1244) bruger nu
  `fetchAtRiskRiders` + `buildAtRiskErrorParams` i stedet for kun tallet.
- `errors.json` (en+da): `cannot_auction_squad_risk`/`cannot_release_squad_risk`
  navngiver nu de tællende ryttere.
- Ny `contractExpiringBadgeKey` (frontend/src/lib/riderAge.js), genbruger det
  eksisterende `retirementRiskBadgeKey`-mønster — begge nu vist i TeamPage's
  badge-kolonne.
- INGEN ændring af guardens tærskel eller at-risk-definition (ejer-designspørgsmål,
  behandles separat — se issuets "sekundære spørgsmål").

## Forhindret-fremover
- Backend-tests dækker `fetchAtRiskRiders`/`buildAtRiskErrorParams` isoleret
  (squadRiskGuard.test.js).
- Strukturelle frontend-tests (TeamPage.squadTable.test.js) verificerer at begge
  badge-helpers faktisk er wired ind i badge-kolonnen, ikke kun eksporteret.

## Læring
En blokerings-guard er kun så god som dens forklaring — en korrekt spærre der
IKKE viser sit input (hvilke ryttere, hvor mange) læses af spilleren som en bug,
ikke en regel. Når en ny "tæller X mod dig"-mekanik shippes (som #2748), skal
UI'et der VISER de tællende objekter følge med i SAMME PR, ikke en opfølgning.
