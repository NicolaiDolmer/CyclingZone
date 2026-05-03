# NOW — Aktuel arbejdsstatus

## Aktiv slice
**DD soak-gate lukket (v2.20).** Auto-verificeret 4 punkter + fixet `cz-bg0`-typo via tailwind aliases. Onboarding v2 + DD + dark mode + Discord DM + flag SVG: alle ✅.

## Soak-gate
**ALLE LUKKET ✅** — Dark mode · Discord DM · Onboarding v2 1a+1b+2+3+4 · Flag SVG v2.18 · DD S1–S4 (banner-fase pressure-dot fix verificeret runtime via Claude Preview: rgb(185,28,28); ticker `animate-ticker` keyframe ✅; flash-badge tokens ✅; Final Whistle embed-format auto-testet mod Discord limits ✅).

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-04: **DD soak-gate lukket** (v2.20) — Auto-audit af 4 visuelle DD-punkter via code-level + Claude Preview runtime + Node embed-test. Bug fundet: `cz-{danger,success,warning,info}-bg0` brugt 74x i source uden tailwind-definition. Fix: 4 aliases i `tailwind.config.js` → DD pressure-dot nu rød (verificeret runtime). Pre-eks. opacity-issue (color-tokens uden `<alpha-value>` placeholder) dokumenteret som separat task.
- 2026-05-04: **Onboarding v2 — Slice 4** (v2.19) — Empty-state-tour + completion-celebration. Ny `OnboardingCompletionCard.jsx` ved 4/4. Sekundær "Vis mig rundt"-knap på 3 empty-states.
- 2026-05-03: **Cross-browser flag fix** (v2.18) — Ny `<Flag>` komponent baseret på `flag-icons` SVG-sprite. 22 emoji-callsites erstattet. Fix for Windows-Chrome.
- 2026-05-03: **Slice 3 + timing-fix** (v2.16+v2.17) — Økonomi-explainer på `/finance`. Sponsor/salary timing korrigeret mod `economyEngine.js:162,499`.
- 2026-05-03: **Onboarding v2 — Slice 2** (v2.15) + **DD audit follow-up** (v2.14) — `BoardEmptyState.jsx` + `auctions.is_flash` schema-divergens lukket.
- Ældre v2.13 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. Næste post-launch-slice: S9 Race Library (anbefalet) eller S8.5 import-feedback
2. Pre-eks. opacity-bug i color-tokens (separat task spawned — bredere refactor af cz-* CSS-vars til channel-format)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
