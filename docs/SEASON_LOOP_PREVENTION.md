# Sæson-loop prevention + komplet status

> **Formål:** Single source of truth for hvad der blev gjort, hvad der mangler, og hvad der skal til for at det aldrig sker igen.
> Sammenhæng: postmortem ([learnings/2026-05-22](../.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)) — followup ([SEASON_LOOP_FOLLOWUP.md](SEASON_LOOP_FOLLOWUP.md)) — forensik ([SEASON_LOOP_FORENSICS.md](SEASON_LOOP_FORENSICS.md)) — admin-checklist ([SEASON_TRANSITION_CHECKLIST.md](SEASON_TRANSITION_CHECKLIST.md)) — **denne doc**.

---

## 1. Er det fikset komplet bagudrettet?

**Ja — verificeret 2026-05-22 ~02:00 CEST.**

| Bagudrettet check | Status |
|---|---|
| Sæson 1 active, sæson 2/3/4 slettet | ✅ |
| Ghost `finance_transactions` (144 rows) fjernet | ✅ |
| Team-balancer matcher rekonstruktion fra `finance_transactions` | ✅ 19/19 hold, diff ≤ 1 CZ$ |
| `loans.amount_remaining` korrigeret for ghost-renter | ✅ 10/10 lån |
| `loans.seasons_remaining` korrigeret (short: 2, long: 4) | ✅ 10/10 lån |
| Audit-trail i `admin_log` | ✅ 3 entries (rollback + cleanup + audit-fix) |
| Ingen orphaned FK-refs til ghost-sæson-UUIDs | ✅ 0 rows i 7 tabeller |
| Ingen ghost-notifications, activity_feed-rows, xp_log-rows | ✅ |
| Ingen ghost board_profiles, board_consequences, season_standings | ✅ |
| Manager net-worth (balance − debt) bevaret | ✅ Zero-sum-justering |

**Du behøver ikke gøre mere bagudrettet.** Næste rigtige sæson-transition (1→2) vil køre på rene data.

---

## 2. Hvad er allerede deployed til at forebygge gentagelse?

Tre lag forsvar er aktive lige nu:

### Lag 1 — Kode-filter (v3.86)
- `seasonAutoTransition.js`, `squadEnforcement.js`, `deadlineDayReport.js` filtrerer alle på `closed_at IS NOT NULL`
- 3 regressionstests låser filteret så det ikke kan fjernes ved et uheld

### Lag 2 — DB-niveau CHECK constraint (v3.86)
- `CHECK (final_whistle_sent_at IS NULL OR closed_at IS NOT NULL)` på `transfer_windows`
- `CHECK (squad_enforcement_completed_at IS NULL OR closed_at IS NOT NULL)` på `transfer_windows`
- PostgreSQL afviser **strukturelt** enhver UPDATE der ville sætte timestamps på et racing-window — selv hvis en fremtidig cron har bug

### Lag 3 — Observability + graceful operations (v3.87)
- Discord-broadcast ved HVER `transitionToNextSeason` (admin + cron sender ens)
- Sentry `cron:<label>`-tag på alle cron-fejl
- Daglig safety-net: `processDailySeasonCountCheck` alerter ved >1 transition/24h
- SIGTERM-handler venter på `awaitCronsIdle(30s)` ved Railway-deploy
- Admin-checklist `docs/SEASON_TRANSITION_CHECKLIST.md` dokumenterer hele flowet

---

## 3. Hvad kunne vi have gjort bedre?

Konkrete læringer der bør forme fremtidigt arbejde:

### A. Implicit assumption-bug var en kode-smell
`processLoanInterest` skriver en `finance_transactions`-row med `amount=-rente`, men rører **ikke** `teams.balance` — renten lægges i stedet til `loans.amount_remaining`. Denne dobbeltbetydning af `finance_transactions.amount` (nogle gange = balance-bevægelse, nogle gange = informational debt-vækst) er roden til hvorfor original rollback overcorrected. **Læring:** Hver tabel-kolonne bør have ÉN entydig betydning. Hvis `amount` betyder forskelligt afhængigt af `type`, bør det dokumenteres eksplicit i schema-kommentar + i ESLint-regler der fanger ved code review.

