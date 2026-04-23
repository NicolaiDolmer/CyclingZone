# NOW — Aktuel arbejdsstatus

## Aktiv næste slice
- `Slice 2 — Indbakke, notifikationer og topbar` — implementeret og deployed
- Notifikationer omdøbt til Indbakke. Deep-links fra alle beskedtyper. Online-indikator i holdliste.
- HeadToHead defaultede allerede til eget hold. Online status var allerede på managerprofil.

## Næste slice derefter
- `Slice 3 — Min aktivitet`
- Fokus: Ny fane-struktur (`Kræver handling`, `Auktioner`, `Transfers`, `Lån`, `Ønskeliste`, `Historik`), kompakte handlingsrækker med statusbadge og deep-links.

## Blockers / investigations
- Løst: Discord/webhook-notifier er live-verificeret i prod (2026-04-23). `discord_settings`-tabel og `users.discord_id` eksisterer i DB.
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Løst: Hidden achievements afslørte navn/beskrivelse i tooltip — nu rettet.
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
