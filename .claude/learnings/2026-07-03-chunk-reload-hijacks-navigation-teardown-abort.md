# 2026-07-03 · Chunk-reload-nettet kaprede ægte navigationer (mobile-webkit e2e-flake)

**Issue:** #2145 · **Relateret:** #906/#881 (chunk-reload-nettet), #1342 (webkit droppet i CI)

## Symptom

`core-smoke.spec.js` flakede intermitterende på mobile-webkit lokalt (Windows): 1-2 tests
pr. fuld kørsel, skiftende hvilke, med `page.goto: Navigation to ".../dashboard" is
interrupted by another navigation to ".../dashboard"` (eller "Frame load interrupted").
Pre-existing på både main og feature-branches.

## Rodårsag

En navigation (page.goto / rigtig bruger der forlader siden) aborterer det gamle dokuments
igangværende lazy-chunk-loads. WebKit melder aborten med PRÆCIS samme fejltekst som en ægte
stale chunk efter deploy: `Importing a module script failed`. Vites preload-helper dispatcher
`vite:preloadError`, og `installChunkReloadHandlers` (#906) fyrede `window.location.reload()`
**synkront i det døende dokument** → reload-navigationen kapløb med den ægte navigation og
vandt nogle gange. Ikke kun et test-problem: en rigtig bruger kunne få sin navigation kapret.

Testfilen kendte allerede fejlsignaturen (`WEBKIT_DEV_NOISE`-filteret) — men filtrerede kun
**assertion-siden** (pageerror-listen). **Bivirkningen** (reload) levede videre. En
klassiker: da fejlen blev "håndteret", blev kun den synlige halvdel håndteret.

## Diagnose-metode (genbrugelig)

1. Symptomet "goto afbrudt af navigation til SAMME url" ⇒ noget kalder reload/location-nav.
   Grep alle `window.location.reload|href=|assign|replace` — kun 3 reload-stier fandtes,
   alle bag samme sessionStorage-guard-nøgle (`cz:chunk-reload-attempted:<release>`).
2. Instrumenteret repro-spec (passiv): log `vite:preloadError`/`unhandledrejection`/pagehide
   med page-side timestamps + `--repeat-each=25`. Baseline: 3-5/25 fejl, altid preloadError
   x2 lige før pagehide.
3. **Kausalt eksperiment:** presæt guard-nøglen i et init-script (deaktiverer alle
   reload-stier uden kodeændring) → 0/25 fejl selvom preloadError stadig fyrede. Bekræftet.
4. Fix → 25/25 grønne + fuld core-smoke 27/27 på alle 3 projekter.

**Fælde undervejs:** man kan IKKE wrappe `sessionStorage.setItem` ved property-assignment —
Storage-objekter har named setters, så `sessionStorage.setItem = fn` gemmer bare en item med
nøglen "setItem". Durable logging til localStorage + kausale eksperimenter er mere robust.

## Fix

`installChunkReloadHandlers` udskyder reload'en (`delayMs` = 250 ms) og dropper den hvis
dokumentet unloader (`pagehide`-flag; bevidst IKKE `beforeunload`, som kan koste bfcache).
Ved teardown dør timeren med dokumentet. Guard-nøglen brændes først ved fire-time, så en
teardown-abort ikke bruger release'ens ene reload. `pageshow` gen-åbner recovery efter
bfcache-restore. Pinned af node-unit-tests (teardown-abort + bfcache-scenarie).

## Læringer

- **Auto-recovery med sideeffekter skal kende dokumentets livscyklus.** Alt der reagerer på
  fejl med navigation/reload skal spørge "er denne fejl bare et symptom på at siden er ved
  at dø?" Abort-fejl og ægte fejl kan have identisk fejltekst.
- **Et støjfilter i tests er et hint om en uhåndteret bivirkning i appen.** WEBKIT_DEV_NOISE
  dokumenterede fejlen for assertions men lod produkt-bivirkningen leve.
- **Kausalt eksperiment > korrelation:** presæt guarden → flake væk beviste kilden uden at
  røre produktkoden.
