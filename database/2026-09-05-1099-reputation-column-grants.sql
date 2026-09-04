-- #1099 · Kolonne-grants for omdømme-kolonnerne på riders (opfølger til
-- 2026-09-05-1099-reputation-system.sql, som tilføjede kolonnerne uden GRANT).
--
-- riders bruger kolonne-niveau SELECT-grants (#2238/#1309/#2241): en ny kolonne er
-- usynlig for anon/authenticated indtil den grantes eksplicit, og manglen fejler
-- ikke ved apply, den 403'er stille enhver klient-query der rører kolonnen.
-- Flag `rider_reputation_enabled` er off og ingen klient læser kolonnerne endnu,
-- men PR 3 (synlighed) skal kunne læse dem, og CI-vagten
-- (scripts/lint-riders-column-grant.mjs) kræver granten. Idempotent: GRANT er
-- no-op når privilegiet allerede findes.

GRANT SELECT (reputation, reputation_floor, reputation_form, reputation_updated_at)
  ON public.riders TO anon, authenticated;
