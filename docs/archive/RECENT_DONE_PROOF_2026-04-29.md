# Recent Done Proof — 2026-04-29

Denne fil holder nyere done proof ude af `docs/PRODUCT_BACKLOG.md`, så backloggen kan forblive token-effektiv.

## UCI-R2 — Løn følger værdi efter UCI-sync

- `.github/workflows/uci_sync.yml` kører `node backend/scripts/recalculateRiderSalaries.js` efter `python scripts/uci_scraper.py`.
- `backend/scripts/recalculateRiderSalaries.js` kalder den eksisterende `updateRiderValues`-regel i `backend/lib/economyEngine.js`.
- Regression: `backend/lib/economyEngine.test.js` dækker salary recalculation med bevaret `prize_earnings_bonus`.

## Live Season-Flow Quick Fixes

- Season-end preview bruger `buildSeasonEndPreviewRows` i `backend/lib/economyEngine.js`, så preview og season-end/season-start deler board/sponsor/economy-runtime.
- Preview viser lånerente separat, men `balance_after` og nødlånsbehov følger runtime: aktive lånerenter lægges på lånets restgæld via `processLoanInterest`.
- Google Sheets-resultatimport delegerer til `applyRaceResults` og er live-verificeret for sæson 6.
- Sæson 6 live facts pr. 2026-04-29: `races=98`, `race_results=709`, `season_standings=25`, `completed races=18`, prize finance rows `10` totaling `2922`.

## UI / Market / Integration Fixes

- `Slice UI-M1 — Mobile beta-critical flows` er lukket: rytterliste, rytterside-market actions, auktioner, transfers, indbakke og admin beta quick actions er mobiltilpasset.
- Frontend route-level code-splitting er lukket via `React.lazy`/`Suspense`; frontend build passerer uden Vite large chunk warning.
- OBS route-audit 2026-04-29: `ProfilePage.jsx` findes, men `App.jsx` router aktuelt `/profile` via `ProfileRedirect`; Profil & Indstillinger skal rettes/verificeres før launch.
- Ranglisteindikator følger `processDivisionEnd`: Division 2-3 kan rykke op, Division 1-2 kan rykke ned.
- Discord transferhistorik er runtime-bekræftet med `general` og `transfer_history` webhooks.

## Slice 14 — UCI-points og stats-udvikling over tid

- Del A: UCI scraper top-3000 hardening er lukket; se `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`.
- Del B: `rider_uci_history` og `rider_stat_history` findes, og sync paths logger historik.
- Del C: `frontend/src/pages/RiderStatsPage.jsx` henter udviklingshistorik, lazy-loader `frontend/src/components/RiderDevelopmentTab.jsx`, og `frontend/package.json` har `recharts`.
