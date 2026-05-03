# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Onboarding v2 — Slice 3 leveret (v2.16+v2.17 fix).** Onboarding v2 multi-slice nu komplet (1a + 1b + 2 + 3).

## Soak-gate
**Aktiv: delvis** — Dark mode ✅ · Discord DM ✅ · Deadline Day S1–S4 code-level ✅ (23/23 invarianter; `is_flash` schema-divergens lukket 2026-05-04) · DD UI-smoke 4 punkter pending. Onboarding v2 1a+1b+2+3: code-level (build/lint grøn); UI-smoke pending.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **Cross-browser flag fix** (v2.18) — Ny `<Flag>` komponent baseret på `flag-icons` SVG-sprite. Erstattet 22 emoji-baserede callsites på tværs af 13 filer + RiderFilters Chip + BoardPage `national kerne`. `/option`-dropdown viser nu kun landenavn (HTML option-tekst kan ikke have JSX). Fix for Windows-Chrome (Segoe UI Emoji har ikke flag-emoji); virker fortsat på Firefox/macOS/iOS/Android.
- 2026-05-03: **Slice 3 + timing-fix** (v2.16+v2.17) — Økonomi-explainer på `/finance`: `FinanceFirstVisitHint.jsx` (sponsor 260K × board-modifier, salary 10%, gældsloft, lånetyper) + tour 3 trin. v2.17 fix: sponsor=engangs ved sæsonstart, salary=engangs ved sæsonafslutning (runtime-verificeret mod `economyEngine.js:162,499`).
- 2026-05-03: **Onboarding v2 — Slice 2** (v2.15) + **DD audit follow-up** (v2.14) — `BoardEmptyState.jsx` + `auctions.is_flash` schema-divergens lukket.
- Ældre v2.13 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. UI-smoke på Onboarding v2 1a+1b+2+3 (samlet — alle fire slices code-level grønne)
2. Deadline Day UI-smoke (DD code-level audit kører som baggrunds-task)
3. Næste post-launch-slice fra backlog (S8.5 import-feedback eller S9 Race Library)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
