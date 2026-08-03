-- #3135 — drill-down helper: alle transfers/auktioner/byttehandler mellem TO
-- specifikke hold, med retning og størrelse pr. transaktion (ikke kun det
-- nettede tal fra 3135-identity-pair-correlation.sql). Brug denne når et par
-- er flagget og du skal se hvad der reelt skete, transaktion for transaktion,
-- før du går til ejeren.
--
-- Erstat de to team_id-værdier i `pair` CTE'en herunder med de to hold du vil
-- undersøge (find dem fx via: select id, name from public.teams where name ilike '%...%').
--
-- Samme regler som hoved-scriptet: outer joins på sælgersiden (bank/AI-sælgere
-- har ofte NULL seller_team_id), selv-handler udelukket, base_value er
-- NUVÆRENDE værdi (ikke historisk — se kendte-begrænsninger-afsnittet i
-- docs/audits/2026-08-03-identity-correlation-3135.md for ældre sager).
--
-- Read-only SELECT. Ingen mutation.

with pair as (
  select unnest(array[
    '00000000-0000-0000-0000-000000000000',  -- <- erstat med team A's id
    '00000000-0000-0000-0000-000000000000'   -- <- erstat med team B's id
  ]::uuid[]) as team_id
)
select 'transfer' as kind, tof.id, tof.created_at,
       stl.name as seller_team, byt.name as buyer_team,
       r.firstname || ' ' || r.lastname as rider, r.base_value as rider_current_value,
       tof.offer_amount as price_paid,
       (coalesce(r.base_value,1000) - tof.offer_amount) as one_sided_flow_toward_buyer
from public.transfer_offers tof
join public.transfer_listings tl on tl.id = tof.listing_id
left join public.teams stl on stl.id = tl.seller_team_id
left join public.teams byt on byt.id = tof.buyer_team_id
left join public.riders r on r.id = tl.rider_id
where tof.status = 'accepted'
  and tl.seller_team_id in (select team_id from pair)
  and tof.buyer_team_id in (select team_id from pair)
  and tl.seller_team_id is distinct from tof.buyer_team_id

union all

select 'auction', a.id, a.actual_end,
       st.name, bt.name,
       r.firstname || ' ' || r.lastname, r.base_value,
       a.current_price,
       (coalesce(r.base_value,1000) - a.current_price)
from public.auctions a
left join public.teams st on st.id = a.seller_team_id
left join public.teams bt on bt.id = a.current_bidder_id
left join public.riders r on r.id = a.rider_id
where a.status = 'completed'
  and a.seller_team_id in (select team_id from pair)
  and a.current_bidder_id in (select team_id from pair)
  and a.seller_team_id is distinct from a.current_bidder_id

union all

select 'swap', s.id, s.created_at,
       pt.name || ' (proposing)', rt.name || ' (receiving)',
       ro.firstname||' '||ro.lastname||' -> '||rt.name || ' | ' ||
         rr.firstname||' '||rr.lastname||' -> '||pt.name ||
         ' | cash_adjustment=' || s.cash_adjustment,
       rr.base_value - ro.base_value,
       s.cash_adjustment,
       ((coalesce(rr.base_value,1000) - coalesce(ro.base_value,1000)) - s.cash_adjustment)
from public.swap_offers s
left join public.teams pt on pt.id = s.proposing_team_id
left join public.teams rt on rt.id = s.receiving_team_id
left join public.riders ro on ro.id = s.offered_rider_id
left join public.riders rr on rr.id = s.requested_rider_id
where s.status = 'accepted'
  and s.proposing_team_id in (select team_id from pair)
  and s.receiving_team_id in (select team_id from pair)
  and s.proposing_team_id is distinct from s.receiving_team_id

order by 3;
