# 2026-08-05 — academyGraduation.js resolveGraduation() gentog #2881-buggen

## Root cause

PR #2929 (25/7) fixede #2881 i `backend/lib/academyTransfer.js` `promote()`
(den MANUELLE akademi-op/ned-knap): funktionen overskrev ubetinget en
eksisterende kontrakt i stedet for at bruge `contractOnAcquirePatch`. Fixen
ramte kun ÉN af to steder i kodebasen der udfører "akademirytter → senior"
med kontraktskrivning.

`backend/lib/academyGraduation.js` `resolveGraduation()`'s `promote`-gren
(det AUTOMATISKE graduerings-flow ved alder 22) havde PRÆCIS samme mønster —
ubetinget `salary`/`contract_length`/`contract_end_season`-overskrivning —
og blev IKKE rørt af #2929, fordi det er en anden funktion i en anden fil.
Kode-kommentaren begrundede overskrivningen med "ejer-beslutning 3" fra
`docs/superpowers/specs/2026-06-18-academy-promotion-flow-design.md` — men
den beslutning handlede om HVILKEN løn-formel en NY kontrakt skal bruge
(genbrug #1309 kontrakt-seed-formlen, ikke en ny balance-flade), ikke om
hvorvidt en eksisterende kontrakt må overskrives ubetinget. Fejllæsning af
en gammel spec-note, ikke en bevidst undtagelse fra #1309-invarianten.

## Hvorfor det blev overset i den første fix

#2929s undersøgelse fandt bug-signaturen via `notifications.type=
'academy_promoted'` — den notifikations-type sendes KUN af
`academyTransfer.js promote()`, ikke af `resolveGraduation()` (som sender
`type='academy_graduated'` med `metadata.messageCode='notif.academyGraduated.
promote'`). To adskilte audit-spor for to adskilte bugs, samme rod-årsags-
mønster. En generisk "søg efter alle steder der skriver `contract_length`
uden at gå via `contractOnAcquirePatch`" ville have fanget begge på én gang.

## Tredje følgefund (samme session, ingen prod-skade endnu)

`resolveGraduation()`'s `release`-gren (graduering → "slip") satte
`team_id=null, is_academy=false` men rørte IKKE `salary`/`contract_length`/
`contract_end_season` — i strid med `contractSeed.js`'s dokumenterede
invariant ("kontrakter kun på ejede ryttere, free agents = NULL"). En fri
agent med en stale ikke-null kontrakt ville få `contractOnAcquirePatch` til
fejlagtigt at "arve" den gamle akademi-kontrakt ved en senere
auktion/transfer i stedet for at give en frisk. 0 rækker i prod har status=
'released' i `academy_graduation` endnu (ingen spiller har brugt "slip" på
en graduate), så ingen data-reparation var nødvendig — rent proaktivt fix.

## Fix

`backend/lib/academyGraduation.js`:
- `resolveGraduation()` promote-gren: genbruger nu `contractOnAcquirePatch`
  (samme gate som `academyTransfer.js promote()` + al anden erhvervelse).
- `resolveGraduation()` release-gren: nuller nu `salary`/`contract_length`/
  `contract_end_season`, samme mønster som `contractExpiryRelease.js`/
  `retirementRelease.js`.
- Regressionstests i `academyGraduation.test.js` låser begge fast.

## Data-reparation (prod, 5/8, IKKE kørt)

22 ryttere har `academy_graduation.status='promoted'` (audit-spor). Af dem:
- 12 har et deterministisk sporbart akademi-indtrædelses-tidspunkt (intake
  eller demote, sæson 1) OG viser stadig bug-signaturen (`contract_length=2`)
  → `database/proposals/2026-08-05-2881-academy-graduation-promote-contract-
  repair.sql` retter KUN `contract_length` (2→3); `contract_end_season`
  krævede ingen ændring (var allerede 3 ved et sammenfald mellem
  `computeContractEndSeason(1,3)` og den buggede `computeContractEndSeason
  (2,2)`, som begge giver 3).
- 6 viser stadig bug-signaturen men har INGEN sporbar indtrædelses-hændelse
  → kan ikke repareres med sikkerhed, flagget til ejer-beslutning.
- 4 er allerede selv-helet via en efterfølgende uafhængig hændelse.

Salary er IKKE rekonstruerbart for nogen af de 22 (ingen kolonne-historik) —
samme begrundelse som i den oprindelige #2881-reparation.

Den OPRINDELIGE #2881-reparation (`2026-07-25-...-repair.sql`) blev også
gen-kvantificeret denne session: 48 → 22 ramte ryttere (26 selv-korrigeret
via spiller-initieret kontraktforlængelse i de mellemliggende 11 dage).
Filen og dens post-verify-forventninger er opdateret til de friske tal.
Fortsat IKKE kørt — afventer ejer-godkendelse. #2744-uret løber: sæson 2 er
aktiv, og disse ryttere har `contract_end_season=2` — de frigives fejlagtigt
som fri agent ved S2→S3-overgangen medmindre reparationen køres inden da.

## Læring til fremtidige "fix denne kontrakt-bug"-opgaver

Når en kontrakt-invariant (#1309: "eksisterende kontrakt arves uændret,
regenerér ALDRIG") brydes ét sted, søg efter ALLE steder der skriver
`contract_length`/`contract_end_season`/`salary` direkte i stedet for via
`contractOnAcquirePatch`, ikke kun det ene sted bug-rapporten pegede på.
`grep -rn "contract_end_season:" backend/lib` (ekskl. `contractSeed.js`
selv + `contractOnAcquirePatch`-callers) er et billigt første skridt.
