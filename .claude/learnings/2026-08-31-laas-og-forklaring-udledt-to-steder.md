# Låsen og forklaringen blev udledt to forskellige steder (#3410)

Dato: 2026-08-31 (Europe/Copenhagen) · Issue: #3410 · Filer: `frontend/src/lib/raceHubLogic.js`

## Symptom

En spiller (Discord #bugs, 5/8) fandt sin bedste spurter udenfor to løb og huskede
at rytteren så **låst** ud da han lavede holdudtagelsen. Standardforklaringen
"overlap med et andet løb" blev prøvet i tråden og afvist af rapportøren. Han
havde ret.

## Rod-årsag

To parallelle udledninger af det samme:

- **Låsen** i `AvailableRidersPool.jsx` var `!columns.some(canAddRiderToColumn)`.
  `canAddRiderToColumn` siger nej af **fire** grunde: løbet er afmeldt, løbet er
  startet (`lineup_locked`), rytteren står allerede i kolonnen, eller rytteren er
  bundet i et overlappende løb.
- **Forklaringen** kom fra `boundRace`, som kun kunne udfyldes af et løbsnavn:
  enten en ikke-afmeldt kolonne rytteren stod i, eller en ekstern binding der
  bar et navn med. Kun overlap-grenen producerede altså tekst.

Ramte låsen en af de to andre grunde, blev `boundRace` `null`, og chippen blev
renderet med hængelås, stiplet kant og `opacity-60` uden en eneste begrundelse.
Stod brættet på en dag hvor alle viste løb var startet eller afmeldt, låstes
HELE truppen tavst, mens bundteksten `racehub.pool.bound` stadig påstod at låsen
betød "optaget i et overlappende løb".

Det er ikke en genkomst af #3041 (dér var selve bindingerne forkerte efter
sæsonskiftet). Her er bindingerne rigtige; det er forklaringslaget der kun
dækkede en fjerdedel af årsagerne.

## Fix

`riderColumnState` er nu den eneste klassifikator, og `canAddRiderToColumn` er
dens boolske skygge (`=== "available"`). Oveni den er der en ren
`riderLockReason({ riderId, columns, bindingMap })` der returnerer `null` eller
en årsagskode (`bound_overlap` med løbsnavn, `all_races_started`,
`all_races_withdrawn`, `all_races_unavailable`), plus `riderLockLabel` der samler
i18n-nøglevalget ét sted. Nye nøgler i en+da, og `racehub.pool.bound` siger ikke
længere "overlap" om en lås der kan skyldes tre andre ting.

## Læring

**En tilstand og dens forklaring skal komme fra samme udledning.** Bliver et
prædikat kopieret til to steder — ét der beslutter, og ét der forklarer — går de
fra hinanden i præcis de grene ingen har testet, og brugeren står med et UI der
enten tier eller lyver. Kuren er ikke en ekstra if-sætning i visningen, men at
gøre den forklarende funktion til kilden og lade det booleske svar være afledt
af den.

**Forward-guard:** matrix-test i `raceHubLogic.test.js` over 64 bræt-varianter x
2 ryttere som asserterer at (1) lås og årsag altid er enige, (2) hver låst rytter
får en ikke-tom tekst, og (3) `canAddRiderToColumn` pr. kolonne er identisk med
`riderColumnState(...) === "available"`. Plus en test der slår hver årsagsnøgle
op i både `en` og `da` races.json, så en kode uden oversættelse ikke kan ramme
UI'et som rå nøgle.
