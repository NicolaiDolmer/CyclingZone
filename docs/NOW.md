# NOW — Aktuel arbejdsstatus

## Aktiv næste slice
- `Slice 5 — Resultater og rytterrangliste` — implementeret og klar til deploy
- `Resultater`-hub på `/resultater`: navigations-kort + tophold + topscorere.
- `Rytterrangliste` på `/rider-rankings`: sorterbar tabel med etapesejre, GC, pointklassement, bjerg, ungdom — inkl. AI-ryttere.
- Navigation opdateret: "Resultater"-gruppen har nu Overblik, Ranglisten, Rytterrangliste, Sæsonresultater og Hall of Fame.

## Næste slice derefter
- `Slice 6 — Løbshistorik og løbsarkiv`
- Fokus: historik pr. løb, tidligere udgaver, tidligere vindere, akkumuleret graf pr. løb.

## Blockers / investigations
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
