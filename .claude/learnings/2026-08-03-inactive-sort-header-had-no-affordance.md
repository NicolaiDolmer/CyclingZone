# 2026-08-03 — Inaktiv sorterbar kolonne-header havde ingen affordance (#3188)

## TL;DR
Fik opgaven "byg en app-bred konvention for sorterbare kolonne-headere" (#3188, /team dead-clicks). Konventionen fandtes ALLEREDE fuldt udbygget: `DataTable.jsx`/`SortableTh.jsx`/`Table.jsx` + `useTableSort.js` + en guard-test (`tableSortIntent.test.js`) der scanner ALLE tabeller og kræver `data-sortable`/`data-sort-exempt`. Byggede IKKE et duplikat. Den ene reelle rest-krølle: `SortIndicator` returnerede `null` for en inaktiv sorterbar kolonne — intet ikon, kun cursor+hover-farve (usynligt på touch). Fixede den ene funktion; effekten ruller automatisk ud til hele appen fordi alle forbrugere allerede deler samme `SortIndicator`.

## Konkret kontekst
Batch-opgave nævnte at "en tidligere worker flagede at kolonne-headere ligner klikbare sorterings-kontroller men intet gør". PR #3241 (samme issue, anden fil — `/team` tab-fix) havde allerede undersøgt dette dybere og konkluderet at kolonne-headers er "ægte, korrekt byggede" — men den konklusion var begravet i en PR-body, ikke i en let-tilgængelig doc.

Kodesøgning (`grep -ril DataTable`, `aria-sort`, `useTableSort`) fandt hele konventionen på under 10 minutter: sortRows (stabil, numerisk vs. streng), cycleSortState (toggle-cyklus), SortableTh (delt header, aria-sort), og en guard-test der allerede kørte grønt på main.

## Hvad jeg gjorde rigtigt
- Kørte guard-testen FØR jeg skrev kode (`node --test src/tableSortIntent.test.js` — grøn på main).
- Læste PR #3241's fulde body (`gh pr view 3241`) i stedet for kun issue-titlen — den indeholdt den reelle konklusion.
- Stoppede med at "bygge konventionen" da beviset viste den fandtes; ledte i stedet efter det MINDSTE reelle gab.

## Rod-fund
`SortIndicator` (components/ui/SortableTh.jsx): `if (!active) return null`. En sorterbar-men-ikke-aktiv kolonne havde derfor NUL visuel forskel fra en almindelig header ud over cursor-pointer + `hover:text-cz-2` — usynligt på touch (intet hover), let overset på desktop. Det er den reelle rest af "ligner en kontrol, men uklart hvad der sker".

**Fix:** Vis en dæmpet to-vejs-pil (eksisterende, ubrugte `SortIcon`) på inaktive sorterbare kolonner; behold den skarpe retningspil for den aktive. Étsteds-ændring — DataTable/Table.Th/SortableTh/RiderSortTh kalder alle samme `SortIndicator`.

## Forward-guard
1. Før "byg X app-bredt": `grep -ril <ComponentName>` + kør evt. guard-tests FØR du antager X mangler. En issue-titel er ikke bevis for kodens nuværende tilstand.
2. En PR-body kan indeholde den reelle rod-årsags-konklusion for et beslægtet issue — læs `gh pr view <N>` fuldt, ikke kun titel/labels.
3. `.test.js`-filer i dette repo kører via rå `node --test` (ingen JSX-loader) — komponent-tests skal enten bruge kilde-tekst-assertions (`readFileSync` + regex, mønster: `*.source.test.js`) eller `React.createElement` (ikke JSX) + `renderToStaticMarkup`. Import af en `.jsx`-fil direkte i en `.test.js` fejler med `ERR_UNKNOWN_FILE_EXTENSION`.

## Bør i HOT memory?
Nej — engangs-mønster (denne specifikke opgave). Kan promoveres hvis "antag manglende feature uden kodesøgning" gentager sig.
