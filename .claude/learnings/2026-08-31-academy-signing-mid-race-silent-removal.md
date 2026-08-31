# Et flag der styrer loebs-berettigelse maa ikke flippe midt i et loeb uden et vaern

**Dato:** 2026-08-31 · **Issue:** [#4423](https://github.com/NicolaiDolmer/CyclingZone/issues/4423) (udskilt fra [#4418](https://github.com/NicolaiDolmer/CyclingZone/issues/4418) rod-aarsag B) · **Fundet af:** daglig Sentry/Railway-triage 30/8

## Hvad skete der

3 ryttere (alle Wander Riders) forsvandt fra Giro della Penisola / Tour of South
Australia efter etape 2 — samme symptom som #4418's rod-aarsag A (injury-DNS, PR #4422),
men en anden mekanisme: en akademikontrakt blev skrevet paa en kandidat der i
mellemtiden var landet paa signeringsholdets EGEN seniortrup, mens et af holdets
etapeloeb koerte. `finalize_academy_acquisition` satte `is_academy=true` med det
samme; `isEligibleRider` afviser akademiryttere; `filterEligibleEntries` smed ham
derfor ud af feltet paa naeste etape-build — ingen advarsel, ingen registrering.

## Laeringen

**Samme klasse fejl som #4418, to gange i traek.** Et boolean-flag (`is_academy`,
`is_retired` samme princip) der styrer race-eligibility maa ALDRIG flippe midt i et
igangvaerende loeb uden enten (a) udskyde flippet til loebet er slut, eller (b) blokere
handlingen mens loebet koerer. `stageRaceTransferDefer` (#1995) loeste det for
`team_id`-flytninger over et aar foer denne fejl blev maalt — moensteret fandtes
allerede, men blev ikke spejlet til akademi-stien foer #4423 tvang det.

**Ejerens egen kommentar paa #4418 pegede direkte paa loesningen:** "en handel der
flytter en rytter vaek fra et loeb han er i gang med, haandteres allerede korrekt af
stageRaceTransferDefer (#1995) — akademi-stien mangler det vaern." Naar en fix-retning
allerede er artikuleret et sted i traaden, er opgaven at SPEJLE moensteret praecist
(genbrug `getRidersInActiveStageRace`, samme "handel nu, flytning senere"-princip),
ikke at opfinde en ny mekanik fra bunden.

## Forward-guard

- `finalize_academy_acquisition` (RPC) beregner nu `v_defer` FOER selve rytter-
  update'en, og lader `is_academy` staa uroert naar den er sand — betaling/kontrakt
  sker stadig med det samme (samme "handel nu"-halvdel af #1995's princip).
- `riders.pending_academy_signing` (ny kolonne) er den ENESTE tilstand der bæres
  mellem signering og flush — ingen ny tabel, genbruger `academy_intake.status='signed'`
  uaendret (kontraktligt ER signeringen faerdig; kun berettigelsen venter).
- `flushDeferredAcademySigningsForRace` (academySigningDefer.js) kaldes fra de SAMME
  to steder i raceRunner.js som #1995's flush — normal-sti og recovery-sti — saa den
  aldrig kan glemmes ved et crash mellem stages_completed-bump og finalization.

## Beslaegtet, IKKE fixet her

`demote_rider_to_academy` (academyTransfer.js's demote-flow, senior → eget akademi via
holdsiden) har PRAECIS samme mangel — kommentaren ved linje 210-213 i academyTransfer.js
(#3805) anerkender det allerede: RPC'en rydder kun `status='scheduled' AND
stages_completed=0`-entries og lader rytteren falde stille ud af et igangvaerende loeb.
Egen sag, egen fix — flagget som opfoelgning, ikke rettet i denne PR (#3805 daekker
det allerede, saa intet nyt issue oprettet).
