# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S8 — Discord DM** (kode + docs leveret 2026-05-03). Afventer manuel sti: bot-setup på Discord developer portal + Railway env `DISCORD_BOT_TOKEN` + migration mod Supabase + soak-gate smoke.

## Soak-gate
**Aktiv: ja** — 5 ships 2026-05-02 (Deadline Day S1–S4 + Dark Mode S1) skal e2e-smokes i begge temaer FØR næste kode-slice. Per ny GUARDRAILS_CORE-regel.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. Gate #5 lukket grønt 2026-05-02.

## Senest leveret
- 2026-05-03: S8 Discord DM (kode klar, afventer bot-setup) — sendDM + opt-out + ProfilePage badge + Dashboard nudge + 3 nye GUARDRAILS_CORE-regler
- v2.04 (2026-05-02): Dark mode S1 — token-foundation + ThemeProvider + chrome + top-5 sider
- v2.03 (2026-05-02): Deadline Day S4 — T-24h/T-2h/T-30min cron + Final Whistle Discord-rapport
- v2.02 (2026-05-02): Deadline Day S3 — Flash Auktion + hastebudsignal

## Næste session — prioriteter
1. **Soak-gate kvittering** — kør 60-min e2e smoke i light + dark, notér fund her
2. **S8 manuel sti** — bot-setup, Railway env, migration, deploy verify, manuel DM-test
3. Dark Mode S2: tokenize resterende sider (Transfers, Board, Standings, Notifications, Help, PatchNotes m.fl.)

## Værktøjer
- `backend/scripts/verifyRidersAgainstSheets.js` — read-only Gate #5 verifikation (target: 0/0/0)
- `database/2026-05-03-discord-dm-opt-out.sql` — S8 migration (køres ved deploy)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
