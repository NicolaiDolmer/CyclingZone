# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen** — S8 lukket. Næste valg: Dark Mode S2 (tokenize resterende sider) eller Onboarding v2.

## Soak-gate
**Aktiv: ja** — Deadline Day S1–S4 + Dark Mode S1 fra 2026-05-02 + S8 i dag = 6 user-facing slices uden e2e-smoke. Næste session skal starte med 60-min smoke i begge temaer FØR ny kode.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **S8 Discord DM live i prod** (`e0362d9`) — sendDM verified end-to-end mod admin-konto, opt-out + status-badge + Dashboard nudge + input-validering på discord_id (afviser brugernavne, kun 17-19 cifre)
- 2026-05-03: 3 nye GUARDRAILS_CORE-regler (soak-gate, runtime-anchored brief, doc-drift sweep)
- v2.04 (2026-05-02): Dark mode S1 — token-foundation + ThemeProvider + chrome + top-5 sider
- v2.03 (2026-05-02): Deadline Day S4 — T-24h/T-2h/T-30min cron + Final Whistle Discord-rapport

## Næste session — prioriteter
1. **Soak-gate kvittering** — kør 60-min e2e smoke i light + dark, notér fund i denne fil
2. Vælg næste slice: Dark Mode S2 (mekanisk, lav-risk) eller Onboarding v2 (cykling-fokus, post-launch retention)
3. Tjek at de 3 managers med username-format discord_id ser den røde warning-badge og opdaterer

## Værktøjer
- `backend/scripts/verifyRidersAgainstSheets.js` — read-only Gate #5 verifikation (target: 0/0/0)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
