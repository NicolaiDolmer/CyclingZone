-- #7644 (ejer-valg B 4/11): kontakt for loftet paa samlingens gevinst pr. km paa lange
-- nedkoersler i v4-motoren (kun s5_profiles_v3). Med kontakten kan en kaede af smaa
-- grupper paa en lang nedkoersel ikke laengere accelerere oven i hinanden og vinde
-- minutter; dronningeetaperne (#7236) er uroerte.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- Oprettes 'off'. Kun 'on' taender (beta taeller som slukket: kontakten aendrer
-- loebsresultater). Off = motoren som i dag, bit-identisk. Ingen tal her (hard rule 17).
-- Taendes af ejeren efter foer/efter-billedet.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'descent_regroup_cap_7644',
    '"off"'::jsonb,
    'Stage flag (off|on) for #7644 option B: on long descents after the last climb of a mountain stage, a group can no longer gain more than a fixed amount per km on its own pace when it regroups, so a chain of small groups cannot stack their speed and gain minutes. Only s5_profiles_v3 races; the queen-stage tuning (#7236) is untouched. Off = today''s engine, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
