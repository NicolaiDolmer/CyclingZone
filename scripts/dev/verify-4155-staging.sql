-- #4155 post-generator verifikation (read-only)
\echo '--- A: S3 t1-3 loeb med tomme eller tynde felter (forventet: ingen med 0)'
select ld.tier, r.name, r.stages, count(e.rider_id) as entries
from public.races r
join public.league_divisions ld on ld.id = r.league_division_id
left join public.race_entries e on e.race_id = r.id
where r.season_id = '00000000-0000-0000-0000-000000000003' and ld.tier in (1,2,3)
group by ld.tier, r.id, r.name, r.stages
having count(e.rider_id) < 30
order by count(e.rider_id) asc, ld.tier
limit 20;

\echo '--- B: felt-stoerrelse pr. tier (sum + snit pr. loeb)'
select ld.tier, count(distinct r.id) as races, count(e.rider_id) as entries,
       round(count(e.rider_id)::numeric / count(distinct r.id), 1) as avg_field
from public.races r
join public.league_divisions ld on ld.id = r.league_division_id
left join public.race_entries e on e.race_id = r.id
where r.season_id = '00000000-0000-0000-0000-000000000003'
group by ld.tier order by ld.tier;

\echo '--- C: binding_span-overlaps (forventet 0)'
select count(*) as overlapping_pairs
from public.race_entries a
join public.race_entries b
  on a.rider_id = b.rider_id and a.race_id::text < b.race_id::text
 and a.binding_span && b.binding_span
where a.binding_span is not null and b.binding_span is not null;

\echo '--- D: IRL-dato-dobbeltbookinger (skal ogsaa vaere 0)'
with stage_dates as (
  select r.id as race_id, (s.scheduled_at at time zone 'Europe/Copenhagen')::date as d
  from public.races r
  join public.race_stage_schedule s on s.race_id = r.id
  where r.season_id = '00000000-0000-0000-0000-000000000003' and r.status <> 'completed'
)
select count(distinct e1.rider_id) as riders
from public.race_entries e1
join public.race_entries e2 on e2.rider_id = e1.rider_id and e2.race_id > e1.race_id
join stage_dates sd1 on sd1.race_id = e1.race_id
join stage_dates sd2 on sd2.race_id = e2.race_id and sd2.d = sd1.d;

\echo '--- E: de 3 fejlede enheder (hold 9895faf2) - loeb + felt-status'
select r.name, ld.tier, r.stages, count(e.rider_id) as team_entries
from public.races r
join public.league_divisions ld on ld.id = r.league_division_id
left join public.race_entries e on e.race_id = r.id and e.team_id = '9895faf2-f6a1-4ccf-af63-ea4daeb17fcb'
where r.id in ('978fa032-6301-46fc-bfa4-61a3b499750b','48f5e504-8c2b-466f-8a3f-69689ed2e0a0','7b7dd502-57af-474d-ac35-4a91b331969c')
group by r.name, ld.tier, r.stages;

\echo '--- F: hvem er hold 9895faf2'
select name, division, is_ai from public.teams where id = '9895faf2-f6a1-4ccf-af63-ea4daeb17fcb';
