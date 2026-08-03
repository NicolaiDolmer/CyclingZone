# Postmortem · 2026-08-03 · Trænings-"Begrænset"-label brugte en forældet model

## Hvad skete der?
Spillere i Discord rapporterede at trænings-fladens "Begrænset"/"Blokeret"-labels
modsagde en rytters viste (høje) potentiale — arbejdshypotesen var "ignorér
UI'et". Issue #3195 bad om at afklare hvad labelen faktisk gør i motoren.

## Root cause
`focusTrainability()` (backend/lib/training.js) beregnede UI-labelen med
`signatureFactor(primaryType, ability)` + `PROGRESSION_CONFIG` — en model der (a)
kun kendte rytterens PRIMÆRE type (ignorerede `secondary_type` helt) og (b) brugte
tre tier-konstanter (1.0 / offTypeHeadroomFactor 0.35 / 0). Men den model blev
konsolideret væk 2026-07-15 (#2472-relateret ejer-beslutning i
`buildCapsForRider`): det RIGTIGE livstidsloft for ALLE ryttere (uanset alder)
beregnes siden af `buildYouthCaps`/`youthRoleFactor` (primær 1.0 / sekundær 0.82 /
neutral 0.45 / modsat 0.12), og bruges live af BÅDE `dailyTrainingEngine.js` og
`riderProgressionEngine.js`. `focusTrainability` blev aldrig opdateret til at
følge med — den blev en glemt kopi af en model motoren ikke længere kører på.

Konkret prod-verifikation (read-only SELECT, ghwvkxzhsbbltzfnuhhz): rytter
"Oliver Doyle" (primary=tt, secondary=sprinter, potentiale 6.0) fik labelen
"Begrænset" på Sprint-fokus, mens `rider_derived_abilities.ability_caps` i DB
viste sprint=72/acceleration=72 (= 88 × 0.82, hans SEKUNDÆRE sprinter-type
løftede loftet næsten til fuldt niveau) — labelen var objektivt forkert, ikke
bare "utydelig".

## Fix
`focusTrainability(primaryType, secondaryType, cfg = YOUTH_PROGRESSION_CONFIG)`
bruger nu `youthRoleFactor` (samme model som `buildCapsForRider`), med
tærskler `>= naturalSecondaryFactor` → "strength" og `<= oppositeFactor` →
"blocked". `backend/routes/api.js` sender nu `secondary_type` med til
`/api/training/me`. `smartDefaultFocus` (auto-fokus-VALG for ryttere uden plan,
balance-følsom for hele populationen) er BEVIDST holdt uændret via en privat
`legacyPrimaryTypeTier`-kopi af den gamle model — at gøre DEN sekundær-type-
bevidst er en separat, større beslutning (ændrer hvilket fokus tusindvis af
ryttere auto-trænes med) og kræver egen dry-run, ikke et biprodukt af en
UI-label-rettelse.

## Forhindret-fremover
Ny test `training.test.js`: "#3195 — sekundær type rescuer et fokus primærtypen
alene ville vise som begrænset" (tt+sprinter → sprint skal være "strength", ikke
"limited") forward-guarder præcis denne klasse af regression. Tooltip/help.json
opdateret med KONKRETE procenttal (82%/45%/12%) i stedet for vage ord, så en
fremtidig model-drift er lettere at opdage visuelt (tallene bliver synligt
forkerte, ikke bare "vagt utilfredsstillende").

## Læring
Når en motor konsolideres til ÉN kanonisk model (som #2472's
`buildCapsForRider`-unifikation), skal ALLE forbrugere af den gamle model
opdateres eksplicit — inkl. rene UI-diagnostik-labels der ikke selv rører
gameplay-tal. Et "coarse UI-hint" der stille refererer den forkerte
konfigurations-konstant er lige så farligt for spiller-tillid som en reel
beregningsfejl, fordi spilleren ikke kan skelne "forkert label" fra "forkert
motor" — begge læses som "spillet lyver".
