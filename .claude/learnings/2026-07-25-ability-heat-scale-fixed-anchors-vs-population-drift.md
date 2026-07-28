# Postmortem · 2026-07-25 · Evne-varmeskalaen var fejl-ankret mod en forældet population

## Hvad skete der?
`statColor()` (den delte evne/rating-farvegradient) rendrede 90-96 % af ryttere på rigtige menneskehold som fladt gråt. Farveskalaen skulle hjælpe managere se hvilke evner en rytter er stærk i, men bar reelt ingen information i daglig brug (#2890).

## Root cause
To ting samtidig:
1. Skalaens ankre (grøn 42, gul 55, guld 64) blev sat 2026-06-19 til et ANTAGET snit (~40) for de nye CZ-evner, uden at måle den faktiske population. Ægte median er 12-16.
2. `statColor()` blev brugt til BÅDE rå enkelt-evne-værdier (median ~12) OG den normaliserede 1-99-rating (median ~21) gennem ét fælles anker-sæt — to væsensforskellige fordelinger kan ikke dele ét sæt knæk.

## Fix
`frontend/src/lib/statColor.js`: splittet i FIRE KNOTS-sæt (`ability`/`rating`/`staffAbility`/`staffRating`), alle re-ankret på faktisk målte percentiler (p75/p90/p97/p99,5) via read-only `execute_sql` mod prod. Toppen af gradienten flyttet fra pink/rød til rav/bronze (undgår kollision med `--danger`). 21 forbrugere gennemgået og korrekt mappet til den rigtige skala (PR #2992, commits cae951e3 + 1b73e322).

**Opfølgning samme session (kode-review-runde, ejer-krav 25/7):** det oprindelige udkast genbrugte rytter-skalaerne til staff og noterede afvigelsen som en åben restrisiko i stedet for at afgøre den. Ejeren afviste det: "kør fordelingen for staff mod prod ... afgør det konkret". Målt `staff_derived_abilities` (n=119, tier-bånd-genereret, HELT anden model end rytter-evner): enkelt-akse-median 55, overall-median 48 — begge over rytter-skalaens guld-anker. Genbrug havde IKKE fikset staff, bare spejlvendt bugget (næsten alt guld/apex i stedet for næsten alt gråt). Løsning: to ekstra skalaer (`staffAbility`/`staffRating`), samme metode.

## Forhindret-fremover
Ankrene er dokumenteret i selve filen som "tunable knobs, gen-fit ved sæsonskifte hvis populationen flytter sig markant" — samme mønster som `RATING_O_ELITE`/`RATING_O_MIN` i `riderRating.js`. `statColor.test.js` låser de nye anker-værdier (15 tests, 4 skalaer), så en fremtidig re-ankring er en bevidst, testet handling.

## Læring
En farve-/tærskel-konstant der er "kalibreret til populationen" rådner stille, uden fejl eller test-failure, når spillets balance ændrer sig — den fejler kun visuelt, og kun for den bruger der ser skærmen. To fordelinger må ALDRIG dele ét anker-sæt, selvom de begge er "et tal 0-99"; navngiv skalaen eksplicit i signaturen (`{ scale }`) i stedet for at overloade én funktion implicit. Og: "genbrug en anden populations skala fordi den ligner" er en antagelse, ikke en verifikation — samme fejl som selve issuet, bare på et andet datasæt. Mål FØR du genbruger, ikke kun før du opfinder noget nyt.
