# NOW — Aktuel arbejdsstatus

## Aktiv næste slice
- `Slice 0 — Baseline & blockers`
- Fokus: Gør repo-helsen og de vigtigste blockers tydelige før større feature-slices.
- Dækker nu: Discord/webhook-regression og manglende eksempelark til `dyn_cyclist`; repo-helsen er genbekræftet og board-notification-regressionen er låst med grøn backend-baseline.
- Fuld execution-roadmap og låste defaults ligger i `docs/PRODUCT_BACKLOG.md`.
- Arbejdsmode: roadmap/status holdes i docs, mens feature-briefs og sparringssessioner drives i chatten.

## Næste slice derefter
- `Slice 1 — Navigation & app-shell`
- Fokus: Låse ny informationsarkitektur for `Overblik`, `Marked`, `Resultater` og `Liga`, flytte `Min Profil` ind i managerprofilen og gøre Dashboard til default på `Overblik`.
- Næste låste sparringssession efter Slice 0 er navigation/app-shell-kontrakten.

## Blockers / investigations
- Delvist løst: Discord/webhook-notifier er nu koblet op. Gjenstår: live-verifikation mod rigtig webhook-URL + køre `2026-04-23-discord-settings.sql`-migrationen i prod.
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Løst: Hidden achievements afslørte navn/beskrivelse i tooltip — nu rettet.
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
