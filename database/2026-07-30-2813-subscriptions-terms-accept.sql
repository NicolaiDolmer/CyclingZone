-- #2813: accept-log for handelsbetingelser på subscriptions.
--
-- Ved checkout gemmer backenden hvilken vilkårs-version kunden accepterede og
-- hvornår (bevis for straks-leverings-waiver + version, jf. forbrugeraftale-
-- loven). Skrives KUN af backend (service_role) i billingCheckout.js FØR
-- checkout-sessionen oprettes; webhook-upserten rører ikke kolonnerne, så
-- accepten overlever aktivering/opsigelse.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Ingen RLS-ændring (select-own-policyen
-- dækker allerede hele rækken; writes er fortsat service_role-only).

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

COMMENT ON COLUMN public.subscriptions.terms_version IS
  'Vilkårs-version kunden accepterede ved checkout (#2813). Sync med CURRENT_TERMS_VERSION i backend/lib/billingCheckout.js.';
COMMENT ON COLUMN public.subscriptions.terms_accepted_at IS
  'Tidspunkt for accept af handelsbetingelser + straks-leverings-waiver (#2813).';
