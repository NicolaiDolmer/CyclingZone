-- #2176: atomic market payments stay on when auto-accept goes from beta to on.
-- market_beta_mode_2176() is true only while auto-accept is in beta (with the
-- bid lock on) or while the bid lock itself is in beta. Its five money uses
-- (discretionary finance guard, paid release, paid cash swap, scouting
-- assignment, ordinary auction creation) would answer 'legacy' and switch off
-- for every team the moment auto-accept became on. They now use
-- market_atomic_payments_2176(), which equals the old gate in every flag state
-- except one: bid lock on/true AND auto-accept on/true is now protected too.
-- Beta scoping (who sees an auto-price, market_scope_2176, pair, transport,
-- bid scoping) is untouched. No flag values are changed.
--
-- The five functions are NOT recreated from a copied body. Each is patched in
-- place from its current pg_get_functiondef, replacing only the one gate call
-- (same technique as 2026-11-11-8015-auto-accept-academy-riders.sql). A copied
-- body would silently roll back any later fix to the same function: #8015
-- patched the seller floor in create_market_auction_2176 after the beta-scope
-- migration, and a copy of the older text would undo it. Patching in place
-- keeps whatever the live definition already contains, so the only change is
-- the gate. Exactly one old gate call is required per function; a function
-- that already carries the new gate is skipped (idempotent re-apply); anything
-- else aborts the whole transaction. Signatures, owner, ACL, SECURITY DEFINER
-- and search_path are preserved by CREATE OR REPLACE from the definition.
-- The guard trigger itself is not recreated (no table DDL). Additive/idempotent.
-- Production apply is post-merge (auto-migrate).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_atomic_payments_2176()
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_config m WHERE m.key='market_commitment_6181'
   AND (m.value='"beta"'::jsonb OR (m.value IN ('"on"'::jsonb,'true'::jsonb)
     AND EXISTS(SELECT 1 FROM public.app_config a WHERE a.key='auto_accept_enabled'
       AND a.value IN ('"beta"'::jsonb,'"on"'::jsonb,'true'::jsonb)))))
$$;
REVOKE ALL ON FUNCTION public.market_atomic_payments_2176() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_atomic_payments_2176() TO service_role;

DO $migration$
DECLARE
  old_gate constant text := 'public.market_beta_mode_2176()';
  new_gate constant text := 'public.market_atomic_payments_2176()';
  sig text;
  fn regprocedure;
  def text;
  n_old integer;
  n_new integer;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.market_discretionary_finance_guard_2176()',
    'public.auto_accept_release_paid_2176(uuid,uuid,integer,uuid[],boolean,bigint,jsonb)',
    'public.auto_accept_claim_swap_paid(uuid,uuid,uuid,uuid,boolean,timestamptz,jsonb,jsonb,uuid,bigint,jsonb)',
    'public.market_scout_assignment_2176(uuid,jsonb,jsonb)',
    'public.create_market_auction_2176(jsonb,uuid,integer,uuid[])']
  LOOP
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE EXCEPTION '#2176: prerequisite % missing', sig;
    END IF;
    def := pg_get_functiondef(fn);
    n_old := (length(def) - length(replace(def, old_gate, ''))) / length(old_gate);
    n_new := (length(def) - length(replace(def, new_gate, ''))) / length(new_gate);
    IF n_old = 0 AND n_new = 1 THEN
      CONTINUE;
    ELSIF n_old = 1 AND n_new = 0 THEN
      EXECUTE replace(def, old_gate, new_gate);
    ELSE
      RAISE EXCEPTION '#2176: unexpected gate calls in % (old %, new %)', sig, n_old, n_new;
    END IF;
  END LOOP;
END
$migration$;

-- Re-assert the same service-only ACLs as 2026-11-10-2176-transfer-payment-beta-scope.sql.
REVOKE ALL ON FUNCTION public.market_discretionary_finance_guard_2176() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.auto_accept_release_paid_2176(uuid,uuid,integer,uuid[],boolean,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_release_paid_2176(uuid,uuid,integer,uuid[],boolean,bigint,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.auto_accept_claim_swap_paid(uuid,uuid,uuid,uuid,boolean,timestamptz,jsonb,jsonb,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_swap_paid(uuid,uuid,uuid,uuid,boolean,timestamptz,jsonb,jsonb,uuid,bigint,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.market_scout_assignment_2176(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_scout_assignment_2176(uuid,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.create_market_auction_2176(jsonb,uuid,integer,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_market_auction_2176(jsonb,uuid,integer,uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
