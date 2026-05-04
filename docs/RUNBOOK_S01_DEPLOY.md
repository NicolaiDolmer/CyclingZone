# Runbook — S-01 Salary GENERATED column deploy

**Mål:** Atomart skifte fra applikations-skrevet `riders.salary` til DB-beregnet GENERATED column uden runtime-fejl.

## Hvorfor det skal være atomart

- **Kode-only deploy uden migration:** applikationen stopper med at skrive salary, men DB-kolonnen er stadig ikke-generated → salary-værdier bliver stale (ingen nye writes ankommer).
- **Migration-only uden kode:** DB afviser ALLE rider-update-kald der inkluderer `salary` (som er hver auktion, transfer, lån-buyout og sæson-end-cron) → systemet bryder fuldstændigt.
- **Korrekt rækkefølge:** push kode → Vercel build → run migration → DB beregner alt automatisk.

## Pre-deploy tjekliste

På branch `claude/elastic-solomon-d23189`:
- [ ] `cd backend && npm test` → 103/103 grønne
- [ ] `database/2026-05-04-salary-generated-column.sql` til stede
- [ ] `database/schema.sql` linje 58 viser ny GENERATED-definition
- [ ] `database/supabase_setup.sql` linje 53 viser ny GENERATED-definition
- [ ] Ingen `salary:` writes tilbage i runtime-kode (verificér: `grep -rn "salary:" backend/lib backend/routes scripts | grep -v test | grep -v ".py"`)
- [ ] Patch notes v2.25 entry tilføjet i `frontend/src/pages/PatchNotesPage.jsx`

## Backup verificering

Slice-doc kræver backup før destruktiv migration. Supabase Pro har point-in-time recovery (PITR) automatisk i 7 dage — verificér at PITR er aktivt før du fortsætter:
- Supabase dashboard → Database → Backups → "Point in time" tab
- Hvis PITR ikke er aktivt: tag manuel snapshot via dashboard → vent på complete

## Deploy-rækkefølge

1. **Merge til main** (lokalt på den PC der har worktree):
   ```bash
   cd /c/Users/ndmh3/OneDrive/Skrivebord/cycling-manager
   git checkout main
   git merge --ff-only claude/elastic-solomon-d23189
   git push origin main
   ```

2. **Vent på Vercel deploy** (~2-3 min). Følg https://vercel.com/dolmer/cycling-manager/deployments — vent til seneste deploy er "Ready".

3. **Kør migration via Supabase MCP** umiddelbart efter Vercel "Ready":
   ```sql
   -- Indhold af database/2026-05-04-salary-generated-column.sql
   ALTER TABLE riders DROP COLUMN salary;

   ALTER TABLE riders ADD COLUMN salary INTEGER GENERATED ALWAYS AS (
     GREATEST(1, ROUND(
       (GREATEST(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10
     ))::INTEGER
   ) STORED;
   ```
   Forventet varighed: <10 sekunder for 8.699 ryttere.

4. **Verificér via stikprøve-query** (skal returnere 0):
   ```sql
   SELECT COUNT(*) FROM riders
   WHERE salary != GREATEST(1, ROUND(
     (GREATEST(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10
   )::INTEGER);
   ```

5. **Smoke-test (5 min):**
   - Åbn manager-konto, gå til Auktioner — start en bank-auktion på en fri rytter, læg første bud
   - Vent eller force-finalisér via admin → tjek rytter-detalje for korrekt salary
   - Gå til Transfers — opret tilbud (kun hvis transfer-vindue er åbent), accepter, verificér rytter-overdragelse + salary
   - (Lån-buyout er svær at teste uden eksisterende lejeaftale — observer ved næste real-world buyout)

## Rollback hvis migration fejler

Hvis migration fejler eller stikprøve-query returnerer >0:
```sql
ALTER TABLE riders DROP COLUMN salary;
ALTER TABLE riders ADD COLUMN salary INTEGER DEFAULT 0;
-- DB-tilstand er nu = før migration; men koden writer ikke længere salary →
-- alle salary-værdier er 0. Kør:
UPDATE riders SET salary = GREATEST(1, ROUND(
  (GREATEST(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10
)::INTEGER);
-- Derefter `git revert` på branch og redeploy for at gen-aktivere applikations-skrivning
```

## Post-deploy

- [ ] Marker slice som **done** i `docs/PRODUCT_BACKLOG.md`
- [ ] Flyt `docs/slices/01-salary-generated-column.md` til `docs/archive/slices/`
- [ ] Slet branch lokalt + på origin
- [ ] Postmortem-entry i `.claude/learnings/2026-05-04-s01-dual-formula-bug.md` (slice fiksede en bug → loop C kræver det)

## Hvis du ser fejl efter deploy

- "column salary is generated" fejl ved auction/transfer → en write-path er blevet overset. Grep igen og tilføj fix i hot-patch.
- Salary-tal afviger fra forventet → tjek at uci_points eller prize_earnings_bonus ikke har fået drift; kør `SELECT id, uci_points, prize_earnings_bonus, salary FROM riders ORDER BY uci_points DESC LIMIT 20;` og verificér mod formel.
