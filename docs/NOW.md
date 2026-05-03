# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Color-system /N opacity fix leveret (v2.21).** Pre-eks. Tailwind 3 opacity-bug ryddet: `cz-*` base + `-bg0` aliases + accent-tokens konverteret til channel-format `rgb(var(--xxx) / <alpha-value>)`. Opacity-trin 3/8/12 tilføjet til theme. 35 opacity-klasser verificeret runtime.

## Soak-gate
**ALLE LUKKET ✅** — Dark mode · Discord DM · Onboarding v2 1a+1b+2+3+4 · Flag SVG v2.18 · DD S1–S4 · Color tokens v2.21 (35 runtime-klasser auto-verificeret via Claude Preview, dark mode `cz-*-bg` rgba 12% tint bevidst urørt og bekræftet).

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-04: **Color-system /N opacity fix** (v2.21) — Base `cz-{success,danger,warning,info,accent,accent-t}` + `-bg0` aliases til channel-format med `<alpha-value>`. Opacity 3/8/12 tilføjet (var ikke i Tailwinds default scale). Direct `var(--accent)` callsites i `index.css` spinner, `DashboardPage` MiniBar, `OnboardingTour` arrow, `Login`/`ResetPassword` grid-pattern wrappet i `rgb(...)`. Subtile bg-tints på alert-cards, hover-feedback og status-baggrunde nu synlige som designet.
- 2026-05-04: **DD soak-gate lukket** (v2.20) — `cz-*-bg0` aliases (4 typo-tokens brugt 74x).
- 2026-05-04: **Onboarding v2 — Slice 4** (v2.19) — Empty-state-tour + completion-celebration. Ny `OnboardingCompletionCard.jsx` ved 4/4.
- 2026-05-03: **Cross-browser flag fix** (v2.18) — Ny `<Flag>`-komponent (flag-icons SVG). Fix for Windows-Chrome.
- Ældre v2.17 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. Næste post-launch-slice: S9 Race Library (anbefalet) eller S8.5 import-feedback

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
