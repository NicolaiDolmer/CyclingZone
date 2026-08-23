select ld.tier, count(*) filter (where e.n = 0) as races_with_zero, count(*) as races
from (
  select r.id, r.league_division_id, count(en.rider_id) as n
  from public.races r
  left join public.race_entries en on en.race_id = r.id
  where r.season_id = '00000000-0000-0000-0000-000000000003'
  group by r.id, r.league_division_id
) e
join public.league_divisions ld on ld.id = e.league_division_id
group by ld.tier order by ld.tier;

select name, division, is_ai from public.teams where id = '5b3b1a56-4b4b-44e5-8c78-3016bddbf463';
