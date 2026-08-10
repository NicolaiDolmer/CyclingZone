# Stale-chunk-recovery kaprede navigationer — en temporal guard hvor der skulle have været en kausal

**Dato:** 2026-08-10
**Issue:** [#3602](https://github.com/NicolaiDolmer/CyclingZone/issues/3602) · **PR:** #3524 (#3429)
**Beslægtet:** [#1342](https://github.com/NicolaiDolmer/CyclingZone/issues/1342), [#881](https://github.com/NicolaiDolmer/CyclingZone/issues/881), [#906](https://github.com/NicolaiDolmer/CyclingZone/issues/906)

## Hvad skete der

`frontend-smoke` var rød på #3524 (mobile-webkit tilbage i CI): 8 failed, 40 flaky.
64 log-linjer med samme form:

```
Navigation to "/academy" is interrupted by another navigation to "/dashboard"
```

Målruten varierede; den afbrydende navigation var **altid** `/dashboard` — den URL
siden allerede stod på. Det var ikke en router-redirect. Det var et `location.reload()`.

Kæden: `login()` → app'en lander på `/dashboard`, hvis lazy chunk stadig loader →
testen kalder `page.goto("/academy")` → browseren aborterer det gamle dokuments
chunk-loads → **WebKit melder aborten med præcis samme fejlstreng som en ægte stale
chunk** → stale-chunk-recovery reloader `/dashboard` → den igangværende navigation
bliver kapret.

## Rodårsagen bag rodårsagen

Recovery-koden *vidste* allerede det her. `chunkErrors.js` havde en 12-linjers
kommentar der beskrev præcis denne fejlmode og en guard imod den. Guarden var bare
**temporal**: udskyd reload'en 250 ms og afbryd hvis `pagehide` når at fyre først.
Det er et gæt på hvor lang tid en document-commit tager.

Målt med kunstigt forsinket commit:

| Hændelse | t |
|---|---|
| chunk-abort (`vite:preloadError`) | +0 ms |
| error-boundary'ens reload | **+39 ms** |
| den udskudte reload | **+250 ms** |
| commit / `pagehide` | **+1463 ms** |

To ting var galt:

1. **Den ene sti havde slet ingen guard.** Deferralen blev bygget ind i
   `installChunkReloadHandlers`, men error-boundary'en i `sentry.jsx` kaldte stadig
   `window.location.reload()` synkront i sin effect. Fixet blev lagt ét sted, mens
   fejlmoden fandtes to steder.
2. **Gættet var forkert på CI.** På en hurtig maskine committer den nye side under
   250 ms, og guarden holder ved et tilfælde. På CI-runneren gør den ikke.
   Derfor: grøn lokalt, rød i CI — 376/376 lokalt hos PR-forfatteren, 8 failed i CI.

## Fixet

Erstat den temporale guard med en **kausal**. En browser der har startet en
navigation afviser også NYE fetches — målt i WebKit: `fetch(location.href)` afvises
med `TypeError: Load failed` efter ~16 ms, mens et dokument der bliver liggende
svarer 200. Begge stier spørger nu dokumentet "kan du stadig hente noget?" lige før
de reloader, og fail-closed hvis svaret ikke er et klart ja.

## Det var også en ægte brugerfejl

Det her ramte ikke kun tests. En spiller på iOS Safari der navigerer væk fra appen
mens et lazy chunk stadig loader, blev reloadet **tilbage** til den side de var ved
at forlade. Ingen fejlbesked, bare en navigation der forsvandt.

At symptomet først blev synligt som en e2e-fejl gjorde det nemt at læse som
"test-flake". Det var det ikke.

## Lektioner

1. **En tidsbaseret guard mod en race er ikke en guard, det er et væddemål.** Hvis
   du skriver `delayMs` for at undgå en race, så spørg hvad du egentlig venter på —
   og om du kan spørge om DET direkte i stedet. Her fandtes det kausale signal
   (fetches afvises under en igangværende navigation) og var billigere end gættet.
2. **Når du finder en fejlmode, så find alle stier der har den.** Kommentaren i
   `chunkErrors.js` beskrev fejlen korrekt i maj. Den anden reload-sti, 40 linjer
   væk i en anden fil, fik aldrig samme behandling. Backwards-check gælder også
   inden for ens egen fil-nabolag.
3. **"Grøn lokalt, rød i CI" er information, ikke støj.** Det er næsten altid en
   timing-antagelse der kun holder på hurtig hardware. Modstå at læse det som
   "CI er flaky".
4. **Reproducér racen deterministisk før du fixer den.** Her: forsink
   document-responsen for målruten med 1,5 s. Det gjorde en 8/381-flake til en
   5/5-fejl, gjorde ablationstest mulig (hvilken af de to stier fyrer først?) og
   blev bagefter til den committede regressionstest.

## Forward-guard

`frontend/tests/e2e/chunk-reload-navigation-guard.spec.js` — kører i alle tre
projekter, forsinker document-committen deterministisk og fejler hvis en
navigation bliver kapret. Verificeret til at fejle uden fixet (5/5) og bestå med
det (5/5).

Plus unit-dækning i `chunkErrors.test.js` for den kausale guard: navigation
in-flight → intet reload **og** loop-guard-nøglen brændes ikke.

## Fodnote til #1342

Postmortem'en fra 2026-06-14 (`2026-06-14-ci-only-flake-read-full-log-before-fixing.md`)
beskrev nøjagtig dette symptom — "webkit ramte navigations-races (`page.goto("/board")`
afbrudt af auth-redirect til `/dashboard`)" — og konkluderede at det var et
"CI-runner-timing-artefakt". Diagnosen "auth-redirect" var forkert; det var
chunk-recovery-reload'en. Svaret dengang blev at fjerne mobile-webkit fra CI, hvilket
skjulte fejlen i tre måneder og lod webkit-snapshots drive uset (#3378, #3429).

Læren: **"kun i CI" og "kun i én browser" er ikke i sig selv bevis for et
testmiljø-artefakt.** Begge dele var her ægte produktadfærd — de var bare kun
observerbare under de betingelser.
