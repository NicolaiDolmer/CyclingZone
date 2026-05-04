# Slice S-01 · Salary GENERATED column

**Status:** P0, ikke startet. Opdateret 2026-05-04.

## Mål
Eliminér den tilbagevendende værdi/løn-bug permanent ved at gøre `riders.salary` til en GENERATED column i Postgres så ingen kode-path kan skrive et forkert tal.

## Runtime-evidens (root cause)
Dual formula konflikt — to kode-paths overskriver hinanden gensidigt:
- [backend/lib/economyEngine.js:44](backend/lib/economyEngine.js:44): `SALARY_RATE = 0.10` (10%) — brugt af `updateRiderValues()` (sæson-end + UCI-cron)
- [backend/lib/marketUtils.js:47](backend/lib/marketUtils.js:47): hardkodet `* 0.15` (15%) — brugt af `calculateMarketSalary()` → `auctionFinalization.js:23`
- Test [marketUtils.test.js:11](backend/lib/marketUtils.test.js:11) locker 15%-formlen → har forhindret ad-hoc fix tidligere

**Konsekvens:** Hver auktion → salary = 15%. Hver mandags-cron → salary = 10%. Salaries flyder mellem disse to værdier afhængigt af timing.

## Invariant der beskyttes
- `riders.salary = max(1, round((max(uci_points, 5) * 4000 + prize_earnings_bonus) * 0.10))` — 10% er den ene sande sats (matcher SALARY_RATE-konstantens navngivning).
- Salary kan ALDRIG skrives direkte fra applikationskode efter denne slice — kun via UPDATE på `uci_points` eller `prize_earnings_bonus`.
- Eksisterende test for salary-formel skal opdateres til 10%-reglen.

## Minimal change

1. **Migration `database/2026-05-XX-salary-generated-column.sql`:**
   ```sql
   ALTER TABLE riders DROP COLUMN salary;
   ALTER TABLE riders ADD COLUMN salary INTEGER GENERATED ALWAYS AS (
     GREATEST(1, ROUND((GREATEST(uci_points, 5) * 4000 + COALESCE(prize_earnings_bonus, 0)) * 0.10))
   ) STORED;
   ```
2. **Slet `calculateMarketSalary()`** fra `backend/lib/marketUtils.js:46-48` — fjern import-statements i `auctionFinalization.js:2`.
3. **Slet salary-write i `auctionFinalization.js:23`** — `riders.salary` kan ikke længere skrives.
4. **Opdatér `updateRiderValues()` i `economyEngine.js:694-776`** — fjern `salary`-felt fra `updates`-array; kun `prize_earnings_bonus` skrives.
5. **Slet salary-write i `import_riders.py:554`** (`"salary": 0,`) — kolonnen er nu generated.
6. **Opdatér tests:** `marketUtils.test.js:11` (slet hele 15%-test), tilføj migration-test der verificerer GENERATED-formel mod 10 stikprøver.
7. **Opdatér `docs/FEATURE_STATUS.md`** Økonomi-sektionen med ny formel.
8. **Opdatér `frontend/src/pages/PatchNotesPage.jsx`** med ny version-entry.

## Verification path
1. Migration kørt mod live Supabase via MCP — verificér via `SELECT COUNT(*) FROM riders WHERE salary != ROUND((GREATEST(uci_points, 5) * 4000 + COALESCE(prize_earnings_bonus, 0)) * 0.10)` skal returnere 0.
2. Kør `node backend/scripts/recalculateRiderSalaries.js` — skal nu fejle hvis det forsøger at skrive `salary` (forventet: koden er rettet til kun at skrive `prize_earnings_bonus`).
3. Manuelt: opret en testauktion, byd, finalisér — verificér `salary` i DB matcher 10%-formel (ikke 15%).
4. Kør UCI-cron manuelt via `workflow_dispatch` — verificér ingen salary-drift bagefter.

## Out of scope
- Ændring af `RIDER_VALUE_FACTOR` (4000) eller `MIN_RIDER_UCI_POINTS` (5) — formel-konstanter beholdes.
- Ændring af `prize_earnings_bonus`-beregnings-logik (3-sæsons-gennemsnit) — kun salary-formel røres.
- Drift-monitor (loop A) — separat slice.

## Forudsætninger
- Live Supabase MCP-adgang til at køre migration.
- Backup verificeret før migration (DROP COLUMN er destruktiv hvis migration ruller tilbage).

## Risiko og mitigation
- **Risiko:** Migration tager >5s på 8.699 riders pga. STORED-kolonne fyldes for alle eksisterende rows.
- **Mitigation:** Kør i ned-tid eller ved beta-reset (vi resetter alligevel før launch).
- **Risiko:** En obscur kode-path skriver `salary` direkte (vi ramte dem alle?).
- **Mitigation:** Grep `riders.*salary\s*=\|salary:\s` i hele backend før migration; fail-fast hvis migration ruller mens skrivning sker (DB returnerer fejl).

## Estimat
1 session (~2-3 timer inklusiv smoke-test).
