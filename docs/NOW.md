# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S8 — Discord DM** (post-launch retention). Detaljeret plan: `~/.claude/plans/happy-seeking-wren.md`.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. Gate #5 lukket grønt 2026-05-02 efter spot-check (UCI 10/10, salary 10/10, dyn 10/10).

## Senest leveret
- 2026-05-02 (aften): Gate #5 — salary recalc 8.699 ryttere + auto-spot-check vs Sheets; 0/0/0 afvigelser
- v2.04 (2026-05-02): Dark mode S1 — token-foundation + ThemeProvider + chrome + top-5 sider
- v2.03 (2026-05-02): Deadline Day S4 — T-24h/T-2h/T-30min cron + Final Whistle Discord-rapport
- v2.02 (2026-05-02): Deadline Day S3 — Flash Auktion + hastebudsignal

## Næste session — prioriteter (per plan)
1. **Soak-gate FIRST** (60-min e2e smoke i begge temaer) — 5 ships i går, per plans regel #1
2. **S8 Discord DM** — bot-setup (Railway: `DISCORD_BOT_TOKEN`) → `discordNotifier.sendDM` → ProfilePage badge + DashboardPage nudge
3. Tilføj 3 metode-regler til `docs/GUARDRAILS_CORE.md` (soak-gate, runtime-anchored brief, doc-drift sweep)
4. Doc-drift quick-win: fjern "manual UCI sync"-confusion fra backlog (env ikke sat, GH Actions canonical)

## Værktøjer
- `backend/scripts/verifyRidersAgainstSheets.js` — read-only Gate #5 verifikation, kør når som helst (target: 0/0/0)

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- `updateRiderValues` sætter salary = `uci_points × 400` rent (prize_bonus reflekteres kun i market_value)
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
