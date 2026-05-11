-- Helper-RPC for audit-feature-liveness Detector E (zero-impression-features).
-- Returnerer event-counts pr. event_name over et tidsvindue, så Node-scriptet
-- kan klassificere "deployed feature med 0 impressions de sidste N dage"
-- — generalisering af slice 14 / #279 mønstret til frontend-only features
-- (#137).
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.feature_liveness_event_counts(window_days integer DEFAULT 30)
RETURNS TABLE (event_name text, event_count bigint, last_seen timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    event_name,
    COUNT(*)::bigint AS event_count,
    MAX(created_at) AS last_seen
  FROM public.player_events
  WHERE created_at >= NOW() - (window_days || ' days')::interval
  GROUP BY event_name
  ORDER BY event_name;
$$;

REVOKE ALL ON FUNCTION public.feature_liveness_event_counts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_liveness_event_counts(integer) TO service_role;
