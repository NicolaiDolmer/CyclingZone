-- #2040 First-party engagement-måling. traffic_events: rå anonyme web-events fra
-- den consent-uafhængige beacon (public-sider). INGEN PII: ingen rå IP/UA, intet
-- bruger-id; visit_hash er dagligt-unlinkable (sha256(ip|ua|dag|secret)).
-- Service-role-only (RLS on, ingen policies/grants — som signup_attribution):
-- skrives af POST /api/collect via service_role, læses kun af GET /api/admin/metrics
-- (via traffic_visit_rollup). Retention 180 dage (backend/cron.js).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

-- ── 1. traffic_events-tabellen ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.traffic_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event       TEXT NOT NULL,          -- 'pageview' | 'engaged'
  path        TEXT,
  device      TEXT,                   -- 'mobile' | 'desktop' | 'tablet' | NULL
  is_bot      BOOLEAN NOT NULL DEFAULT FALSE,
  visit_hash  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traffic_events_occurred ON public.traffic_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_traffic_events_visit    ON public.traffic_events(visit_hash);

ALTER TABLE public.traffic_events ENABLE ROW LEVEL SECURITY;
-- Ingen policies + ingen GRANTs → kun service_role (bypasser RLS) kan røre tabellen
-- (samme privacy-mønster som signup_attribution).

COMMENT ON TABLE public.traffic_events IS
  '#2040 Rå anonyme web-events fra cookieless beacon. Ingen PII. visit_hash = sha256(ip|ua|dag|secret), dagligt unlinkable. Retention 180 dage (cron). Service-role-only.';

-- ── 2. traffic_visit_rollup — aggregér pr. visit (læses af admin-metrics) ────
-- SECURITY DEFINER + locked search_path (mønster fra
-- 2026-06-29-secure-securitydefiner-rpc-grants.sql). Kun service_role kalder den.
CREATE OR REPLACE FUNCTION public.traffic_visit_rollup(since_ts TIMESTAMPTZ)
RETURNS TABLE (visit_hash TEXT, is_bot BOOLEAN, pageviews BIGINT, engaged_events BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT te.visit_hash,
         bool_or(te.is_bot) AS is_bot,
         count(*) FILTER (WHERE te.event = 'pageview') AS pageviews,
         count(*) FILTER (WHERE te.event = 'engaged')  AS engaged_events
  FROM public.traffic_events te
  WHERE te.occurred_at >= since_ts
  GROUP BY te.visit_hash
$$;

REVOKE ALL ON FUNCTION public.traffic_visit_rollup(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.traffic_visit_rollup(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.traffic_visit_rollup(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.traffic_visit_rollup(TIMESTAMPTZ) TO service_role;
