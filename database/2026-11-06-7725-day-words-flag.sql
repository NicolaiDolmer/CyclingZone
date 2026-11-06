-- #7725 (ejer 5/11): kontakt for dagsformen i ord efter etapen. Med kontakten skriver
-- broen rytterens dag paa tidslinjen ved maal, og referatet kan sige fx "havde en
-- rigtig god dag". Motoren og resultaterne er uroerte; ordene er kun fortaelling.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender. Off = tidslinjen som i dag, bit-identisk. Ingen tal
-- her (hard rule 17). Taendes af ejeren.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'day_words_7725',
    '"off"'::jsonb,
    'Stage flag (off|on) for #7725: after a stage the timeline carries each rider''s day in words (a really good day, a good day, a bad day with its cause) for the stage report. Words only, never numbers, never before the stage. Needs day_form_6649. No race result changes. Off = today''s timeline, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
