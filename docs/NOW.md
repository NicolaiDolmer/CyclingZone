# NOW — Aktuel arbejdsstatus

## Aktiv næste slice
- `Slice 0 — Baseline & blockers`
- Fokus: Gør repo-helsen og de vigtigste blockers tydelige før større feature-slices.
- Dækker nu: failing board-notification test, Discord/webhook-regression og manglende eksempelark til `dyn_cyclist`.
- Fuld execution-roadmap og låste defaults ligger i `docs/PRODUCT_BACKLOG.md`.

## Næste slice derefter
- `Slice 1 — Navigation & app-shell`
- Fokus: Låse ny informationsarkitektur for `Overblik`, `Marked`, `Resultater` og `Liga`, flytte `Min Profil` ind i managerprofilen og gøre Dashboard til default på `Overblik`.

## Blockers / investigations
- Blocker: `backend/lib/economyEngine.test.js` har en failing test om duplicate board notifications; den skal enten løses eller afgrænses før større runtime-slices.
- Blocker: Discord/webhook-regression skal reproduceres og afklares før Discord-transferhistorik og andre webhook-udvidelser bygges ovenpå.
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Follow-up: Kendte ikke-blokerende investigations som hidden achievements, evne-filter/slider og live season-rebuild spores fortsat i `docs/FEATURE_STATUS.md` og backloggen, men er ikke første execution-slice.
