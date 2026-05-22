# 2026-05-22 — Race-result submit atomicity + RLS lockdown (#518)

## TL;DR

Sidste `rls_policy_always_true` advisor-warning er nu væk. `pending_race_result_rows` havde permissive `WITH CHECK (true)` på INSERT og `USING (true)` på SELECT — så enhver authenticated user kunne (a) læse andre managers' pending race-result submissions og (b) injicere fake rows under andres `pending_id`. Samtidigt var frontend submit ikke-atomisk: 2 separate `.insert()`-kald uden transaction → kunne efterlade orphan parent rows.

Fix: ny Postgres-RPC `submit_race_results(p_race_id uuid, p_rows jsonb)` der inserter parent + alle children i én transaction (SECURITY INVOKER så RLS stadig håndhæves) + owner-or-admin-gated policies på child-tabellen der joiner til parent for at finde `submitted_by`.

## Hvad gik galt (pre-fix state)

1. **Atomicity** ([RacesPage.jsx:244-258](../../frontend/src/pages/RacesPage.jsx)): submit gjorde 2 separate `.insert()`-kald:
   ```js
   const { data: pending } = await supabase.from("pending_race_results").insert({...}).select("id").single();
   await supabase.from("pending_race_result_rows").insert(rows);
   ```
   Hvis andet kald fejlede (netværk, RLS, validation, hvad som helst) → orphan parent row i DB. Ingen rollback.

2. **RLS på `pending_race_result_rows`** (verificeret via `pg_policies` 2026-05-22):
   - INSERT `WITH CHECK (true)` — enhver kunne inserte hvad som helst tilknyttet ethvert `pending_id`
   - SELECT `USING (true)` — enhver kunne læse alle pending submissions
   
   Selv om parent-tabellen havde fine policies (`auth.uid() = submitted_by` INSERT, owner-or-admin SELECT), kunne child-rows ikke stole på parent-ownership uden eksplicit policy-check.

## Hvad blev fixet

1. **RPC for atomic submit** ([database/2026-05-22-pending-race-result-atomic-rpc.sql](../../database/2026-05-22-pending-race-result-atomic-rpc.sql)):
   ```sql
   CREATE FUNCTION public.submit_race_results(p_race_id uuid, p_rows jsonb)
   RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
   ```
   - `SECURITY INVOKER` → RLS på begge tabeller håndhæves stadig
   - Inden for samme transaction ser child-insert den lige-indsatte parent row (read-after-write inden for transaction, uanset isolation level)
   - Input-validation: auth.uid() ikke NULL, race_id ikke NULL, p_rows er array, count > 0 og ≤ 500 (DOS-guard)
   - `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`

2. **Owner-or-admin-gated child-policies:**
   ```sql
   CREATE POLICY "Owner or admin insert pending rows" ON pending_race_result_rows
     FOR INSERT TO authenticated
     WITH CHECK (
       EXISTS (SELECT 1 FROM pending_race_results p
               WHERE p.id = pending_race_result_rows.pending_id
                 AND p.submitted_by = auth.uid())
       OR public.is_admin()
     );
   ```
   `is_admin()` (SECURITY DEFINER fra #548) bruges konsistent med nylige migrations.

3. **Index på `pending_id`** (FK har ikke automatisk index i Postgres — RLS-join blev seq-scan).

4. **Frontend forenklet** ([RacesPage.jsx:236-254](../../frontend/src/pages/RacesPage.jsx)):
   ```js
   const { error } = await supabase.rpc("submit_race_results", { p_race_id, p_rows });
   if (error) { setSubmitMsg(`❌ ${error.message}`); return; }
   ```

## Live verifikation (impersonation)

| Test | Forventet | Resultat |
|---|---|---|
| User A submit via RPC | success, parent+child commit atomic | ✓ pending_id returned, COUNT(*) = 1 begge tabeller |
| User B SELECT user A's rows | 0 (RLS blokerer) | ✓ 0 rows |
| User B INSERT under user A's pending_id | RLS-violation 42501 | ✓ "new row violates row-level security policy" |
| Admin SELECT user A's rows | > 0 (is_admin() OR-branch) | ✓ 1 row |

Backend approve-results endpoint (service_role) uændret — service_role bypasser RLS uanset.

## Advisor delta

- **Før:** 1 × `rls_policy_always_true` warning på `pending_race_result_rows.Insert pending rows`
- **Efter:** 0 × `rls_policy_always_true` warnings — sidste forekomst fjernet.

(Andre advisors uændret: 6× `rls_enabled_no_policy` INFO på board/import-tabeller, 2× SECURITY DEFINER WARNs på `is_admin`/`get_sprint_metrics`, 1× auth leaked password protection.)

## Forward-guards

- Contract-test [backend/lib/pendingRaceResultRlsContract.test.js](../../backend/lib/pendingRaceResultRlsContract.test.js) fejler hvis migration ændres uden at bevare RPC + tightened policies + index + DOS-guard + auth-check.
- Migration er idempotent (`DROP POLICY IF EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS`) — safe at replay.

## Hvad jeg ville have gjort anderledes

Intet kritisk. Stuck-points:
- Første contract-test brugte `/jsonb_array_length\(p_rows\)\s*>\s*500/` regex som ikke matchede fordi RPC'en bruger `v_row_count > 500` (variable-assignment først). Fixed med `[\s\S]{0,200}` mellem-mønster.

## Related

- #527 (RLS hardening parent — closed sammen med #548)
- #548 (P0/P1 RLS lockdown — leverede `is_admin()` SECURITY DEFINER)
- [.claude/learnings/2026-05-22-rls-permissive-public-policies.md](./2026-05-22-rls-permissive-public-policies.md)
- [docs/RLS_AUDIT_2026-05-22.md](../../docs/RLS_AUDIT_2026-05-22.md)
