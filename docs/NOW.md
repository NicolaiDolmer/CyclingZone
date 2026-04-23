# NOW — Aktuel arbejdsstatus

## Aktiv næste slice
- `Slice 1 — Navigation & app-shell` — nav-IA implementeret og deployed
- Nav-struktur: Overblik, Marked, Resultater, Liga låst og live.
- `/profile` redirecter til `/managers/:teamId`. Min Profil fjernet fra nav. Logo → Dashboard.
- Fuld execution-roadmap og låste defaults ligger i `docs/PRODUCT_BACKLOG.md`.

## Næste slice derefter
- `Slice 2 — Indbakke, notifikationer og topbar`
- Fokus: Personlig systemindbakke, ulæste badges, deep-links, head-to-head default eget hold.

## Blockers / investigations
- Delvist løst: Discord/webhook-notifier er nu koblet op. Gjenstår: live-verifikation mod rigtig webhook-URL + køre `2026-04-23-discord-settings.sql`-migrationen i prod.
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Løst: Hidden achievements afslørte navn/beskrivelse i tooltip — nu rettet.
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
