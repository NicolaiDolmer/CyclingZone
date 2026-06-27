-- CZ Pro billing rails (#1903) — entitlement-tabel for betalte abonnementer.
--
-- Datamodel:
--   - subscriptions: én række pr. team med aktivt/historisk Pro-abonnement.
--     Provider-agnostisk: alunta_* er eksterne referencer; sandheden om
--     adgang er status + current_period_end (= is_pro beregnes i koden,
--     backend/lib/entitlement.js + frontend/src/lib/useSubscription.js).
--     RLS: en manager kan kun SELECTe sin EGEN række (via teams.user_id).
--     Writes sker KUN fra backend (service_role bypasser RLS) — ingen
--     INSERT/UPDATE-policy for authenticated.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + DROP
-- POLICY IF EXISTS før CREATE. schema_migrations-insert håndteres af
-- .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  alunta_customer_id text,
  alunta_subscription_id text,
  status text NOT NULL DEFAULT 'inactive',      -- active | cancelled | past_due | inactive
  plan_interval text,                            -- monthly | semiannual
  is_founder boolean NOT NULL DEFAULT false,
  current_period_end timestamptz,
  last_event_id text,                            -- idempotens-guard for webhooks
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ét abonnement pr. team (upsert-nøgle for webhook-handleren).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_team_id_key ON public.subscriptions(team_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = (SELECT auth.uid())));

GRANT SELECT ON public.subscriptions TO authenticated;
