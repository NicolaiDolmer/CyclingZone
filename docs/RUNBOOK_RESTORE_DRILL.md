# Runbook — Supabase backup restore drill

**Issue:** [#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332)
**Parent:** [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323)
**Owner:** Nicolai (executor) · Claude/Manus (drill-assist)
**Sidste drill:** 2026-05-15 — **AFBRUDT i pre-req-stage** (Drill 1, attempt 1). 9 runbook-bugs fundet og rettet inline. Næste forsøg: efter pre-req-tools installeret + PITR-status afklaret. Rapport: [#332 comment](https://github.com/NicolaiDolmer/CyclingZone/issues/332).

> Formålet er at bevise at vi kan restore production til en kendt-god tilstand HURTIGT og UDEN at korrumpere spil-state. En backup der aldrig er restored er en antagelse, ikke resiliens.

---

## Cadence

| Fase | Frekvens | Trigger |
|---|---|---|
| Open beta (nu) | **Månedligt** (første mandag) | Calendar-event + `claude:todo` issue |
| Post-stable launch | **Kvartalsvis** hvis 3 beta-drills er grønne | Kvartal-kickoff |
| Ad-hoc | Efter destruktiv migration (slice-doc krav) eller efter et reelt incident | Slice-doc / postmortem |

Hvis en drill **fejler** (smoke-tests røde, restore tager >2t, eller PITR-window er kortere end forventet) → frekvens tilbage til månedligt indtil tre grønne i træk.

---

## Pre-drill checkliste

På production-projektet (`ghwvkxzhsbbltzfnuhhz`):

- [ ] **Verificér PITR-status** (kritisk — afgør Path A vs B):
  - Dashboard → Project (Cycling Zone) → **Settings → Add-ons** → tjek om "Point in Time Recovery" er enabled (Pro tier feature)
  - **Alternativt**: Database → Backups — hvis der findes en "Point in time" tab med retention-slider er PITR aktiv. Hvis kun "Daily backups" tab vises er PITR IKKE aktiv (kør Path B i stedet, eller opgrader til Pro før drill).
  - PITR retention skal være ≥ 7 dage for at matche post-incident RTO-mål
- [ ] Tag note af seneste daily backup-timestamp (UTC) — fallback restore-target hvis PITR ikke kan målrettes
- [ ] **Verificér ingen aktiv auktion-finalization kører** via SQL:
  ```sql
  SELECT count(*) FROM public.auctions WHERE status IN ('active','finalizing');
  ```
  Skal være 0 (eller minimum ingen i `finalizing`). Alternativt: manuel check på `/admin/system-status`.
- [ ] Sørg for at den restore-targetede non-prod kopi IKKE har samme service-key som prod (forhindrer crossover-skrivninger)

Forudsætninger (Windows / PowerShell host):

| Tool | Hvornår nødvendigt | Installation |
|---|---|---|
| Supabase MCP (denne harness) | Path A, SQL-smoke-tests | Indbygget — bekræft med `mcp__supabase__list_projects` |
| `psql` (PostgreSQL ≥ 15 client) | Path B + lokal SQL hvis MCP ikke kan målrette target | `winget install PostgreSQL.PostgreSQL.15` eller `scoop install postgresql` |
| `pg_restore` (kommer med PostgreSQL client) | Path B (dump-restore) | Som ovenfor — del af PostgreSQL client-pakken |
| Supabase CLI (`supabase --version` ≥ 1.180) | Magic-link auth i smoke-test A, kun valgfrit | `npm i -g supabase` eller `scoop install supabase` |
| Adgang til Supabase organization | Begge paths | Verificér via dashboard at du er ejer/admin |

> **Note:** Hvis Path A bruges udelukkende via MCP (intet pg_restore-trin), er `psql`/`pg_restore` ikke nødvendige. Drill 1 (2026-05-15) afbrudt fordi disse pre-reqs ikke var dokumenteret som conditionally-needed.

---

## Restore-procedure

Vi restorer til en **separat non-prod Supabase project** (kald det `cyclingzone-restore-drill`). Dette undgår destruktiv test mod production og lader smoke-tests køre uden at påvirke rigtige brugere.

### 1. Forbered target

1. Opret eller find restore-drill projektet i Supabase dashboard. Hvis det ikke findes: ny project i samme org, region = production-region, plan = Free er nok (drill-data slettes).
2. Tag note af restore-target-projektets ref (`<restore-ref>`).
3. Kopiér `auth.users`-schema-rettigheder: ingen action — Supabase auth-schema er auto-provisioned.

### 2. Restore

**Path A — PITR (anbefalet, dækker seneste 7 dage):**

1. Supabase dashboard → production-projekt → Database → Backups → Point in time tab
2. Vælg "Restore to a new project"
3. Target = `cyclingzone-restore-drill`
4. Timestamp = nu - 1 time (giver realistisk afstand uden at fange in-flight transactions)
5. Start restore → vent (typisk 5-30 min afhængig af DB-størrelse)

**Path B — Manuelt snapshot-restore (hvis PITR ikke kan målrettes til separat project):**

1. Production-projekt → Database → Backups → Daily backups tab
2. Download seneste daily backup som `.dump`
3. På target-projekt: `pg_restore --clean --if-exists --no-owner --no-acl -d "$RESTORE_DSN" backup.dump`
4. Verificér: `psql "$RESTORE_DSN" -c "SELECT count(*) FROM riders; SELECT count(*) FROM teams;"`

### 3. Mål restore-tid

Notér tidspunkt for **start** og **end**. Dette er drill-ens primære KPI.

| Restore-tid | Bedømmelse |
|---|---|
| < 30 min | Grøn — incident-response kan love hurtig recovery |
| 30-90 min | Gul — acceptabelt; flag i postmortem hvis det forværres |
| > 90 min | Rød — eskaler; overvej PITR-praksis eller arkitektur-ændring |

---

## Smoke-tests (acceptance)

Kør mod restore-target-projektet. Alle skal være grønne før drill markeres complete.

### A. Auth

- [ ] `auth.users` rækketal matcher production ±0.1% (PITR-snapshot er nogle minutter bagud, så små forskelle er forventet)
- [ ] Login med en kendt test-bruger virker (`supabase auth admin generate-link` → magic link login)
- [ ] RLS aktivt: query `riders` med anon key → returnerer kun publicly-readable rows

### B. Key tables loader og er internt konsistente

```sql
-- Forventede non-null counts (skal sammenlignes mod prod-snapshot taget i pre-drill)
SELECT
  (SELECT count(*) FROM public.teams)                                                            AS teams,
  (SELECT count(*) FROM public.riders)                                                           AS riders,
  (SELECT count(*) FROM public.auctions WHERE status = 'active')                                 AS active_auctions,
  (SELECT count(*) FROM public.auctions WHERE status = 'finalizing')                             AS finalizing_auctions,
  (SELECT count(*) FROM public.transfer_offers WHERE created_at > now()-interval '7 days')       AS recent_transfer_offers,
  (SELECT count(*) FROM public.finance_transactions WHERE created_at > now()-interval '7 days')  AS recent_finance_tx,
  (SELECT count(*) FROM public.player_events WHERE created_at > now()-interval '1 day')          AS recent_events_1d;
```

- [ ] Ingen tal er 0 medmindre production faktisk har 0 (jævnfør prod-baseline taget i pre-drill)
- [ ] `riders.team_id` FK-violation count = 0:
  `SELECT count(*) FROM public.riders r WHERE r.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = r.team_id);`
- [ ] `auctions.rider_id` FK-violation count = 0:
  `SELECT count(*) FROM public.auctions a WHERE NOT EXISTS (SELECT 1 FROM public.riders r WHERE r.id = a.rider_id);`

### C. Spil-invarianter (per `docs/GAME_INVARIANTS.md`)

> **Status-enum** for `auctions.status`: `active`, `finalizing`, `completed`, `cancelled`. Der findes IKKE en `finalized`-status. Vinder af afsluttet auktion er `current_bidder_id` (auctions har ikke en `winner_team_id`-kolonne).

- [ ] **Squad-limit** (coarse upper-bound — division 1 cap er 30; div 2 = 20; div 3 = 10. Denne query fanger kun grove violations, ikke division-specifikke. For division-aware check, joinet via `teams.division` kræves):
  `SELECT team_id, count(*) FROM public.riders WHERE team_id IS NOT NULL GROUP BY team_id HAVING count(*) > 30;` → 0 rows
- [ ] **Auktion-finalization-state konsistent**: ingen `status = 'completed'` uden `current_bidder_id` (vinder)
  `SELECT count(*) FROM public.auctions WHERE status = 'completed' AND current_bidder_id IS NULL;` → 0
- [ ] **Salary GENERATED column virker**: salary er `GENERATED ALWAYS` som `floor(market_value * 0.10)`. Validér ved sampling at formel holder:
  `SELECT count(*) FROM public.riders WHERE salary IS NOT NULL AND salary <> GREATEST(1, round(market_value * 0.10));` → 0
  (Den gamle check `WHERE salary IS NULL AND market_value IS NOT NULL` er tautologisk siden salary er GENERATED ALWAYS — kan aldrig være NULL.)

### D. Backend smoke (mod restore-DSN)

Kør backend lokalt med restore-projekt env vars. **Backend lytter på port 3001** (`backend/server.js:23`), ikke 4000.

```pwsh
$env:SUPABASE_URL = "https://<restore-ref>.supabase.co"
$env:SUPABASE_SERVICE_KEY = "<restore-service-key>"  # NB: service-key, ikke service-role-key
cd backend; npm start
# i anden terminal:
curl http://localhost:3001/health                    # forvent 200
curl http://localhost:3001/api/auctions              # forvent 401 (auth-gate)
curl http://localhost:3001/api/admin/system-status   # forvent 401 uden token
```

- [ ] Backend starter uden DB-errors i log
- [ ] Health = 200
- [ ] Auth-gates virker (401)

---

## Drill-rapportering

Efter drill skrives en **kort rapport** under issue [#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332) som comment med dette skema:

```markdown
## Restore drill — YYYY-MM-DD

- **Restore-tid:** XX min (grøn/gul/rød)
- **PITR-target:** YYYY-MM-DD HH:MM UTC (- 1 time fra start)
- **Target project:** cyclingzone-restore-drill (<restore-ref>)
- **Smoke-tests:** A ✅ / B ✅ / C ✅ / D ✅
- **Afvigelser:** _(eller "ingen")_
- **Næste drill:** YYYY-MM-DD (per cadence)
- **Action items:** _(eller "ingen")_
```

Hvis afvigelser → opret follow-up issue med label `risk:high` + link til drill-rapporten.

---

## Provider-outage politik (incident playbook)

Når restore reelt udløses pga. outage (ikke drill), gælder følgende politik. Princip: **availability må ikke korrumpere spil-state**.

| Failure | Read-policy | Write-policy | Bruger-comms |
|---|---|---|---|
| Supabase DB ned (writes) | Cache/stale OK for visning | **Fail closed** — auctions/transfers/payments afvises med tydelig UI-besked | Discord-status + in-app banner inden for 10 min |
| Supabase DB ned (reads også) | Vis vedligeholdelses-side | Som ovenfor | Discord + status-side med ETA |
| Redis ned (når #334 er live) | **Fail open** — bypass cache, hit DB direkte | Rate-limit fallback til in-process limiter, log warning | Ingen bruger-comms medmindre P95 eskalerer |
| Auktion-finalization fejler | N/A | **Frys hele markedet** indtil finalization verificeret per `docs/GAME_INVARIANTS.md` | In-app banner + Discord straks |
| Rate-limit false positive (legit users blokeret) | N/A | `RATE_LIMIT_DISABLED=1` på Railway accepteret som break-glass; verificér abuse-risiko inden for 1 time efter | Ikke nødvendig medmindre vedvarende |

**Restore-drift efter outage:** Hvis en reel restore er nødvendig, brug samme procedure som drill, men restore til **production-projektet** (ikke target). Verificér smoke-tests B+C **før** brugerne får adgang igen. Replay-policy: events fra outage-vinduet replays IKKE automatisk — manuel review per case.

---

## Referencer

- [`docs/AI_OPS_BLIND_SPOTS.md`](AI_OPS_BLIND_SPOTS.md) — blind spot 1 (restore cadence) + blind spot 5 (incident comms)
- [`docs/AI_OPS_COST_MODEL.md`](AI_OPS_COST_MODEL.md) — kapacitets-baselines
- [`docs/GAME_INVARIANTS.md`](GAME_INVARIANTS.md) — spil-konsistens-regler brugt i smoke-test C
- [`docs/RUNBOOK_S01_DEPLOY.md`](RUNBOOK_S01_DEPLOY.md) — PITR-verification mønster genbrugt her
- [Supabase Backups docs](https://supabase.com/docs/guides/platform/backups)

---

## Drill-historik

| Dato | Resultat | Restore-tid | Smoke-tests | Note |
|---|---|---|---|---|
| 2026-05-15 | **Afbrudt (pre-req)** | n/a | n/a | Drill 1 attempt 1. PITR-status ikke afklaret, CLI-tools ikke installeret, 9 runbook-bugs fundet og rettet inline. Næste forsøg blocked på [#374](https://github.com/NicolaiDolmer/CyclingZone/issues/374). |
