-- #8776 (Refs #8549) · Ugeprioritet er opt-in (ejer 26/11): Week blocks-reglen gaelder kun
-- planer, hvor manageren selv har valgt Ugeblokke. Med training_rotation i beta mærkede Program-
-- fanen enhver gemt plan plan_kind = 'week'; den fejl er rettet i koden (samme PR). Her
-- nulstilles de automatisk mærkede rækker, så de kører dagens felt-regel (NULL) som før.
--
-- Ejer-go 26/11 på #8549 til nulstillingen. Målt før (prod, 26/11, kun optællinger):
--   training_week_plans plan_kind = 'week': 76 rækker på 6 hold, 0 med rotation, 0 med lås
--   training_groups     plan_kind = 'week':  5 grupper på 3 hold, 0 med rotation, 0 med lås
-- Forventet efter: 0 og 0 'week'-rækker uden lås og uden rotation; ingen andre rækker ændres.
--
-- Et eksplicit valg ses på data: en lås (lockSlot i en ugedag) kommer kun fra Week blocks-
-- editoren, og en rotation-kolonne viser et skift fra Rotation til Ugeblokke i Plantype. Sådanne
-- rækker røres ikke. training_week_priority har stået på "off", så ingen kunne vælge før nu.
--
-- IDEMPOTENT: en ny kørsel finder ingen rækker. Kun plan_kind ændres (updated_at, days,
-- rotation røres ikke). Ingen funktioner, ingen DDL. Køres post-merge af auto-migrate (#2642).
-- Lock-sikkerhed (#6342): venter UPDATE på en låst række, giver den op i stedet for at blokere.
-- KUN SIKKER MENS training_week_priority ER OFF (Fable 26/11): en Week blocks-skrivning, der kun
-- ændrer prioritet, efterlader intet spor i days, så efter tænding kan et eksplicit valg ikke skelnes.
-- Derfor gør filen intet, hvis kontakten ikke er 'off'. Den må aldrig genkøres efter tænding.
-- Tæl igen efter deploy: 0 'week'-rækker uden lås og uden rotation i begge tabeller før tænding.
SET lock_timeout = '3s';

UPDATE public.training_week_plans AS p
SET plan_kind = NULL
WHERE p.plan_kind = 'week'
  AND coalesce((SELECT value #>> '{}' FROM public.app_config WHERE key = 'training_week_priority'), 'off') = 'off'
  AND p.rotation IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_each(CASE WHEN jsonb_typeof(p.days) = 'object' THEN p.days ELSE '{}'::jsonb END) AS d(weekday, day)
    WHERE jsonb_typeof(d.day) = 'object' AND d.day ? 'lockSlot'
  );

UPDATE public.training_groups AS g
SET plan_kind = NULL
WHERE g.plan_kind = 'week'
  AND coalesce((SELECT value #>> '{}' FROM public.app_config WHERE key = 'training_week_priority'), 'off') = 'off'
  AND g.rotation IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_each(CASE WHEN jsonb_typeof(g.days) = 'object' THEN g.days ELSE '{}'::jsonb END) AS d(weekday, day)
    WHERE jsonb_typeof(d.day) = 'object' AND d.day ? 'lockSlot'
  );
