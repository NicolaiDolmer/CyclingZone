# NOW — Aktuel arbejdsstatus

## Aktiv næste slice
- `Slice 6 — Løbshistorik og løbsarkiv` — implementeret og klar til deploy
- `Løbsarkiv` på `/race-archive`: alle løb på tværs af sæsoner, grupperet og browseable.
- `Løbshistorik` på `/race-archive/:raceSlug`: tidligere udgaver, vindere pr. sæson, bedste ryttere akkumuleret, bar-chart over point-total.
- Navigation: "Resultater"-gruppen har nu Overblik, Ranglisten, Rytterrangliste, Løbsarkiv, Sæsonresultater og Hall of Fame.
- Resultater-hub opdateret med nyt Løbsarkiv-kort.

## Næste slice derefter
- `Slice 7 — Integrationer og Discord`
- Fokus: webhook-fix, transferhistorik til Discord-tråd, `dyn_cyclist` Google Sheet integration.

## Blockers / investigations
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
