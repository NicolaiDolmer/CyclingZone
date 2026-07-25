# Postmortem · 2026-07-25 · Evne-varmeskalaen var fejl-ankret mod en forældet population

## Hvad skete der?
`statColor()` (den delte evne/rating-farvegradient) rendrede 90-96 % af ryttere på rigtige menneskehold som fladt gråt. Farveskalaen skulle hjælpe managere se hvilke evner en rytter er stærk i, men bar reelt ingen information i daglig brug (#2890).

## Root cause
To ting samtidig:
1. Skalaens ankre (grøn 42, gul 55, guld 64) blev sat 2026-06-19 til et ANTAGET snit (~40) for de nye CZ-evner, uden at måle den faktiske population. Ægte median er 12-16.
2. `statColor()` blev brugt til BÅDE rå enkelt-evne-værdier (median ~12) OG den normaliserede 1-99-rating (median ~21) gennem ét fælles anker-sæt — to væsensforskellige fordelinger kan ikke dele ét sæt knæk.

## Fix
`frontend/src/lib/statColor.js`: splittet i to KNOTS-sæt (`ability`/`rating`), begge re-ankret på faktisk målte percentiler (p75/p90/p97/p99,5) via read-only `execute_sql` mod prod. Toppen af gradienten flyttet fra pink/rød til rav/bronze (undgår kollision med `--danger`). 8 forbrugere gennemgået og korrekt mappet til den rigtige skala (PR #2992, commit cae951e3).

## Forhindret-fremover
Ankrene er dokumenteret i selve filen som "tunable knobs, gen-fit ved sæsonskifte hvis populationen flytter sig markant" — samme mønster som `RATING_O_ELITE`/`RATING_O_MIN` i `riderRating.js`. `statColor.test.js` låser de nye anker-værdier, så en fremtidig re-ankring er en bevidst, testet handling.

## Læring
En farve-/tærskel-konstant der er "kalibreret til populationen" rådner stille, uden fejl eller test-failure, når spillets balance ændrer sig — den fejler kun visuelt, og kun for den bruger der ser skærmen. To fordelinger må ALDRIG dele ét anker-sæt, selvom de begge er "et tal 0-99"; navngiv skalaen eksplicit i signaturen (`{ scale }`) i stedet for at overloade én funktion implicit.
