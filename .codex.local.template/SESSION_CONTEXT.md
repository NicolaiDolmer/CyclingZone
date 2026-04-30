# Session context — [opdatér dato ved session-start]

Aktiv slice: [slice-navn, fx "S2 — Profile/settings fix"]
Status: [in_progress | completed]

Seneste handlinger:
- [hvad der sidst blev gjort]

Næste handlinger:
- [konkret næste skridt]
- [konkret næste skridt]

Kritiske facts:
- Economy: DEFAULT_BETA_BALANCE=800000 CZ$, sponsor=240000 CZ$/sæson (v1.46)
- Profile-bug: /profile → ProfilePage (indstillinger), ikke ManagerProfilePage (read-only)
- Prize-money: per-løb CZ$ ≠ resultatpoint; skal i finance_transactions med gyldig type
- processSeasonEnd: loader teams/riders/board_profiles separat, fejler hårdt på errors
