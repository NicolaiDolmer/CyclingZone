# Season Transition Checklist (sæson N → N+1)

> **Single source for hvordan admin afslutter en sæson og starter den næste.** Skrevet efter sæson-loop-incident 2026-05-21 ([postmortem](.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)). Brug denne checklist **hver gang** en sæson skal afsluttes — også efter cron-loop er fikset, fordi den dokumenterer det forventede tidsforløb og hvad der skal verificeres.

---

## Forudsætninger (gælder altid)

- Aktiv sæson har status `'active'` og et åbent transfer-window (`status='open'`).
- Alle pending race-results er processeret (admin kan ikke afslutte en sæson med pending results — backend afviser).
- Backend cron'erne kører (verificér via Discord-broadcast af en testfinaliseret auction, eller via Sentry health).
- Discord default-webhook er konfigureret i `discord_settings` (ellers udelades broadcast).

## Hvor admin handler

**Frontend:** [`/admin/transfervindue`](frontend/src/pages/AdminPage.jsx) — sektionen **"Transfervindue"** → input **"Lukketidspunkt"** + **Gem**-knap.

**API:** `PUT /api/admin/transfer-window/closes-at` (defineret i [api.js:4615](backend/routes/api.js)). Body: `{ "closes_at": "<ISO-timestamp>" }`.

---

## Trin 1 — Sæt `closes_at` på det aktive transfer-window

1. Gå til `/admin/transfervindue`.
2. Indtast lukketidspunktet (datetime-local — dansk tid). Anbefal at sætte det **mindst 24 timer frem** så Deadline Day-banner-cron'en aktiveres.
3. Tryk **Gem**.

**Forventet effekt straks:**
- `transfer_windows.closes_at` opdateres til den valgte timestamp.
- Hvis `auction_timing_config.deadline_day_override = 'auto'`, aktiveres Deadline Day-tickeren automatisk 24 timer før `closes_at`.

**Verificér:**
- Reload siden — input skal vise den nye timestamp.
- `gh api repos/...` eller via Supabase Studio: `SELECT closes_at FROM transfer_windows ORDER BY created_at DESC LIMIT 1;` matcher.

---

## Trin 2 — Vent på cron-chain

Cron-chain efter `closes_at` er passeret:

| Tid (relativt til `closes_at`) | Cron | Handling | Hvor i kode |
|---|---|---|---|
| T-24h → T0 | `processDeadlineDayCron` (5 min interval) | Deadline-day-warnings til managers med pending transfers/squad-violations | [deadlineDayReport.js](backend/lib/deadlineDayReport.js) |
| T0 → T0+5min | `processDeadlineDayCron` (samme) | Auto-close vindue (`status='closed'`, `closed_at=NOW`) + final whistle-rapport til Discord | samme |
| T0+5min → T0+10min | `processSquadEnforcementCron` (5 min interval) | Auto-buy ryttere for hold under squad-loft + emergency-lån hvis balance < 0 | [squadEnforcement.js](backend/lib/squadEnforcement.js) |
| T0+10min → T0+15min | `processSeasonAutoTransitionCron` (5 min interval) | Sæson-transition: marker N completed, opret N+1 (status='active') + nyt racing-window (`status='closed'`, `closed_at=NULL`), sponsor-payout, admin_log entry, Discord-broadcast | [seasonAutoTransition.js](backend/lib/seasonAutoTransition.js) → [seasonTransition.js](backend/lib/seasonTransition.js) |

**Forventet samlet tidsforløb:** ~10-15 minutter fra `closes_at` til ny sæson aktiv.

---

## Trin 3 — Verificér efter transition

Når Discord-besked "🚀 Sæson N+1 Startet" lander, tjek:

1. **Sæson-tabellen:**
   ```sql
   SELECT number, status, start_date, end_date FROM seasons ORDER BY number;
   ```
   - Sæson N: `status='completed'`, `end_date` sat.
   - Sæson N+1: `status='active'`, `start_date` sat, `end_date=NULL`.
   - **Total seasons skal være +1** sammenlignet med før transition. Hvis +2 eller flere → STOP, dette er muligvis en cron-loop (jf. incident 2026-05-21).

2. **Transfer-windows:**
   ```sql
   SELECT id, season_id, status, closes_at, closed_at, final_whistle_sent_at, squad_enforcement_completed_at FROM transfer_windows ORDER BY created_at DESC LIMIT 2;
   ```
   - Sæson N's vindue: `status='closed'`, `closed_at` sat, `final_whistle_sent_at` sat, `squad_enforcement_completed_at` sat.
   - Sæson N+1's vindue (racing-window): `status='closed'`, `closed_at=NULL`, `final_whistle_sent_at=NULL`, `squad_enforcement_completed_at=NULL`. **Disse fire NULL'er er invarianter** — DB CHECK constraint håndhæver `final_whistle_sent_at IS NULL OR closed_at IS NOT NULL` ([2026-05-22-transfer-window-racing-guard.sql](database/2026-05-22-transfer-window-racing-guard.sql)).

