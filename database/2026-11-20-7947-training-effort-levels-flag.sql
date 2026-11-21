-- #7947 (ejer 20/11): "alle sessions kan trænes som easy/medium/hard, ligesom i gamle dage".
--
-- Kontakten training_effort_levels får sin række i app_config, seedet "off". Koden
-- (backend/lib/trainingEffortLevels.js) læser den; en manglende række er slukket. Med "on"
-- kører en programcelles session på feltets valgte indsats (slotEfforts, ellers dagens effort),
-- ellers på sessionens standardniveau. Slukket = præcis som i dag: indsats-nøglerne ignoreres.
-- Ingen ny kolonne: nøglerne er additive i training_week_plans.days / training_groups.days (JSON).
--
-- Additiv og idempotent (INSERT ... ON CONFLICT DO NOTHING): en eksisterende værdi overskrives
-- aldrig. Køres post-merge af auto-migrate (#2642). Tænding er ejer-only.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_effort_levels',
  '"off"'::jsonb,
  'Switch (#7947, owner 20/11): every training session can be run at easy, normal or hard. A program cell runs at its chosen effort (slot effort, else the day effort), else at the session''s standard level. Rest and active recovery ignore effort; a race wins as before. Only the exact value on turns it on. off = as before. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
