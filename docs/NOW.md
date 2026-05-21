# NOW — Aktuel arbejdsstatus

> **🟢 Session 2026-05-22 — sæson-loop follow-up implementeret (v3.87):** Plan-mode A-G gennemgået; tight safety-net scope valgt. Deployed: (1) Discord-broadcast fra `transitionToNextSeason` (cron + admin sender ens), (2) SIGTERM-handler i `server.js` venter på `awaitCronsIdle(30s)`, (3) Sentry `cron:<label>`-tag på alle cron-fejl, (4) Daglig `processDailySeasonCountCheck` alerter ved >1 transition/24h, (5) [`docs/SEASON_TRANSITION_CHECKLIST.md`](docs/SEASON_TRANSITION_CHECKLIST.md) som admin single source. Status-overload refactor (A), pause-håndsving (G), og `closed_at` manuel sletning (C3) parkeret som GitHub-issues. Postmortem: [`.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md`](.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md).

## Aktiv styring
