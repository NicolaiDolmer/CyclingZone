-- #3136 — verificerer ejerens strukturelle fund fra ugescanningen 3/8: "ALLE handler under
-- 0,6x lukkede på præcis starting_price med præcis 1 byder" — testet mod FULD historik
-- (ikke kun ugevinduet 27/7-3/8) for at se om mønstret holder generelt.

with won as (
  select a.id, a.starting_price, a.current_price, r.market_value,
    (select count(distinct ab.team_id) from auction_bids ab where ab.auction_id=a.id) as bidders
  from auctions a join riders r on r.id=a.rider_id
  where a.status='completed' and a.seller_team_id is not null and a.current_bidder_id is not null
    and a.seller_team_id <> a.current_bidder_id and r.market_value>0
)
select
  (current_price = starting_price) as clears_at_start,
  (bidders=1) as single_bidder,
  (current_price::numeric/market_value < 0.6) as under_0_6x,
  count(*)
from won
group by 1,2,3
order by 3 desc,2 desc,1 desc;

-- Resultat (kørt 2026-08-03, n=82 reelle auktioner):
--   under 0.6x total = 53/82 (65%)
--     43 = single-bidder + clears exactly at starting_price (ren "intet prisopdagelse"-sag)
--      3 = single-bidder men prisen bevægede sig over starting_price (delvis opdagelse)
--      7 = KONKURRENCEUDSAT (2+ budgivere) OG under 0,6x — ægte lav klaring via reel
--          budkrig (fx Hajun Hong-sagen fra #3136: 0,22x med 5 bud fra 3 hold)
-- Konklusion: ejerens fund BEKRÆFTES for hovedparten (43/53 = 81%), men er ikke universelt —
-- 7 af de 53 lav-ratio-handler er ægte konkurrenceudsatte og bør IKKE tolkes som
-- "ingen prisopdagelse". Under 0,6x er derfor hverken "altid mistænkeligt" (#2226s oprindelige
-- antagelse) eller "altid støj" — det kræver bidder-count for at fortolke korrekt.
