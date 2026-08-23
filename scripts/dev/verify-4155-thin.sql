select r.name, ld.tier, ld.pool_index, r.stages,
       min(s.game_day) gd_lo, max(s.game_day) gd_hi, min(s.scheduled_at) first_at
from public.races r
join public.league_divisions ld on ld.id = r.league_division_id
join public.race_stage_schedule s on s.race_id = r.id
where r.season_id = '00000000-0000-0000-0000-000000000003'
  and ld.tier = 3 and r.name in ('Coppa Appenninica','Volta Algarvia','Tour de Germanie','Classique du Morbihan')
group by r.id, r.name, ld.tier, ld.pool_index, r.stages
order by r.name, ld.pool_index;