3. **Sponsor-payout:**
   ```sql
   SELECT team_id, amount, audit->>'idempotency_key' AS key FROM finance_transactions
   WHERE type='sponsor' AND season_id='<sæson N+1 UUID>';
   ```
   - 1 row per ikke-frozen human team. Beløbet matcher `sponsor_breakdown.gross_sponsor`.
   - Unique-constraint `uniq_sponsor_per_team_season` blokerer dubletter — hvis der findes 2+ per team → DB-niveau bug.

4. **Admin-log:**
   ```sql
   SELECT created_at, description, meta FROM admin_log
   WHERE action_type='season_transition' ORDER BY created_at DESC LIMIT 5;
   ```
   - Én row med `description` = `"Sæson-transition: N → N+1 (auto via cron)"`.
   - `meta.from_season_number = N`, `meta.to_season_number = N+1`.

5. **Discord-broadcast:**
   - 1 besked "🚀 Sæson N+1 Startet" i default-webhook-kanalen. **Ikke flere** — hvis 2+ → loop (se abort-procedure).

6. **Sponsor-pullout (lag 5 board-konsekvens):**
   - Hvis nogle hold havde `board_consequences.layer=5, status='active'` ved transition: tjek at deres sponsor-payout reflekterer pullout-faktoren (severity/1000).

---

## Abort-procedure (hvis noget går galt)

**Hvis du opdager 2+ sæson-transitions på samme dag:**

1. **Stop blødningen:** Sæt den nyeste sæson `completed` + dens vindue `wrapped` via manuel SQL — det blokerer auto-transition cron'ens "fully wrapped"-check:
   ```sql
   UPDATE seasons SET status='completed', end_date=NOW() WHERE number=<højeste sæson-nummer>;
   UPDATE transfer_windows SET status='closed', closed_at=NOW(),
     final_whistle_sent_at=NOW(), squad_enforcement_completed_at=NOW()
   WHERE season_id=(SELECT id FROM seasons WHERE number=<højeste sæson-nummer>);
   ```
2. **Verificér 3 cron-ticks i træk er no-op** (vent 15 min, check Discord for ingen ny besked, check Sentry for ingen ny event).
3. **Lav rollback-script** der sletter ghost-sæsoner + finance-transactions + refunderer sponsor-beløb. Se [database/2026-05-21-season-loop-rollback.sql](database/2026-05-21-season-loop-rollback.sql) som template.

**Pause-håndsving:** Currently not implemented — feature er parkeret som [#543](https://github.com/NicolaiDolmer/CyclingZone/issues/543). I mellemtiden er manuel SQL-stop den eneste abort-mekanisme.

---

## Safety-net (forward-guards aktive efter 2026-05-22)

| Lag | Hvad | Effekt |
|---|---|---|
| Kode-filter | 3 crons har `closed_at IS NOT NULL`-guard | Cron skipper racing-windows automatisk |
| DB CHECK constraint | `final_whistle_sent_at IS NULL OR closed_at IS NOT NULL` (samme for squad-enforcement) | PostgreSQL afviser UPDATE der ville sætte timestamp på racing-window |
| Discord-broadcast | `transitionToNextSeason` kalder `notifySeasonEvent` ved hver transition | Bruger får visuel besked — 30 min stilhed sker ikke længere |
| Sentry-alert | `trackedTick` wrapper i cron.js sender `captureException` med `cron:<label>`-tag | Cron-fejl bliver synlig i Sentry-dashboard |
| Daglig safety-net | `processDailySeasonCountCheck` (24h interval) | Alert hvis >1 transition logget seneste 24h |
| Graceful shutdown | `SIGTERM`-handler i `server.js` venter på `awaitCronsIdle(30s)` | Cron-tick midt i transition afbrydes ikke ved deploy |

---

## Reference

- Incident postmortem: [.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md](.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)
- Followup-doc + spørgsmål A-G: [docs/SEASON_LOOP_FOLLOWUP.md](SEASON_LOOP_FOLLOWUP.md)
- DB-constraint: [database/2026-05-22-transfer-window-racing-guard.sql](database/2026-05-22-transfer-window-racing-guard.sql)
- Game-invariants (sponsor/balance/loft): [docs/GAME_INVARIANTS.md](GAME_INVARIANTS.md)
