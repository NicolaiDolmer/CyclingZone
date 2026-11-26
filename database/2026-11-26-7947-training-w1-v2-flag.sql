-- #7947 W1 v2 (ejer 26/11): Program-fanen efter ejerens design (ugeplanen foerst, "Plan for" med
-- Alle ryttere, egen Grupper-fane, indsats som tre knapper under passet, Gem plan fast i bunden).
--
-- Kontakten training_w1_v2 faar sin raekke i app_config, seedet "off". Frontenden laeser den via
-- GET /api/feature-flags (binaer: kun "on" taender, "beta" er off); en manglende raekke er slukket.
-- Den virker kun sammen med training_page_r5. Slukket = Program R5 praecis som i dag.
--
-- Additiv og idempotent (INSERT ... ON CONFLICT DO NOTHING): en eksisterende vaerdi overskrives
-- aldrig. Koeres post-merge af auto-migrate (#2642). Taending er ejer-only.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_w1_v2',
  '"off"'::jsonb,
  'Switch (#7947 W1 v2, owner 26/11): the training page Program tab in the owner''s week-plan design (Plan for with All riders, own Groups tab, Easy/Medium/Hard under each pass, sticky Save plan). Needs training_page_r5. Only the exact value on turns it on. off = as before. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
