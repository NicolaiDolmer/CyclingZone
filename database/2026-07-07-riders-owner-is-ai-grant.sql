-- 2026-07-07 — HOTFIX: GRANT SELECT på riders.owner_is_ai til klient-roller (#2238)
--
-- Rod-årsag: public.riders bruger KOLONNE-NIVEAU SELECT-grants (ingen table-level
-- SELECT; ~82 kolonner er eksplicit grantet til authenticated/anon for at skjule
-- potentiale + ability_caps, jf. #1162 / 2026-06-10-riders-potentiale-column-privilege
-- + 2026-07-02-revoke-ability-caps-client-select). Den nye owner_is_ai-kolonne
-- (2026-07-07-riders-owner-is-ai.sql) blev IKKE grantet.
--
-- Effekt: RidersPage filtrerer klient-side via PostgREST med .eq("owner_is_ai", false).
-- Et filter på en kolonne rollen ikke har SELECT på → permission denied → HELE queryen
-- fejler → rytter-siden var tom for ALLE brugere (service_role/execute_sql bypasser
-- grants og så derfor korrekt data under verifikation — fælden var kun synlig for
-- authenticated/anon).
--
-- owner_is_ai er ikke-følsom: AI-status er allerede offentlig via standings-badges.
-- Anvendt direkte mod prod som incident-fix (rytter-siden nede); denne fil = git-record.
-- Idempotent: GRANT er idempotent.

GRANT SELECT (owner_is_ai) ON public.riders TO authenticated, anon;

-- PostgREST schema-/privilege-cache reload.
NOTIFY pgrst, 'reload schema';
