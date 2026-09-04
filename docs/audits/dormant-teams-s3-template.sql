-- [epic #4592] Inaktiv manager (S3-forberedelse) — read-only SQL-skabelon.
--
-- Samme opgørelse som backend/scripts/dormantTeamsReport.js, som ren SQL, til
-- ad-hoc-kørsel (fx via Supabase SQL-editor) uden Node-scriptet. Definitionen
-- ("inaktiv" = 30 dage uden login) matcher backend/lib/managerActivity.js
-- (ejer-beslutning 2/9, #4307). Ren SELECT — ingen writes, ingen DDL.
--
-- "Menneske-hold" = is_ai=false, is_bank=false, is_test_account=false (samme
-- diskriminator som betaResetService/academyIntake/retentionScorecard).
-- is_frozen EKSKLUDERES bevidst ikke — formålet er netop at se hvor mange af
-- de reelle hold der allerede er frosset, som del af S4-beslutningsgrundlaget.
--
-- KØR IKKE mod prod uden orkestratorens eksplicitte kommando (se PR-body).

-- 1) Hold pr. division/pulje med last_seen, dage siden login og bucket.
select
  t.id                                            as team_id,
  t.name                                          as team_name,
  t.division,
  coalesce(ld.label, '(ukendt pulje ' || t.league_division_id || ')') as pool_label,
  t.is_frozen,
  u.last_seen,
  case
    when u.last_seen is null then null
    else extract(epoch from (now() - u.last_seen)) / 86400.0
  end                                              as days_since_login,
  case
    when u.last_seen is null then 'dormant_30d'
    when now() - u.last_seen <= interval '7 days'  then 'active_7d'
    when now() - u.last_seen <  interval '30 days' then 'away_8_30d'
    else 'dormant_30d'
  end                                              as bucket
from teams t
left join league_divisions ld on ld.id = t.league_division_id
left join users u on u.id = t.user_id
where t.is_ai = false
  and t.is_bank = false
  and t.is_test_account = false
order by t.division, pool_label, days_since_login desc nulls first;

-- 2) Opsummering: "aktive mennesker pr. pulje" + de tre buckets + frosne.
select
  t.division,
  coalesce(ld.label, '(ukendt pulje ' || t.league_division_id || ')') as pool_label,
  count(*)                                                             as total_teams,
  count(*) filter (
    where u.last_seen is not null and now() - u.last_seen <= interval '7 days'
  )                                                                    as active_7d,
  count(*) filter (
    where u.last_seen is not null
      and now() - u.last_seen > interval '7 days'
      and now() - u.last_seen < interval '30 days'
  )                                                                    as away_8_30d,
  count(*) filter (
    where u.last_seen is null or now() - u.last_seen >= interval '30 days'
  )                                                                    as dormant_30d,
  count(*) filter (where t.is_frozen)                                  as already_frozen
from teams t
left join league_divisions ld on ld.id = t.league_division_id
left join users u on u.id = t.user_id
where t.is_ai = false
  and t.is_bank = false
  and t.is_test_account = false
group by t.division, pool_label
order by t.division, pool_label;
