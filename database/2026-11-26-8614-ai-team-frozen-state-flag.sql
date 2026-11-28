-- #8614 · Kontakten ai_team_frozen_state_8614 (binær: kun "on" tænder), seedet "off".
-- Ejer 23/11 + 26/11 (valg B): AI-hold har fast træthed og form, ingen udvikling, ingen skader og
-- intet dagligt træningstick. Off = dagens regel, bit-identisk (backend/lib/aiTeamFrozenState8614.js).
-- Ingen tabel- eller kolonneændring. Engangs-claimen for nulstillingen ved sæsonskiftet er en
-- app_config-række (ai_team_frozen_state_8614_reset), som backenden selv indsætter første gang;
-- den seedes IKKE her. Idempotent: ON CONFLICT DO NOTHING rører aldrig en eksisterende værdi.
-- Køres post-merge af auto-migrate (#2642). Tænding er ejer-only.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'ai_team_frozen_state_8614',
  '"off"'::jsonb,
  'Binary switch (#8614, only "on" turns it on): AI teams keep a fixed fatigue and form in the race engine, get no daily training tick, no development and no injuries. Their injuries and fatigue are reset once at the next season transition (claim row ai_team_frozen_state_8614_reset). Off = today''s rules. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
