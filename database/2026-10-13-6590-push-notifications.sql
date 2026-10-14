-- =============================================================================
-- 2026-10-13 · Push-notifikationer: kanal, abonnementer, udsendelses-log (#6590)
-- =============================================================================
--
-- Design (ejer-go 13/10, uden aendringer):
--   docs/superpowers/specs/2026-10-13-6584-push-og-twa-design.md §1-§5
--
-- Push er en ny KANAL for de notifikationer der allerede skrives
-- (notifications-tabellen via notifyUser), som e-mail (users.email_prefs) og
-- Discord-DM (users.discord_dm_prefs). Ingen ny begivenheds-model.
--
-- Objekter:
--   1. users.push_prefs (jsonb, {"categories": {"auctions": true, ...}}) og
--      users.timezone (IANA, NULL = Europe/Copenhagen). Fravaer af en kategori
--      = kategoriens standard (backend/lib/pushService.js, PUSH_CATEGORIES).
--   2. push_subscriptions: ét abonnement pr. browser/enhed. Endpoint er
--      personhenfoerbart (GDPR): slettes ved fravalg, ved log ud, ved
--      konto-sletning (cascade) og naar push-tjenesten svarer 404/410.
--   3. push_deliveries: hvad der er sendt (loft pr. doegn + historik).
--      Ryddes efter 30 dage af sweepen selv.
--   4. push_queue: notifikationer der venter paa et resumé (digest-kategori,
--      stille timer eller doegnloftet naaet).
--   5. app_config.push_enabled = "off" (stadie-flag, off|beta|on). Ingen
--      spiller faar push foer ejeren flytter flaget fra admin-fladen.
--
-- Adgang: KUN service_role (backend). Klienten taler aldrig direkte med
-- tabellerne; abonnementer oprettes/slettes via /api/push/* saa endpoint og
-- noegler valideres ét sted. Spec'ens "spilleren maa se og slette sine egne"
-- er derfor ikke givet som RLS-policy: ingen klient-kode har brug for det.
--
-- Idempotent: IF NOT EXISTS overalt, ON CONFLICT DO NOTHING paa flaget (et
-- stadie ejeren allerede har flyttet overskrives aldrig). Apply sker post-merge
-- via auto-migrate.yml (#2642).
--
-- data-api-access: {"table":"public.push_subscriptions","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Backend manages web push subscriptions via /api/push; clients never read them directly"}
-- data-api-access: {"table":"public.push_deliveries","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","DELETE"]},"reason":"Backend push sweep log for the daily cap; never exposed to clients"}
-- data-api-access: {"table":"public.push_queue","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","DELETE"]},"reason":"Backend push sweep holds notifications for the next digest; never exposed to clients"}

BEGIN;
-- ALTER TABLE paa users (hot tabel): fejl hurtigt i stedet for at koe bag
-- spillertrafik. En timeout faar migrationen til at fejle rent; den kan koeres igen.
SET LOCAL lock_timeout = '5s';

-- 1) Praeferencer + tidszone. Konstant default = kun metadata (ingen omskrivning).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS push_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS timezone text;

-- 2) Abonnementer.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) <= 2048),
  p256dh text NOT NULL CHECK (length(p256dh) <= 256),
  auth text NOT NULL CHECK (length(auth) <= 64),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO service_role;

-- 3) Udsendelses-log. notification_ids: én (enkelt push) eller flere (resumé).
CREATE TABLE IF NOT EXISTS public.push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  notification_ids uuid[] NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('sent', 'gone', 'failed'))
);
CREATE INDEX IF NOT EXISTS push_deliveries_user_day_idx ON public.push_deliveries (user_id, sent_at DESC);
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_deliveries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.push_deliveries TO service_role;

-- 4) Koe til naeste resumé. Én raekke pr. (spiller, notifikation).
CREATE TABLE IF NOT EXISTS public.push_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL,
  category text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('digest', 'quiet', 'cap')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, notification_id)
);
CREATE INDEX IF NOT EXISTS push_queue_queued_idx ON public.push_queue (queued_at);
ALTER TABLE public.push_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.push_queue TO service_role;

-- 5) Stadie-flaget. Startstadie off; flippes kun paa ejer-go.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'push_enabled',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for web push notifications (#6590, owner design go 2026-10-13). Off = no push is sent and no opt-in is shown. beta = beta testers and admins only. Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT on the backend; without them the sweep stays idle whatever the stage.'
)
ON CONFLICT (key) DO NOTHING;
COMMIT;
