-- #6110 (ejer 19/11): "Hold uden division skal ikke træne."
--
-- Kontakten training_calendar_tick_ai_only får sin række i app_config, seedet "off". Koden
-- (backend/lib/trainingCalendarTickFlag.js) læser den; en manglende række er slukket. Med "on"
-- får kun AI-hold uden division kalenderdagens reservetick (form, træthed, skade, ingen
-- udvikling); et menneskehold uden division træner ikke. Slukket = præcis som i dag.
--
-- Additiv og idempotent (INSERT ... ON CONFLICT DO NOTHING): en eksisterende værdi overskrives
-- aldrig. Køres post-merge af auto-migrate (#2642). Tænding er ejer-only.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_calendar_tick_ai_only',
  '"off"'::jsonb,
  'Switch (#6110, owner 19/11: teams without a division do not train): only AI teams without a division get the calendar-day fallback tick; a human team without a division does not train. Only the exact value on turns it on. off = as before. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
