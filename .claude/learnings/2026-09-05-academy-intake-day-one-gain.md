# 2026-09-05: nyt akademi-intake fik utilsigtet ekstra traeningsgevinst (#4750)

## Symptom
Spiller (thelamba, Discord 3/9) saa +5 samlet i sprint+acceleration paa en
akademi-rytter hentet faa dage foer, hvoraf +2 kom fra ÉN traeningskoersel. Ejer
bekraeftede utilsigtet samme dag.

## Rod-aarsag
IKKE dobbelt-anvendelse (verificeret: `signAcademyCandidate` skriver aldrig
ability-felter) og IKKE et race-day-development-leak (verificeret: D1/D2-gaten i
`dailyTrainingEngine.js` er korrekt gensidigt udelukkende med den normale tick).

Rod-aarsagen er samspillet mellem to hver-for-sig-korrekte, ejer-godkendte
beslutninger, der aldrig blev simuleret SAMMEN mod den ekstreme case "dag 1 for
en frisk rytter":

1. #3709 trin 5 (14/8): fjernede det generelle daglige spring-loft for ALLE
   aldre - en bevidst, dokumenteret, "baerende" beslutning (ikke oprydning).
2. `youthMultiplier` (op til 1,5x ved intake-alderen 16) - uaendret siden foer da.

En rytter erhvervet PRAECIS i dag (akademi-signing/transfer/auktion) har sit gap
(`ability_caps[evne] - nuvaerende evne`) paa sit LIVSTIDSMAKSIMUM - den eneste
dag i karrieren det er tilfaeldet, fordi gapet kun bliver mindre herefter.
Kombineret med et veludviklet hold (facilitet + specialiseret traener) og
manager-selv-klik-bonussen kan denne ene dag krydse fremdrifts-baren to gange
for én evne (+2), noget der reproduceredes i test med #3709 trin 5's egne
grænseparametre (pot 6, akademi-alder, hard intensitet, manager-bonus) plus
staff/facilitets-bonus.

## Fejlen der skete
`#3709`'s kalibrering maalte medianer over en HEL population/karriere og
konkluderede korrekt at "intet loft" er trygt der. Ingen sim isolerede den
SNAEVRE, éngangs-case "dag 1 efter erhvervelse", hvor gapet er structurally
anderledes (maksimalt) end enhver anden dag i karrieren.

## Fix
`dailyTrainingEngine.js` sender nu `hardDailyCap: 1` (en eksisterende, men hidtil
ubrugt parameter i `dailyTraining.js`) UDELUKKENDE naar `riders.acquired_at`'s
danske kalenderdato matcher `tick_date`. #3709 trin 5's beslutning for resten af
karrieren er urørt - bevist i test ved at koere PRAECIS samme scenarie en dag
senere og faa gains=2 uden cap.

## Aabent / ikke løst her
Prod-maaling (`backend/scripts/measure4750AcademyIntakeGain.mjs`) viste at ingen
af de 41 S3-akademi-signeringers foerste `rider_derived_ability_history`-raekke
falder paa selve erhvervelsesdagen - historik skrives kun ved en tick MED
gevinst, saa den rapporterede gevinst kom formentlig et par dage EFTER
signering (bar-akkumulering over flere dage, ikke noedvendigvis dag 1 bogstaveligt).
Den snaevre "erhvervelsesdag"-gate her daekker derfor det VAERSTE enkelt-dags-
tilfaelde (bevist i test), men daekker formentlig ikke praecis den dag thelamba
saa gevinsten paa. En bredere "stadig meget frisk" (N dage siden erhvervelse) gate
er en balance-afvejning der kraever ejer-go, ikke noget der er besluttet
unilateralt her - se PR #4750-body's "Aabent spoergsmaal".

## Laering
En "no cap er trygt" konklusion baseret paa population-medianer daekker ikke
automatisk edge-casen "dag 1 efter erhvervelse", fordi gapet der er strukturelt
anderledes end resten af karrieren. Naeste gang en sådan beslutning tages: sim
eksplicit den forste-dag-efter-erhvervelse-case saerskilt fra career-medianen.
