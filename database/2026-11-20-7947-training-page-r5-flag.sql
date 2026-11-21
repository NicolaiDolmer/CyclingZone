-- #7947 (ejer 20/11): den nye træningssides I dag-fane (R5).
--
-- Kontakten training_page_r5 får sin række i app_config, seedet "off". Frontenden læser den via
-- GET /api/feature-flags (binær: kun "on" tænder, "beta" er off); en manglende række er slukket.
-- Med "on" viser Træning fanen Day i R5-udgaven; de andre faner er uændrede. Slukket = præcis
-- som i dag.
--
-- Additiv og idempotent (INSERT ... ON CONFLICT DO NOTHING): en eksisterende værdi overskrives
-- aldrig. Køres post-merge af auto-migrate (#2642). Tænding er ejer-only.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_page_r5',
  '"off"'::jsonb,
  'Switch (#7947, owner 20/11): the training page Day tab in its R5 version (one line per rider, quick choice Rest/Easy/Medium/Hard, Day load, status in the row). Only the exact value on turns it on. off = as before. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
