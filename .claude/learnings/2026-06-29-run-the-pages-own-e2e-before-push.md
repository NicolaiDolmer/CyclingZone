# Kør sidens egen e2e-spec lokalt før push (recap-tekst brød `race-detail.spec.js`)

**Dato:** 2026-06-29
**Kontekst:** #1485/#1311 ([PR #1964](https://github.com/NicolaiDolmer/CyclingZone/pull/1964)) — holdvinder-synlighed + tekst-recaps på `RaceDetailPage.jsx`.

## Hvad skete der
Jeg ændrede `RaceDetailPage.jsx` (ny recap-blok + holdklassement-rendering) og kørte
lokalt: `node --test` (alle unit-tests grønne) + `core-smoke.spec.js` snapshot-update.
Jeg kørte IKKE den eksisterende **`race-detail.spec.js`** — sidens egen render-regression-
test. CI's (advisory) `frontend-smoke` fangede så en ægte regression:

```
strict mode violation: getByText('Holdkonkurrence') resolved to 2 elements:
  1) <li>Team X førte holdkonkurrencen med 2 ryttere i top 10</li>  (min recap-tekst)
  2) <h2>Holdkonkurrence</h2>                                       (klassement-heading)
```

Recap-momentet "teamDay" indeholder ordet "holdkonkurrencen", som `getByText("Holdkonkurrence")`
matchede ud over `<h2>`-headingen → strict-mode-kollision.

## Rod-årsag
Ny UI-tekst på en side kan kollidere med substring-`getByText`-selektorer i sidens
eksisterende e2e. Jeg antog at unit-tests + core-smoke dækkede RaceDetailPage; men
`race-detail.spec.js` er den dedikerede render-test for netop den side, og den kørte jeg ikke.

## Fix
- Klassement-titler matches nu på `getByRole("heading", { name })` (robust mod tekst-kollision).
- Tilføjet recap-dækning (`Løbsreferat`-assertion) så featuren er e2e-dækket.
- Verificeret lokalt på alle 3 playwright-projekter.

## Forward-guard
**Når du ændrer en side-komponent (`frontend/src/pages/*.jsx`), kør sidens egen e2e-spec
lokalt** — ikke kun `node --test` + `core-smoke`. Find den med fx
`ls frontend/tests/e2e/ | grep <side>` (her `race-detail.spec.js`). Foretræk
`getByRole("heading", …)` frem for `getByText(...)` til titler, så ny brødtekst ikke
kolliderer.

## Bonus-note: patch-notes-snapshots er flaky
`core-smoke` patch-notes-snapshottet er ikke-deterministisk (fejlede på lokalt re-run
lige efter `--update-snapshots`). Derfor er `frontend-smoke` **advisory, ikke required**.
Commit ikke lokalt-genererede patch-notes-snapshots (de matcher hverken CI eller sig selv);
brug opt-out-tokenet `[patch-notes-snapshot-ok]` i en commit-besked i stedet.
