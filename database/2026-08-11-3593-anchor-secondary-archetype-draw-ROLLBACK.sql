-- ROLLBACK for #3593 — sæt `archetype_draw` tilbage til værdien FØR forankringen.
--
-- Skrevet FØR migrationen blev kørt, ikke bagefter. Den gendanner hele jsonb-feltet
-- fra backup-tabellen frem for kun at nulstille `secondary`, så en række der måtte
-- have fået andre nøgler ændret imens også kommer retur i sin sikrede form.
--
-- HVORNÅR DEN ER DEN RIGTIGE HANDLING
-- Forankringen ændrer intet synligt (målt: 0 loft-afvigelser, 0 type-skift). Bliver
-- den alligevel rullet tilbage, GENÅBNES driften: sekundæren udpeges igen af
-- klassifikatoren hver nat for de 573, og de to skrivestier bliver igen uenige om
-- hvilken sekundær der former loftet.
--
-- VIGTIGT — kør IKKE denne blindt hvis lofterne er blevet genopbygget siden.
-- Ruller man anlægget tilbage EFTER at `ability_caps` er regnet af det forankrede
-- anlæg (#3591 pkt. 2), står rytteren med lofter formet af én sekundær og et anlæg
-- der peger på en anden. Rul i så fald lofterne tilbage FØRST
-- (rider_derived_abilities-backuppen fra den kørsel), derefter dette.
--
-- IDEMPOTENT: en anden kørsel skriver 0 rækker (værdierne er allerede gendannet).

BEGIN;

UPDATE public.riders r
SET archetype_draw = b.archetype_draw_before
FROM public.riders_3593_backup_20260811 b
WHERE r.id = b.rider_id
  AND r.archetype_draw IS DISTINCT FROM b.archetype_draw_before;

COMMIT;

-- POST-VERIFY (begge skal give 0):
--   SELECT count(*) FROM public.riders r
--     JOIN public.riders_3593_backup_20260811 b ON b.rider_id = r.id
--    WHERE r.archetype_draw IS DISTINCT FROM b.archetype_draw_before;
--
--   -- og bestanden er tilbage i før-tilstanden (forventet: samme antal som backuppen):
--   SELECT count(*) FROM public.riders
--    WHERE is_retired = false AND archetype_draw ->> 'secondary' IS NULL;