### B. Postmortem-discipline manglede "blast radius"-sektion
Original postmortem konkluderede "144 ghost-tx slettet, 7.67M CZ$ refunded" — uden at verificere alle de andre tabeller (loans, board_profiles, notifications, etc.) som `processSeasonStart` rører. Det ville have fanget loans-buggen 12 timer tidligere. **Læring:** Hver postmortem skal have en "Blast radius assessment"-sektion der lister alle tabeller en buggy funktion kunne have rørt — og bekræfter status pr. tabel. Skabelon i [SEASON_LOOP_FORENSICS.md](SEASON_LOOP_FORENSICS.md).

### C. Vi havde ingen "balance = SUM(finance_tx)"-invariant test
Den gyldne invariant `balance = INITIAL_BALANCE + SUM(non-loan-interest finance_tx)` skulle have været en daglig automated test. Det ville have raset alarm straks da rollback overcorrected. **Læring:** Hvis en invariant er let at formulere som SQL, skal den være en cron der alerterer ved breach.

### D. Ingen staging-env til at teste rollback
Original rollback gik direkte mod prod uden test. **Læring:** For high-stakes data-corrections (anything that touches >5 hold/lån/etc), skal vi enten:
- Skrive scriptet med `BEGIN; ... ROLLBACK;` for dry-run først
- Verificere via SELECT-only queries før COMMIT
- Have et staging-env (større investering, parkeret som GitHub-issue hvis vi vil prioritere det)

---

## 4. Anbefalede næste skridt (frivilligt)

Bagudrettet er alt rent. Fremadrettet er der 5 forbedringer der hver især øger margen mod en lignende bug:

| # | Forslag | Effort | Værdi | Status |
|---|---|---|---|---|
| 1 | **Daglig balance-reconciliation cron** — Verificér `balance = 800K + SUM(non-loan-interest finance_tx)` for hver hold. Discord-alert + Sentry hvis breach. | Small (~1 fil, ~80 linjer) | Høj | Ny — anbefales NU |
| 2 | **`CHECK (seasons_remaining >= 0)` på `loans`** | Tiny (1 migration) | Medium | Ny — anbefales NU |
| 3 | **Status-overload refactor** ([#542](https://github.com/NicolaiDolmer/CyclingZone/issues/542)) | Medium | Medium (design-cleanup) | Parkeret |
| 4 | **Season_transition_paused admin-toggle** ([#543](https://github.com/NicolaiDolmer/CyclingZone/issues/543)) | Small-medium | Medium | Parkeret |
| 5 | **closed_at manuel sletning edge case** ([#544](https://github.com/NicolaiDolmer/CyclingZone/issues/544)) | Small | Low | Parkeret |

**Hvis du kun gør én ting:** #1 (daglig balance-reconciliation cron). Den ville have fanget begge bugs i denne incident dagen efter de skete.

---

## 5. Scheduled check-in 2026-05-23 09:07 CEST

En automatisk task er sat op til at køre i morgen formiddag. Den vil:

1. Tjekke at `seasons.status='active'` kun for sæson 1 (ingen ghost-transitions natten over)
2. Verificere alle 19 holds balance stadig matcher `800K + SUM(non-loan-interest finance_tx)` (samme invariant som blev brugt til verifikation i dag)
3. Kontrollere `loans.seasons_remaining > 0` for alle aktive lån
4. Tjekke daily-snapshot cron's første kørsel (forventes ~24h efter Railway-deploy af v3.87)
5. Rapportere status — grønt lys eller advarsel om hvad der bevæger sig

---

## 6. Reference

- Original incident timestamps + 3-lags fix: [postmortem](../.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)
- Åbne spørgsmål A-G + handlingsplan: [SEASON_LOOP_FOLLOWUP.md](SEASON_LOOP_FOLLOWUP.md)
- Live forensik-metodologi + queries: [SEASON_LOOP_FORENSICS.md](SEASON_LOOP_FORENSICS.md)
- Admin-flow for fremtidige transitions: [SEASON_TRANSITION_CHECKLIST.md](SEASON_TRANSITION_CHECKLIST.md)
- Original rollback SQL: [database/2026-05-21-season-loop-rollback.sql](../database/2026-05-21-season-loop-rollback.sql)
- Rest-cleanup SQL: [database/2026-05-22-season-loop-rollback-additions.sql](../database/2026-05-22-season-loop-rollback-additions.sql)
- DB CHECK constraint: [database/2026-05-22-transfer-window-racing-guard.sql](../database/2026-05-22-transfer-window-racing-guard.sql)
