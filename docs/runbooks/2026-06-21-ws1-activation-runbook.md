# WS1 Race-automatisering — Aktiverings-runbook (#1596)

> **Type:** Operatør-runbook. Ejer udfører trinnene. Dette dokument er **forberedelse**, ikke en handling — Claude har hverken kørt backfill, flippet flags eller taget backup. Alle muterende trin er markeret **[EJER-HANDLING]**.
>
> **Kilder (verificeret 2026-06-21):**
> - Issue [#1596](https://github.com/NicolaiDolmer/CyclingZone/issues/1596) (aktiverings-sekvens).
> - Plan `docs/superpowers/plans/2026-06-20-ws1-fase3-stage-by-stage-race.md` (SSOT, alle Fase-0-beslutninger DECIDED).
> - PR [#1574](https://github.com/NicolaiDolmer/CyclingZone/pull/1574) — MERGED (migration + scheduler + flag).
> - Migration `database/2026-06-20-races-stage-progress.sql`.
> - `backend/scripts/backfillRaceScheduledFor.js`, `backend/lib/stageScheduler.js`, `backend/lib/stageSchedulerFlag.js`, `backend/lib/autoPrizeFlag.js`, `backend/lib/raceEngineFlag.js`, `backend/lib/featureStage.js`.
> - Forever-gate §6.1: `docs/superpowers/specs/2026-06-19-forever-relaunch-readiness-design.md` (linje 84).

## 0. Hvad denne aktivering gør (kontekst)

Indtil nu er løb afviklet **100 % manuelt** via admin-trigger. WS1 gør driften selv-kørende, så CyclingZone kan slippes til ægte nye spillere uden daglig admin-indgriben — en forudsætning for forever-relaunch.

Tre dele tændes:
1. **Stage-scheduler** — afvikler forfaldne etaper én ad gangen på de synlige, lagrede tider (`race_stage_schedule.scheduled_at`). Maks 5 etaper/dag (loop-prævention).
2. **Auto-prize** — udbetaler præmier for `completed` løb (idempotent via `races.prize_paid_at`).
3. **Race-engine v2** — afviklingen sker via den motor (allerede live bag flag).

**Fail-safe-status efter PR #1574-merge:** alt er **OFF**. Migrationen tilføjede kolonner/tabel men ændrede ingen afvikling. Intet kører automatisk før flags eksplicit flippes (trin d).

> **IKKE i scope her:** sæson-skift-cron (`SEASON_AUTO_TRANSITION_ENABLED`) er en **separat** beslutning (WS1 Fase 2) og forbliver `false`. Den er ikke nødvendig for stage-by-stage og flippes kun bevidst i et sæson-vindue. Se issue #1596 "Separat beslutning".

### Flag-mekanik (fælles for alle flips)

Flags bor i tabellen `app_config` (`key` TEXT, `value` JSONB). `value` honoreres som:
`true`/`"on"` → tændt · `"beta"` → kun for beta-testere · `false`/`"off"`/fravær → slukket (fail-safe). Kilde: `backend/lib/featureStage.js` (`evaluateFlagStage`).

Relevante keys (verificeret i flag-modulerne):

| Key | Modul | Rolle |
|-----|-------|-------|
| `stage_scheduler_enabled` | `backend/lib/stageSchedulerFlag.js` | Tænder stage-scheduler-cron |
| `auto_prize_enabled` | `backend/lib/autoPrizeFlag.js` | Tænder auto-prize-sweep |
| `race_engine_v2_enabled` | `backend/lib/raceEngineFlag.js` | Race-motoren (ekstra lag scheduleren kræver) |

---

## (a) Pre-flight — verificér migration applied i prod (READ-ONLY)

> **Ingen mutationer i dette trin.** Kun `SELECT`. Køres via Supabase MCP `execute_sql` eller SQL-editoren. Hvis et af tjekkene fejler → **STOP**, migrationen fra PR #1574 er ikke (fuldt) anvendt; aktivér ikke.

**A1 — kolonnerne på `races` findes:**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'races'
  AND column_name IN ('stages_completed', 'scheduled_for')
ORDER BY column_name;
```
Forventet: 2 rækker. `stages_completed` = `integer`, `is_nullable = NO`, default `0`. `scheduled_for` = `timestamp with time zone`, nullable.

**A2 — `race_simulation_runs.source` findes** (cap'en filtrerer på den):

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'race_simulation_runs'
  AND column_name = 'source';
```
Forventet: 1 række, `source` = `text`.

**A3 — `race_stage_schedule`-tabellen findes med korrekt PK:**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'race_stage_schedule'
ORDER BY ordinal_position;
```
Forventet kolonner: `race_id` (uuid), `stage_number` (integer), `scheduled_at` (timestamp with time zone), `created_at` (timestamp with time zone).

```sql
-- PK = (race_id, stage_number)
SELECT a.attname
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
WHERE i.indrelid = 'public.race_stage_schedule'::regclass AND i.indisprimary;
```
Forventet: `race_id` + `stage_number`.

**A4 — RLS på `race_stage_schedule` (player-facing read, admin write):**

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'race_stage_schedule'
ORDER BY policyname;
```
Forventet: `race_stage_schedule_select_authenticated` (SELECT) + `race_stage_schedule_admin_write` (ALL).

**A5 — audit-backfill ramte ikke noget galt** (completede løb har `stages_completed = stages`):

```sql
SELECT count(*) AS mismatch
FROM public.races
WHERE status = 'completed' AND stages_completed <> COALESCE(stages, 1);
```
Forventet: `0`.

**A6 — flags står OFF før vi starter** (ingen utilsigtet aktivering allerede):

```sql
SELECT key, value
FROM public.app_config
WHERE key IN ('stage_scheduler_enabled', 'auto_prize_enabled', 'race_engine_v2_enabled')
ORDER BY key;
```
Forventet: `stage_scheduler_enabled` og `auto_prize_enabled` er fraværende eller `off`/`false`. `race_engine_v2_enabled` er sandsynligvis allerede `on` (motoren er live) — noter dens værdi, så rollback kan gendanne den.

**[EJER-BESLUTNING: rækkefølge af aktivering vs. backfill]** Standard nedenfor er: pre-flight → backfill dry-run → backfill live → flip. Alternativ: flip `auto_prize_enabled` alene FØRST (uden scheduler) for at verificere auto-prize isoleret på et manuelt afviklet løb, og først bagefter backfill + scheduler. Benefit (alt-rækkefølge): mindre, mere isolerbar overflade pr. trin. Cost: to observations-vinduer i stedet for ét. Vælg selv.

---

## (b) Backfill dry-run — plan

Backfill-scriptet retrofitter den **live beta-sæson** (Beslutning C-A i planen): det fordeler alle `status='scheduled'`-løb i den aktive sæson ét pr. dag fra i morgen, sorteret på `name` for determinisme, og skriver:
- `races.scheduled_for` = løbets startdag,
- én `race_stage_schedule`-række pr. etape med et fast dansk CET-slot (`12:30`/`15:00`/`18:00`/`21:00`, én etape pr. dag).

**Script:** `backend/scripts/backfillRaceScheduledFor.js`.
**Default = dry-run** (ingen writes). `--live` er det eneste flag der aktiverer writes — **der findes ikke et `--dry-run`-flag; fravær af `--live` ER dry-run** (verificeret: `const dryRun = !process.argv.includes("--live")`).

**Creds:** scriptet læser `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` fra `.env` (hentes via Infisical). Service-key bypasser RLS — kør kun fra et betroet miljø, aldrig dump værdien.

**B1 — kør dry-run (READ-ONLY for DB):**

```bash
node backend/scripts/backfillRaceScheduledFor.js
```

**Forventet output (form):**
```
Sæson <N>: <antal> scheduled løb → <antal> etape-tider.
  <Løbsnavn A>: start <ISO-timestamp svarende til i morgen 12:30 CET>
  <Løbsnavn B>: start <ISO-timestamp svarende til i overmorgen 12:30 CET>
  ...
DRY-RUN — ingen writes. Kør med --live for at anvende.
OK: {"dryRun":true,"races":<n>,"stages":<m>}
```

**Verificér i output før live:**
- [ ] Antal løb matcher forventningen for den aktive beta-sæson.
- [ ] Første løb starter **i morgen** (ikke i dag, ikke i fortiden).
- [ ] `stages`-tallet pr. løb ser rigtigt ud (etape-tider = sum af alle løbs etaper).
- [ ] Ingen ISO-timestamp ligger i fortiden (ellers ville scheduleren afvikle dem straks ved flip).

**Abort-kriterier (kør IKKE `--live` hvis):**
- "ingen aktiv sæson — intet at backfille" (forkert sæson-status, eller kørt mod forkert DB).
- Et løb får en startdag i fortiden/i dag.
- Antallet af løb afviger fra det forventede (peger på forkert miljø/sæson).
- `SUPABASE_URL` peger ikke på prod-projektet (verificér host før live — uden at dumpe key'en).

**[EJER-HANDLING — backfill live]** Når dry-run er verificeret:
```bash
node backend/scripts/backfillRaceScheduledFor.js --live
```
Forventet hale: `LIVE — opdaterede <n> løb + <m> etape-tider.` + `OK: {...,"dryRun":false,...}`.
Scriptet er idempotent for `race_stage_schedule` (sletter de berørte løbs rækker før insert), så en gentaget live-kørsel er sikker.

**Efter-verifikation (READ-ONLY):**
```sql
SELECT r.name, r.stages, r.scheduled_for, count(s.*) AS stage_rows
FROM public.races r
LEFT JOIN public.race_stage_schedule s ON s.race_id = r.id
WHERE r.status = 'scheduled'
GROUP BY r.id, r.name, r.stages, r.scheduled_for
ORDER BY r.scheduled_for;
```
Forventet: hvert scheduled løb har `scheduled_for` sat + `stage_rows = stages`.

---

## (c) Beta-stress-test — script-outline (§6.1)

> **Mål (forever-gate §6.1, verbatim):** "løb afvikles + præmier udbetales + sæson-skift kører ≥1 fuld cyklus uden manuel indgriben." For stage-by-stage konkretiseret i plan-Task 3.8: observér **≥1 fuld etape-cyklus** uden hånds-på.

**Forudsætning:** (a) + (b) gennemført, og flags flippet (d). Observationen løber over flere dage (én etape/dag pr. løb).

### Kontrol-loop pr. etape (gentag indtil et løb er `completed`)

1. **En forfalden etape afvikles på sit slot.** Når `now() >= scheduled_at` for etape `stages_completed + 1`, kører scheduleren den inden for det næste 5-min-tick.
   ```sql
   -- Dagens forfaldne, endnu ikke-afviklede etaper:
   SELECT s.race_id, r.name, s.stage_number, s.scheduled_at, r.stages_completed
   FROM public.race_stage_schedule s
   JOIN public.races r ON r.id = s.race_id
   WHERE s.scheduled_at <= now()
     AND s.stage_number = r.stages_completed + 1
     AND r.status <> 'completed'
   ORDER BY s.scheduled_at;
   ```
2. **`stages_completed` steg med præcis 1:**
   ```sql
   SELECT name, status, stages, stages_completed FROM public.races WHERE id = '<race_id>';
   ```
   Forventet mellem-etape: `status='scheduled'`, `stages_completed` = den netop kørte etape.
3. **Kun den etape skrev resultater** (ikke hele løbet):
   ```sql
   SELECT stage_number, count(*) AS rows
   FROM public.race_results WHERE race_id = '<race_id>'
   GROUP BY stage_number ORDER BY stage_number;
   ```
   Forventet: rækker kun for etaper 1..`stages_completed`.
4. **Daglig cap respekteres** (≤5 scheduler-runs siden dansk midnat):
   ```sql
   -- copenhagenMidnightUTC-ækvivalent: trunkér nu til Europe/Copenhagen-dato, tilbage til UTC.
   SELECT count(*) AS scheduler_runs_today
   FROM public.race_simulation_runs
   WHERE source = 'scheduler'
     AND created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Copenhagen') AT TIME ZONE 'Europe/Copenhagen';
   ```
   Forventet: ≤ 5.
5. **Idempotens:** to ticks i samme vindue må ikke dobbelt-afvikle. Verificér at `stages_completed` ikke hopper >1 pr. etape-slot, og at `scheduler_runs_today` ikke stiger ved et tick uden en forfalden etape.

### Final-etape-cyklus (sidste etape af et løb)

6. **Final stage gør status til `completed`:**
   ```sql
   SELECT name, status, stages, stages_completed FROM public.races WHERE id = '<race_id>';
   ```
   Forventet: `status='completed'`, `stages_completed = stages`.
7. **Finalization kørte (kun ved final):** sæson-race-dage recomputed + bestyrelses-weekend behandlet + Discord-embed sendt. Verificér Discord-løbsopslag + at `recomputeSeasonRaceDays`-effekten ses i `seasons.race_days_completed`.
8. **Auto-prize udbetaler inden for ≤5 min** (næste auto-prize-tick):
   ```sql
   SELECT created_at, reason_code, amount, team_id
   FROM public.finance_transactions
   WHERE reason_code = 'RACE_PRIZE_PAYOUT'
   ORDER BY created_at DESC LIMIT 20;
   ```
   Forventet: nye `RACE_PRIZE_PAYOUT`-rækker for det netop completede løbs hold. Bekræft `races.prize_paid_at` sat.
9. **Auto-prize-idempotens:** kør ikke noget manuelt; bekræft blot at efterfølgende auto-prize-ticks ikke laver dublet-transaktioner (samme `idempotency_key` = ingen ny kreditering).

### Observerbarhed

- [ ] **Sentry rent** for `cron:stage scheduler` og `cron:auto-prize sweep` i hele vinduet (ingen `captureException`).
- [ ] Ingen manuel indgriben var nødvendig på noget tidspunkt → **§6.1 opfyldt**.

**Stress-test-resultat noteres i issue #1596** (kommentar), ikke i denne fil.

---

## (d) Flag-flip-sekvens — **[EJER-HANDLING — backup + flip = ejer]**

> **Backup + selve flippet er ejer-handlinger.** Claude udfører dem ikke. Migrationen er additiv/idempotent, men disciplin: tag en frisk backup-spotcheck før flip (issue #1596 trin 1).

**Forudsætninger før flip:**
- [ ] (a) pre-flight grøn.
- [ ] (b) backfill live kørt + efter-verificeret.
- [ ] **[EJER-HANDLING]** Frisk DB-backup verificeret (`db:verify-restore` grøn / off-site backup-rutine).

**Anbefalet rækkefølge** (motor → udbetaling → scheduler, så afviklingen først tændes når alt under den er klar):

1. `race_engine_v2_enabled` → bekræft `on` (var sandsynligvis allerede; verificér fra A6).
2. `auto_prize_enabled` → `on`.
3. `stage_scheduler_enabled` → `on` (**sidst** — dette er den der begynder at afvikle etaper).

**Flip-metode** (der findes ingen admin-UI til flags — skrives direkte i `app_config` via Supabase). `value` er JSONB; gem strengen `"on"`:

```sql
-- [EJER-HANDLING] Kør én ad gangen, verificér mellem hver.
INSERT INTO public.app_config (key, value) VALUES ('auto_prize_enabled', '"on"'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.app_config (key, value) VALUES ('stage_scheduler_enabled', '"on"'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```
(Ækvivalent til `supabase.from("app_config").upsert({key, value:"on"}, {onConflict:"key"})` — mønstret i `backend/scripts/dev/run-relaunch-rehearsal.mjs`.)

**Verificér flip (READ-ONLY):** kør A6-query igen → de tre keys er `on`.

> Flags læses runtime ved hvert cron-tick — **ingen re-deploy nødvendig**. Effekt indtræder ved næste 5-min-tick.

---

## (e) Rollback

Alle tre dele er runtime-flag-gated → rollback = flip flag tilbage, ingen re-deploy.

**Øjeblikkelig stop (alt):**
```sql
-- [EJER-HANDLING] Sluk afvikling + udbetaling. race_engine_v2 lades typisk stå
-- (slukning af den ville også fjerne den manuelle race-afvikling) — sluk kun hvis motoren selv fejler.
UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'stage_scheduler_enabled';
UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'auto_prize_enabled';
```
Effekt: næste tick afvikler ingen etaper / udbetaler intet. Allerede-kørte etaper og allerede-udbetalte præmier røres ikke.

**Hvis en enkelt etape kørte forkert:** afviklingen er idempotent (delete-then-insert pr. `(race_id, stage_number)`). En forkert etape kan re-afvikles manuelt via admin-stien `POST /admin/races/:id/simulate-stage` (manuel fallback fra PR #1574) efter root-cause er fundet — **ejer/ops-beslutning, ikke automatisk.**

**Hvis et helt løb fejl-completede:** dette er ikke en flag-rollback — det kræver manuel data-korrektion (ejer + Claude i en separat session). Stop scheduleren først (flip off), undgå at auto-prize betaler på et forkert resultat.

**Backfill-rollback** (hvis kalenderen blev forkert): kør backfill `--live` igen (idempotent) efter at have rettet input-forudsætningen, eller nulstil `scheduled_for`/`race_stage_schedule` for de berørte løb manuelt. Scheduleren afvikler intet mens `stage_scheduler_enabled` er `off`.

**Eskalations-signaler → STOP + flip off:**
- `scheduler_runs_today` > 5 (cap brudt — bør være umuligt; indikér bug).
- `stages_completed` hopper >1 i ét slot.
- Dublet-`RACE_PRIZE_PAYOUT`-transaktioner.
- Sentry-fejl på `cron:stage scheduler` / `cron:auto-prize sweep`.

---

## Central patch-note — DRAFT (EN + DA)

> **STATUS: DRAFT — udgives først NÅR WS1 er live (efter flip + §6.1 grøn).** Ejer/Claude lægger den i `PatchNotesPage.jsx` ved aktivering, ikke før. Følg eksisterende versions-/format-konvention i `PatchNotesPage.jsx`. Konsolideres med #1567 (akademi-kuld nye hold ventede på en central patch note).

**EN (primary):**

> **Races now run automatically — one stage at a time.**
> From now on, every race is run one stage per day at a fixed, visible time. You can see each stage's scheduled time ahead of the action — no more waiting for a manual run. When a race finishes its final stage, results, standings and prize money are settled automatically within minutes.
> *(Academy intake: new teams from the youth academy are now also generated automatically. — folder #1567 ind her hvis udgivet samtidig.)*

**DA (secondary):**

> **Løb afvikles nu automatisk — én etape ad gangen.**
> Fra nu af køres hvert løb én etape om dagen på et fast, synligt tidspunkt. Du kan se hver etapes planlagte tid på forhånd — ingen venten på en manuel afvikling. Når et løb kører sin sidste etape, afgøres resultater, stilling og præmiepenge automatisk inden for få minutter.
> *(Akademi-optag: nye hold fra ungdomsakademiet genereres nu også automatisk. — folder #1567 ind her hvis udgivet samtidig.)*

**[FOUNDER-PROSA: ejer skriver]** Hvis patch-noten skal have en personlig "hvorfor / hvad betyder det for forever-relaunchen"-indledning i founder-stemme, skriver ejeren den selv. Ovenstående er den faktuelle changelog-struktur.

---

## Close-out-pegepind

Når §6.1 er bevist: kommentér resultatet på issue #1596, opdatér `docs/NOW.md`-slice hvis aktiv, og udgiv patch-noten. Forever-gate §6.1 markeres grøn i `docs/superpowers/specs/2026-06-19-forever-relaunch-readiness-design.md`-sporet (ejer/Claude).
