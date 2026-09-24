# Tailwind-globben fulgte ikke med hard rule 31 (#5449)

**Dato:** 2026-09-20 · **Issue:** #5449 · **PR:** #5451

## Hvad gik galt

`frontend/tailwind.config.js` scannede kun `./src/**/*.{js,jsx}`. Hard rule 31
kræver at NYE frontend-filer skrives i `.ts`/`.tsx`. En Tailwind-klasse der kun
fandtes i en `.tsx`-fil blev derfor aldrig genereret, og elementet faldt tilbage
til browserens standard.

Den synlige konsekvens: træningsscorens sparkline
(`components/training/TrainingScoreSparkline.tsx`, #4851) mistede både
`fill-cz-subtle` og `stroke-cz-1`. SVG's standardfyld er sort og standardstregen
er ingen, så kurven blev tegnet som en **sort udfyldt klat** — live for
beta-gruppen på Daglig træning og på rytterprofilens Træning-fane.

Ti klasser i alt manglede, fordelt på seks `.tsx`-filer (fuld liste og
før/efter-billeder: `docs/audits/2026-09-20-5449/`).

## Hvorfor det slap igennem

1. **Fejlen er tavs på alle led.** Ingen build-warning, ingen lint-fejl, ingen
   typefejl. Klassen står i markup'en; den findes bare ikke i CSS'en.
2. **Regelskiftet og configen hang ikke sammen.** Hard rule 31 blev indført som
   en kode-regel. `content`-globben er en *build*-liste over filendelser og var
   ikke nævnt noget sted i reglen, så ingen havde grund til at røre den.
3. **De ramte flader er unge og bag flag.** Sparklinen (#4851) og
   mobil-træningstabellen (`training_mobile_table`) har ingen
   `*.spec.js`-dækning og indgår ikke i de fire snapshot-suiter, så hverken CI
   eller ejerens daglige brug ramte dem.
4. **Sort på hvidt ligner ikke altid en fejl i et review.** Diffen på PR'en der
   indførte `.tsx`-filen var korrekt; fejlen opstod et helt andet sted i repoet.

## Samme fejlklasse som #5150

`#5150` var præcis samme *symptom* — en klasse markup'en beder om, som Tailwind
aldrig genererer — men en anden *årsag* (farvetokens uden plads til
`<alpha-value>`). Det er nu to gange, så klassen "markup beder om en klasse der
ikke findes i CSS'en" fortjener sin egen guard-familie i stedet for en guard pr.
årsag.

## Forward-guard

`frontend/tailwind.config.test.mjs` (samme fil som #5150-guarderne):

- **Fil-drevet, ikke liste-drevet.** Testen går ud fra filerne: enhver fil under
  `frontend/src` der indeholder `className`/`class=` SKAL matches af mindst én
  glob i `content`. Dukker `.mts`, `.svelte`, `.astro` op i morgen, fejler
  testen — ingen skal huske at opdatere en liste her.
- **Plus et eksplicit gulv** på `js/jsx/ts/tsx`, så globben ikke stille og
  roligt kan skrumpe igen når den sidste `.tsx`-fil på en flade forsvinder.

Begge tests blev verificeret ved at rulle globben tilbage: de fejler på den
gamle glob og passerer på den nye.

## Hvad jeg tager med

- **En regel om hvordan kode SKRIVES skal følges af en søgning efter hvad der
  LÆSER koden.** Hard rule 31 rørte ved mindst tre læsere: Tailwinds `content`,
  ESLint-globs og lint-staged-mønstre. Kun den første var ødelagt her, men
  eftersøgningen hørte til dengang reglen blev skrevet.
- **En build-konfiguration der nævner filendelser er en hard-coded liste.** Den
  skal have en guard der udleder listen fra virkeligheden, ikke gentager den.
- **Mål før/efter i stedet for at antage omfanget.** Issuet gættede på fire-fem
  ramte flader. To builds og en CSS-diff gav den præcise liste — ti klasser, seks
  filer — og afkræftede samtidig en af mistankerne ("Alle handler"-fanen var
  uændret, byte for byte).
