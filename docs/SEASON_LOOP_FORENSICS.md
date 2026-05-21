# Sæson-loop forensik — verdens-klasse incident-gennemgang

> **Formål:** Self-contained prompt + forensisk plan til en frisk AI-session (eller live audit i denne session). Verificerer at **ALT** der gik galt i sæson-loop-incidenten 2026-05-21 er fundet og rettet — ikke kun det åbenlyse (finance_transactions). Resterne er sandsynligvis dybere end den oprindelige rollback adresserede.
>
> **Brug:** Læs sektion 1-3 først (kontekst + hvad rollback dækkede/ikke dækkede). Sektion 4 er hovedrettestjeklisten med konkrete SQL-queries pr. kategori. Sektion 5 er reconciliation-plan-skabelonen.

---

## 1. Incident kontekst

**Hvornår:** 2026-05-21 23:15-23:48 CEST (33 minutter).

**Hvad skete:**
- 23:15 — `processSeasonAutoTransitionCron` fyrede korrekt 0 → 1.
- 23:20 — `processDeadlineDayCron` + `processSquadEnforcementCron` claimed timestamps på sæson 1's nyfødte racing-window (fordi cron-filter ikke filtrerede `closed_at IS NOT NULL`).
- 23:25 — Cron'en fandt sæson 1's window "fully wrapped" → fyrede 1 → 2. **Loop start.**
- 23:25 → 23:48 — Loop fortsatte: 2 → 3, 3 → 4. **4 ghost-transitions i alt.**
- 23:48 — Akut-stop via manuel SQL (sæson 4 sat `completed`, vinduet wrapped → cron's idempotens-check blokerede).
- 00:01-00:09 — Rollback-script ([database/2026-05-21-season-loop-rollback.sql](../database/2026-05-21-season-loop-rollback.sql)) kørt.

**Officielt postmortem:** [.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md](../.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)

**Fixes deployed:**
- v3.86 — kode-filter `.not("closed_at", "is", null)` + DB CHECK constraint
- v3.87 — Discord-broadcast, SIGTERM-handler, Sentry-tag, daglig snapshot

---

## 2. Hvad rollback-scriptet *gjorde* (verificeret 2026-05-22)

Læs [database/2026-05-21-season-loop-rollback.sql](../database/2026-05-21-season-loop-rollback.sql) for kanonisk SQL. Sammenfattet:

| Trin | Handling | Tabel | Status |
|---|---|---|---|
| 1 | Audit-snapshot | `admin_log` (1 row) | ✅ |
| 2 | Refund balancer via `SUM(amount)` subtraktion | `teams.balance` | ✅ |
| 3 | Slet alle `finance_transactions` for sæson 2/3/4 | `finance_transactions` | ✅ |
| 4 | Slet transfer_windows for sæson 2/3/4 | `transfer_windows` | ✅ |
| 5 | Slet sæson 2/3/4 | `seasons` | ✅ |
| 6 | Restore sæson 1 til `active`, `end_date=NULL` | `seasons` | ✅ |
| 7 | Nul sæson 1-vinduets ghost-timestamps | `transfer_windows` | ✅ |

---

## 3. Hvad rollback-scriptet *IKKE* gjorde (kritiske huller)

`processSeasonStart` (kører ved hver transition) har 7+ side-effects, hvoraf kun **finance_transactions + balance** er ryddet op. Resterne er stadig i DB.

### 3a. Side-effects fra `processSeasonStart` ([backend/lib/economyEngine.js:175](../backend/lib/economyEngine.js))

| # | Side-effect | Tabel påvirket | Ryddet af rollback? |
|---|---|---|---|
| 1 | Sponsor-credit | `finance_transactions` | ✅ |
| 2 | Loan-agreement-fees (debit) | `finance_transactions` | ✅ |
| 3 | **Ensure board_profiles for 1yr/3yr/5yr** | `board_profiles` (INSERT) | ❌ |
| 4 | **Expire layer=5 board_consequences** | `board_consequences.status='expired'` | ❌ |
| 5 | Loan-interest (debit per aktivt lån) | `finance_transactions` | ✅ |
| 6 | Salary (debit) | `finance_transactions` | ✅ |
| 7 | **Emergency-loan INSERT** | `loans` (INSERT status='active') | ❌ |
| 8 | Emergency-loan finance-tx | `finance_transactions` | ✅ |
| 9 | **Emergency-loan notification** | `notifications` (4 typer) | ❌ |
| 10 | Negativ-balance-rente (debit) | `finance_transactions` | ✅ |
| 11 | console.log + result-array | (kun in-memory) | n/a |

### 3b. Side-effects fra `transitionToNextSeason` ([backend/lib/seasonTransition.js](../backend/lib/seasonTransition.js))

| # | Side-effect | Tabel påvirket | Ryddet? |
|---|---|---|---|
| 12 | Insert next season | `seasons` | ✅ |
| 13 | Mark prev season `completed` | `seasons` (UPDATE) | ✅ (sæson 1 restored) |
| 14 | Close prev transfer_window | `transfer_windows` (UPDATE) | ⚠️ (verificér) |
| 15 | Insert next transfer_window | `transfer_windows` | ✅ |
| 16 | `writeAdminLog` | `admin_log` (4 entries hvis admin_user_id nullable-fix var deployed) | ❌ |
| 17 | (v3.87 only — efter incidenten) Discord broadcast | (extern) | n/a |

### 3c. Indirekte side-effects

| # | Hvad | Hvor | Risiko |
|---|---|---|---|
| 18 | `processLoanInterest` opretter rows i `loan_payments` eller lignende? | Tjek `loanEngine.processLoanInterest` | Medium |
| 19 | `incrementBalanceWithAudit` opretter audit-trail rows udover finance_transactions? | Tjek `balanceRpc.js` | Lav |
| 20 | `notifyManager`-kald fra `createEmergencyLoan` opretter notifications | `notifications` (4 typer) | **Høj** |
| 21 | Pre-loop board_consequences status='active' → status='expired' 4x | `board_consequences` | **Høj** |

### 3d. Datatabelreferencer der kan være orphaned

| # | Tabel | Hvad at tjekke |
|---|---|---|
| 22 | `board_profiles.season_id` | Peger nogen på de slettede sæson-UUIDs (2/3/4)? |
| 23 | `loans.season_id` (hvis kolonnen findes) | Peger nogen på de slettede sæson-UUIDs? |
| 24 | `notifications.related_id` / metadata | Peger på sæson 2/3/4 UUIDs? |
| 25 | `activity_feed.meta` | Refererer ghost-sæsoner? |
| 26 | `xp_log.reason` / metadata | Påvirket? |

---

## 4. Forensiske queries — kør pr. kategori

> **Ghost-sæson UUIDs (deterministisk via `computeSeasonUuid`):**
> - Sæson 2: `00000000-0000-0000-0000-000000000002`
> - Sæson 3: `00000000-0000-0000-0000-000000000003`
> - Sæson 4: `00000000-0000-0000-0000-000000000004`
>
> **Window-UUIDs (deterministisk via `computeTransferWindowUuid`):**
> - Vindue 2: `00000000-0000-0000-0000-00000002aaaa`
> - Vindue 3: `00000000-0000-0000-0000-00000003aaaa`
> - Vindue 4: `00000000-0000-0000-0000-00000004aaaa`
>
> **Incident-vindue:** `created_at >= '2026-05-21T21:15:00Z' AND created_at < '2026-05-21T22:00:00Z'` (UTC; CEST 23:15-00:00).

### Kategori A — `loans` (emergency-loans fra ghost-transitions)

**Hypotese:** Op til 4 ghost emergency-loans per hold med shortfall.

```sql
-- A1. Find alle emergency-loans oprettet i incident-vinduet
SELECT id, team_id, loan_type, principal, origination_fee, amount_remaining, status, created_at
FROM loans
WHERE loan_type = 'emergency'
  AND created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
ORDER BY team_id, created_at;

-- A2. Find loans der peger på slettede sæson-IDs (hvis loans.season_id findes)
SELECT * FROM loans
WHERE season_id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

-- A3. Per team: total ghost emergency-debt
SELECT team_id, COUNT(*) AS ghost_loans, SUM(amount_remaining) AS ghost_debt_remaining
FROM loans
WHERE loan_type = 'emergency'
  AND created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
GROUP BY team_id;
```

**Reconciliation:** Hvis fundet → slet rows i `loans` der ikke skulle eksistere. **NB:** Kun emergency-loans skabt af ghost-transitions — ikke loans skabt manuelt af manager i samme tidsvindue.

### Kategori B — `board_profiles` (orphaned season_id-refs)

**Hypotese:** Hvis hold manglede 1yr/3yr/5yr-profil, blev nye oprettet med `season_id` peger på sæson 2/3/4.

```sql
-- B1. Board profiles med season_id pointing at slettede sæsoner
SELECT id, team_id, season_id, plan_type, negotiation_status, created_at
FROM board_profiles
WHERE season_id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

-- B2. Duplikater per (team, plan_type) — sjov sanity-check
SELECT team_id, plan_type, COUNT(*) AS profiles
FROM board_profiles
GROUP BY team_id, plan_type
HAVING COUNT(*) > 1;
```

**Reconciliation:** Hvis fundet → enten DELETE (hvis duplikat) eller UPDATE season_id til sæson 1 UUID (hvis kun forekomst men forkert sæson). Beslut per række.

### Kategori C — `board_consequences` layer=5 (over-expired pullouts)

**Hypotese:** Hvis nogle pullouts var `active` pre-loop, blev de markeret `expired` 4 gange. Den FØRSTE expiry var legitim (sæson 1 brugte pullout). De 3 efterfølgende var ghost-handlinger der ikke skulle ske.

```sql
-- C1. Pullouts der blev expired i incident-vinduet
SELECT id, team_id, layer, severity, status, created_at, resolved_at
FROM board_consequences
WHERE layer = 5
  AND status = 'expired'
  AND resolved_at >= '2026-05-21T21:15:00Z'
  AND resolved_at < '2026-05-21T22:00:00Z';

-- C2. Alle pullouts (status uanset) for at se hvad der pre-eksisterede
SELECT id, team_id, layer, severity, status, created_at, resolved_at, expires_at_season_id
FROM board_consequences
WHERE layer = 5
ORDER BY created_at DESC LIMIT 20;
```

**Reconciliation:** Hvis pullouts var `active` pre-loop med `expires_at_season_id = '...001'` (sæson 1), så var én expiry korrekt. Hvis `expires_at_season_id` pegede på en SENERE sæson, blev pullouts fejlagtigt deaktiveret. Restore via `UPDATE board_consequences SET status='active', resolved_at=NULL WHERE id=...`. **Kræver manuel granular vurdering — ikke automatiseres.**

### Kategori D — `notifications` (ghost manager-DMs/in-app)

**Hypotese:** `createEmergencyLoan` kalder `notifyManager` med 4 typer. Plus andre flows i `processSeasonStart` kan have notification-trigger.

```sql
-- D1. Notifications oprettet i incident-vinduet, alle typer
SELECT id, user_id, team_id, type, title, created_at
FROM notifications
WHERE created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
ORDER BY type, created_at;

-- D2. Specifikke ghost-typer
SELECT type, COUNT(*) AS notif_count
FROM notifications
WHERE created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
  AND type IN ('emergency_loan', 'emergency_loan_breach', 'loan_created', 'loan_paid_off',
               'season_start', 'season_ended', 'board_update')
GROUP BY type;
```

**Reconciliation:** Slet ghost-notifikationer. Brugerne har ikke set dem hvis vi rydder op hurtigt; ellers send en undskyldnings-notification.

### Kategori E — `admin_log` (ghost season_transition entries)

**Hypotese:** Hvis migration `2026-05-21-admin-log-nullable-user.sql` blev anvendt FØR loopen ramte → 4 audit-entries. Hvis EFTER → 0 entries (silent failure som postmortem beskriver).

```sql
-- E1. Season-transition entries i incident-vinduet
SELECT id, admin_user_id, description, meta, created_at
FROM admin_log
WHERE action_type = 'season_transition'
  AND created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
ORDER BY created_at;

-- E2. Andre admin_log entries i samme vindue (måske season_repaired fra rollback)
SELECT action_type, COUNT(*) FROM admin_log
WHERE created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-22T01:00:00Z'
GROUP BY action_type;
```

**Reconciliation:** Behold rollback-entry (`season_repaired`). Marker ghost season_transition-entries med metadata `{ "ghost_from_loop": true, "incident_ref": "2026-05-21" }` så de er bevaret som audit-trail men markeret som ghost. Eller slet helt hvis vi vil have en clean log.

### Kategori F — `finance_transactions` integritet (verificér rollback)

**Hypotese:** Rollback slettede alle finance_transactions for sæson 2/3/4. Lad os verificere.

```sql
-- F1. Counts per sæson
SELECT season_id, type, COUNT(*) AS tx_count, SUM(amount) AS sum_amount
FROM finance_transactions
WHERE season_id IN (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
)
GROUP BY season_id, type;
-- Expected: tom result-set.

-- F2. Transactions med audit.idempotency_key pegende på ghost-sæsoner
SELECT id, team_id, type, amount, audit->>'idempotency_key' AS key
FROM finance_transactions
WHERE audit->>'idempotency_key' LIKE '%:00000000-0000-0000-0000-000000000002'
   OR audit->>'idempotency_key' LIKE '%:00000000-0000-0000-0000-000000000003'
   OR audit->>'idempotency_key' LIKE '%:00000000-0000-0000-0000-000000000004';
-- Expected: tom.
```

### Kategori G — `teams.balance` reconciliation (autoritativ baseline)

**Hypotese:** Rollback subtraherede `SUM(amount)` fra ghost-tx for at restore balance. Men det forudsætter at intet ANDET ramte balancen i ghost-vinduet udover finance_transactions. Hvis `createEmergencyLoan` kaldte `incrementBalanceWithAudit` to gange (én for lån-credit, én for ...), kan balance være off.

**Verifikation:** Beregn forventet balance fra ground-truth:
```
expected_balance = team.start_balance (constant)
                 + SUM(finance_transactions.amount WHERE team_id = X AND season_id IN (sæson 0, sæson 1))
```

```sql
-- G1. Reconstrueret balance fra finance_transactions
SELECT t.id, t.name, t.balance AS current_balance,
       COALESCE(SUM(ft.amount), 0) AS legitimate_tx_sum,
       /* Tilføj t.start_balance hvis kolonnen findes — ellers brug DEFAULT_STARTING_BALANCE constant fra economyConstants */
       (COALESCE(SUM(ft.amount), 0) + 30000000 /* DEFAULT_STARTING_BALANCE for sæson 0 */) AS reconstructed_balance
FROM teams t
LEFT JOIN finance_transactions ft ON ft.team_id = t.id
  AND ft.season_id IN (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000001'
  )
WHERE t.is_ai = false AND t.is_bank = false AND t.user_id IS NOT NULL
GROUP BY t.id, t.name, t.balance;
-- For hvert hold: |current_balance - reconstructed_balance| < 1 → OK
-- Hvis diff > 0 → der findes "skjulte" balance-deltaer der ikke har finance_transactions
```

**Reconciliation:** Hvis differential findes, find kilden (`incrementBalanceWithAudit` calls uden finance_transactions INSERT? `teams` UPDATE direkte?). Restore til reconstructed.

### Kategori H — Cross-table refs til ghost-sæsoner

```sql
-- H1. Find alle FK-refs til ghost-sæson-UUIDs på tværs af tabeller
-- (Generér via information_schema.constraint_column_usage)
SELECT
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE confrelid = 'seasons'::regclass
  AND contype = 'f';

-- Derefter for hver tabel: SELECT * FROM <table> WHERE <fk_column> IN (ghost-uuids);
```

### Kategori I — `activity_feed` (potentielt ramt)

```sql
-- I1. Activity entries i incident-vinduet
SELECT id, type, team_id, team_name, meta, created_at
FROM activity_feed
WHERE created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
ORDER BY created_at;
```

### Kategori J — `xp_log` (XP fra ghost-handlinger)

```sql
-- J1. XP entries i incident-vinduet
SELECT id, user_id, amount, reason, created_at
FROM xp_log
WHERE created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
ORDER BY user_id, created_at;
```

---

## 5. Reconciliation-plan-skabelon

For hver kategori med konkrete fund (>0 rows), forbered en SQL-additions-fil:

```sql
-- database/2026-05-22-season-loop-rollback-additions.sql
-- Ryd op efter ghost-side-effects der ikke blev fanget af original rollback-script.

BEGIN;

-- Kategori A: slet ghost emergency-loans
DELETE FROM loans
WHERE loan_type = 'emergency'
  AND created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
  AND id NOT IN (<list af legitime loans>);  -- whitelist hvis nogen var manuelt oprettet

-- Kategori B: slet/repointer orphaned board_profiles
DELETE FROM board_profiles
WHERE season_id IN (<ghost-uuids>);

-- Kategori C: restore pullouts (granular — kræver manuel vurdering pr. række)
UPDATE board_consequences
SET status = 'active', resolved_at = NULL
WHERE id IN (<list af pullouts der skal restores>);

-- Kategori D: slet ghost-notifications
DELETE FROM notifications
WHERE created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z'
  AND type IN ('emergency_loan', 'emergency_loan_breach', 'loan_created', 'season_start');

-- Kategori E: marker ghost admin_log (bevar audit-trail)
UPDATE admin_log
SET meta = meta || '{"ghost_from_loop": true, "incident_ref": "2026-05-21"}'::jsonb
WHERE action_type = 'season_transition'
  AND created_at >= '2026-05-21T21:15:00Z'
  AND created_at < '2026-05-21T22:00:00Z';

-- Audit-snapshot
INSERT INTO admin_log (admin_user_id, action_type, description, meta)
VALUES (NULL, 'season_repaired',
  'Sæson-loop forensik 2026-05-22: ryddet rest-ghost-side-effects (loans, board_profiles, notifications)',
  jsonb_build_object(
    'incident_date', '2026-05-21',
    'follow_up', '2026-05-22 grundig forensik',
    'rows_cleaned', jsonb_build_object(
      'loans', <antal>,
      'board_profiles', <antal>,
      'notifications', <antal>
    )
  )
);

COMMIT;
```

---

## 6. Acceptkriterier (verdens-klasse "alt-er-rent")

Forensik er **færdig** når ALLE punkter kan bekræftes:

- [ ] Ingen rows i `finance_transactions` med season_id i ghost-uuids
- [ ] Ingen rows i `loans` med created_at i incident-vinduet OG loan_type='emergency' OG ikke whitelisted
- [ ] Ingen rows i `board_profiles` med season_id i ghost-uuids
- [ ] Pullouts (layer=5) med resolved_at i incident-vinduet er enten korrekt-expired (1 legitim) eller restored
- [ ] Ingen rows i `notifications` med created_at i incident-vinduet OG type IN ghost-types (eller markeret som "ghost_from_loop")
- [ ] `admin_log` season_transition entries i incident-vinduet er enten 0 eller markeret med `ghost_from_loop=true`
- [ ] For hvert ikke-frozen human team: `reconstructed_balance` = `current_balance` (± 1 CZ$ for round-off)
- [ ] Ingen orphaned FK-refs til ghost-sæson-UUIDs i nogen tabel
- [ ] 5+ cron-ticks i træk er no-op siden 2026-05-22 (verificeret via admin_log season_transition count)
- [ ] PatchNotes opdateret med v3.88-entry hvis cleanup-script blev kørt

---

## 7. Hvis prompt køres i ny AI-session

Send følgende til den nye session:

```
Læs docs/SEASON_LOOP_FORENSICS.md som komplet kontekst. Kør forensik-queries i sektion 4 mod prod-Supabase via MCP. Rapportér konkrete fund pr. kategori (A-J). Hvis kategori har >0 rows: foreslå reconciliation-script (sektion 5). Brugeren godkender FØR du eksekverer DELETE/UPDATE.

Vigtigt:
- Læs også docs/SEASON_LOOP_FOLLOWUP.md og .claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md for fuld baseline.
- Bekræft hver kategori-kategori er færdig FØR du går videre til næste.
- Rapportér løbende; lad være med at samle alt op til sidst.
```

---

## 8. Reference

- Original rollback: [database/2026-05-21-season-loop-rollback.sql](../database/2026-05-21-season-loop-rollback.sql)
- DB CHECK constraint: [database/2026-05-22-transfer-window-racing-guard.sql](../database/2026-05-22-transfer-window-racing-guard.sql)
- Postmortem: [.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md](../.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)
- Followup: [docs/SEASON_LOOP_FOLLOWUP.md](SEASON_LOOP_FOLLOWUP.md)
- processSeasonStart: [backend/lib/economyEngine.js:175](../backend/lib/economyEngine.js)
- createEmergencyLoan: [backend/lib/loanEngine.js:260](../backend/lib/loanEngine.js)
- transitionToNextSeason: [backend/lib/seasonTransition.js:327](../backend/lib/seasonTransition.js)
- Admin-checklist (forventet flow): [docs/SEASON_TRANSITION_CHECKLIST.md](SEASON_TRANSITION_CHECKLIST.md)
