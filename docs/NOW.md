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
- Løst: Discord/webhook-notifier er live-verificeret i prod (2026-04-23). `discord_settings`-tabel og `users.discord_id` eksisterer i DB.
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Løst: Hidden achievements afslørte navn/beskrivelse i tooltip — nu rettet.
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
