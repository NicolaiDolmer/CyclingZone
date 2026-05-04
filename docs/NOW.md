# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S9a Løb-hub leveret (v2.22).** 3 overlappende race-pages konsolideret til ét hub `/races` med tabs Kalender · Bibliotek · Point & præmier · Indberét. `/race-archive` redirecter, sidebar IA renset. Backend: ny `GET /api/races?season=&class=&q=&status=`. Klar til UI-smoke + push.

## Soak-gate
**Aktiv: ja** — S9a er ny user-facing slice. Næste session starter med smoke af `/races?tab=library` (filtrer på sæson, klasse, status, søg), `/races?tab=points` (RacePointsPage embedded korrekt), redirect fra `/race-archive`, deep-link `/races?tab=library`.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-04: **S9a Løb-hub konsolidering** (v2.22) — `/races` udvidet med Bibliotek + Point & præmier-tabs. Filtre i Bibliotek (sæson/klasse/status/q), client-side useMemo. URL ↔ tab-sync via `useSearchParams`. `/race-archive` redirecter til `/races?tab=library`; `RaceArchivePage.jsx` slettet. Sidebar: kun ét race-link (`Liga → Løb`). Ny `GET /api/races` backend. HelpPage + ResultaterPage opdateret. Lint 0 errors (41 warnings uændret), build 8.55s, 104/104 tests grønne.
- 2026-05-04: **Color-system /N opacity fix** (v2.21) — Base `cz-{success,danger,warning,info,accent,accent-t}` + `-bg0` aliases til channel-format med `<alpha-value>`. Opacity 3/8/12 tilføjet.
- 2026-05-04: **DD soak-gate lukket** (v2.20) — `cz-*-bg0` aliases (4 typo-tokens brugt 74x).
- 2026-05-04: **Onboarding v2 — Slice 4** (v2.19) — Empty-state-tour + completion-celebration.
- Ældre v2.18 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. UI-smoke S9a + push v2.22
2. S9b: `/seasons/:seasonId` komplet sæson-snapshot (kalender + slutstilling + sæsonens vindere)
3. Alternativt: S8.5 import-feedback UI

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
