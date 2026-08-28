-- Kanal-dimension på traffic_events (#4320).
--
-- Problem: traffic_events havde kolonnerne (id, occurred_at, event, path,
-- device, is_bot, visit_hash). Ingen referrer, ingen UTM. Derfor kunne
-- trafik-siden og signup-siden af funnellen ikke holdes op mod hinanden:
-- vi kunne se "25.642 pageviews" og "67 attribuerede signups" som to tal, men
-- ikke om Reddit konverterer 8 % og Google 1 %.
--
-- Løsning: gem kanal-FAKTA på hver hændelse (rå referrer, afledt vært, UTM),
-- og lad mappingen fra fakta til kanal ske i JS ved læsning
-- (backend/lib/trafficChannel.js). Så kan aliaslisten udvides uden at
-- historiske rækker skal migreres.
--
-- Tabellen er service_role-only (RLS enabled, nul policies) og forbliver det.
-- Ingen af de nye kolonner indeholder PII: referrer er den afsendende side,
-- ikke brugeren. Rå IP og user-agent gemmes fortsat ikke.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION +
-- CREATE INDEX IF NOT EXISTS. Kan køres flere gange uden effekt.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.
--
-- Rollback:
--   ALTER TABLE public.traffic_events
--     DROP COLUMN IF EXISTS referrer,
--     DROP COLUMN IF EXISTS referrer_host,
--     DROP COLUMN IF EXISTS utm_source,
--     DROP COLUMN IF EXISTS utm_medium,
--     DROP COLUMN IF EXISTS utm_campaign,
--     DROP COLUMN IF EXISTS landing_path;
--   DROP INDEX IF EXISTS idx_traffic_events_referrer_host;
--   -- traffic_visit_rollup skal derefter gendannes til 4-kolonne-formen,
--   -- se git-historikken for database/ før denne fil.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Kolonner
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Alle nullable: historiske rækker (46.306 pr. 27/8) har ingen kanal-data, og
-- beacon'en kan lovligt sende en hændelse uden referrer (direkte besøg).
-- ADD COLUMN med NULL-default er en katalog-ændring i Postgres 11+, altså
-- instant uden table rewrite uanset tabelstørrelse.
--
-- Længdegrænserne spejler frontend/src/lib/attribution.js, så de to
-- attributions-veje trunkerer ens: UTM 200 tegn, referrer 500, path 200.

ALTER TABLE public.traffic_events
  ADD COLUMN IF NOT EXISTS referrer      text,
  ADD COLUMN IF NOT EXISTS referrer_host text,
  ADD COLUMN IF NOT EXISTS utm_source    text,
  ADD COLUMN IF NOT EXISTS utm_medium    text,
  ADD COLUMN IF NOT EXISTS utm_campaign  text,
  ADD COLUMN IF NOT EXISTS landing_path  text;

COMMENT ON COLUMN public.traffic_events.referrer IS
  'Rå document.referrer fra klienten, trunkeret til 500 tegn. Ingen PII: dette er den afsendende side, ikke brugeren. (#4320)';
COMMENT ON COLUMN public.traffic_events.referrer_host IS
  'Værten udledt af referrer (lowercase). Self-referral er IKKE normaliseret væk her — det sker ved læsning, så rådata bevares. (#4320)';
COMMENT ON COLUMN public.traffic_events.utm_source IS
  'utm_source fra landings-URL''en, trunkeret til 200 tegn. Vinder over referrer ved kanal-opløsning. (#4320)';
COMMENT ON COLUMN public.traffic_events.landing_path IS
  'Stien for den FØRSTE sidevisning i besøget. Adskilt fra `path`, der er stien for denne enkelte hændelse. (#4320)';

-- Kanal-rapporten grupperer på referrer_host over et tidsvindue. Partielt
-- indeks: langt de fleste rækker har ingen referrer (direkte besøg), og de
-- skal ikke fylde i indekset.
CREATE INDEX IF NOT EXISTS idx_traffic_events_referrer_host
  ON public.traffic_events (referrer_host)
  WHERE referrer_host IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. traffic_visit_rollup: kanal pr. besøg
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Funktionen grupperede før kun (visit_hash, is_bot, pageviews, engaged_events).
-- Den returnerer nu også besøgets FIRST-TOUCH kanal-felter.
--
-- Hvorfor first-touch og ikke seneste: et besøg kan ramme flere sider, og kun
-- den første har en ekstern referrer. De efterfølgende har enten ingen eller
-- vores egen vært (SPA-navigation). Ville vi tage den seneste, ville næsten
-- alle besøg ende som self-referral — præcis det artefakt der gjorde Clarity
-- ubrugelig til attribution (#3819, #2040).
--
-- array_agg(... ORDER BY occurred_at) FILTER (WHERE ... IS NOT NULL) plukker
-- den ældste ikke-tomme værdi. Ved lige occurred_at er valget vilkårligt men
-- deterministisk nok til formålet.
--
-- Signaturen ændres (nye OUT-kolonner), så funktionen skal droppes først:
-- CREATE OR REPLACE kan ikke ændre en returtype.
DROP FUNCTION IF EXISTS public.traffic_visit_rollup(timestamptz);

CREATE FUNCTION public.traffic_visit_rollup(since_ts timestamp with time zone)
RETURNS TABLE(
  visit_hash      text,
  is_bot          boolean,
  pageviews       bigint,
  engaged_events  bigint,
  referrer_host   text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  landing_path    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT te.visit_hash,
         bool_or(te.is_bot) AS is_bot,
         count(*) FILTER (WHERE te.event = 'pageview') AS pageviews,
         count(*) FILTER (WHERE te.event = 'engaged')  AS engaged_events,
         (array_agg(te.referrer_host ORDER BY te.occurred_at)
            FILTER (WHERE te.referrer_host IS NOT NULL))[1] AS referrer_host,
         (array_agg(te.utm_source ORDER BY te.occurred_at)
            FILTER (WHERE te.utm_source IS NOT NULL))[1]    AS utm_source,
         (array_agg(te.utm_medium ORDER BY te.occurred_at)
            FILTER (WHERE te.utm_medium IS NOT NULL))[1]    AS utm_medium,
         (array_agg(te.utm_campaign ORDER BY te.occurred_at)
            FILTER (WHERE te.utm_campaign IS NOT NULL))[1]  AS utm_campaign,
         (array_agg(te.landing_path ORDER BY te.occurred_at)
            FILTER (WHERE te.landing_path IS NOT NULL))[1]  AS landing_path
  FROM public.traffic_events te
  WHERE te.occurred_at >= since_ts
  GROUP BY te.visit_hash
$function$;

COMMENT ON FUNCTION public.traffic_visit_rollup(timestamptz) IS
  'Besøgs-rollup for #2040-scorecardet, udvidet med first-touch kanal-felter i #4320. Kanal-mappingen (host → kanal) sker i backend/lib/trafficChannel.js, ikke her.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Grants: gendan service_role-only EXECUTE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KRITISK, og grunden til at DROP + CREATE af en SECURITY DEFINER-funktion er
-- farligere end det ser ud: en DROP smider funktionens ACL væk, og en frisk
-- CREATE FUNCTION får Postgres' default, som er EXECUTE TO PUBLIC. Uden dette
-- afsnit ville anon og authenticated kunne kalde en SECURITY DEFINER-funktion
-- der læser HELE traffic_events — en tabel der ellers er service_role-only
-- (RLS enabled, nul policies). Det er præcis klassen fra #2858, og hændelsen i
-- #3765 kostede 9 dages eksponering.
--
-- Målet er den ACL funktionen har i prod i dag, verificeret 27/8:
--   postgres=X/postgres | service_role=X/postgres
--
-- REVOKE ALL FROM PUBLIC er det der reelt fjerner default-adgangen. De
-- eksplicitte REVOKE fra anon/authenticated er no-ops når PUBLIC allerede er
-- ryddet, men gør hensigten læsbar og er hvad check-secdef-revoke-lint.mjs
-- kræver af enhver SECURITY DEFINER-funktion.
REVOKE ALL     ON FUNCTION public.traffic_visit_rollup(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.traffic_visit_rollup(timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.traffic_visit_rollup(timestamptz) TO service_role;
