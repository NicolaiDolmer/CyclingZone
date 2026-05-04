# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S8.5 import-feedback UI shipped (v2.24).** Admin har nu `Forhåndsvis`-knap på Sheets-import der kalder backend i dry-run mode (0 DB writes) og viser per-løb tabel med matched/unmatched ryttere+hold, total points og skipped løb. `Bekræft import`/`Annullér` styrer commit. Reducerer Sæson-6-type fejl. Backend: 1 ny `dryRun` param, 1 ny test (105/105 grønne). Frontend: lint 0/41, build 7.47s.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-04: **S8.5 Import-feedback UI** (v2.24) — `Forhåndsvis`-knap, dry-run preview-tabel, `Bekræft import`/`Annullér`. Backend `dry_run`-flag på eksisterende endpoint (singular execution path).
- 2026-05-04: **v2.23.1 polish + Soak-gate S9 rapport** — tomme vinder-kort `/seasons/:id` ikke-klikbare. 10/10 punkter, 4 P2 identificeret.
- 2026-05-04: **S9b Sæson-snapshot** (v2.23) — `/seasons/:seasonId` med kalender + 4 vinder-kort.
- 2026-05-04: **S9a Løb-hub konsolidering** (v2.22) — `/races` med Bibliotek + Point & præmier-tabs.
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. S10: Admin økonomi-panel
2. S9-polish-slice (samlet): filter URL-sync på Bibliotek (P2-A), deadline-day dedup (P2-C), race-slug kebab-case (P2-D)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
