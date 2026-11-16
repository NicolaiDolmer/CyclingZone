-- #7801 (Fable-dom 16/11): kontakten fatigue_now_7801 får sin række i app_config, seedet "off".
--
-- Koden (backend/lib/riderFatigueNowFlag.js) læser allerede kontakten, og en manglende række
-- betyder slukket. Rækken gør den slukkede tilstand eksplicit og synlig i admin, så ejeren kan
-- tænde den uden manuel INSERT. Ingen ændring af adfærd: kun den eksakte værdi "on" tænder.
--
-- Additiv og idempotent (INSERT ... ON CONFLICT DO NOTHING): en eksisterende værdi overskrives
-- aldrig. Køres post-merge af auto-migrate (#2642); kan køres igen. Tænding er ejer-only.
-- Rækkefølge ved tænding (ejer 15/11): fatigue_now_7801 først, så training_settle_race_session.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'fatigue_now_7801',
  '"off"'::jsonb,
  'Switch for fatigue now (#7801): surfaces, training rules and the assistant''s selection use the opening plus the date''s raced stages. Only the exact value on turns it on. off = the opening value and rules as before. Turn on before training_settle_race_session, off in reverse. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
