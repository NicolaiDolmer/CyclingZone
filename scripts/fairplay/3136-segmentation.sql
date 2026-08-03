-- #3136 — segmentering: (a) rytterens værdiniveau, (c) sælger-likviditet.
-- (b) auktion vs. direkte transfer dækkes af 3136-transfers-swaps-band.sql (samme ratio-metrik).

-- (a) VÆRDI-TIER x konkurrence-bucket, reelle p2p-auktioner (n=82)
with won as (
  select a.id, r.market_value, a.starting_price, a.current_price,
    (select count(distinct ab.team_id) from auction_bids ab where ab.auction_id=a.id) as bidders
  from auctions a join riders r on r.id=a.rider_id
  where a.status='completed' and a.seller_team_id is not null and a.current_bidder_id is not null
    and a.seller_team_id <> a.current_bidder_id and r.market_value>0
),
tagged as (
  select *, (current_price::numeric/market_value) as ratio,
    case when bidders>=2 then 'competitive' else 'single' end as comp_bucket,
    case when market_value <= 30000 then '1_budget(<=30k)'
         when market_value <= 150000 then '2_mid(30-150k)'
         else '3_star(>150k)' end as value_tier
  from won
)
select value_tier, comp_bucket, count(*) n,
  round(percentile_cont(0.10) within group (order by ratio)::numeric,3) p10,
  round(percentile_cont(0.50) within group (order by ratio)::numeric,3) p50,
  round(percentile_cont(0.90) within group (order by ratio)::numeric,3) p90
from tagged group by value_tier, comp_bucket order by value_tier, comp_bucket;

-- Resultat (2026-08-03):
--   budget(<=30k)  competitive n=3  p10 0.656 p50 0.869 p90 1.621
--   budget(<=30k)  single      n=30 p10 0.173 p50 0.539 p90 1.118
--   mid(30-150k)   competitive n=9  p10 0.119 p50 0.256 p90 1.114
--   mid(30-150k)   single      n=24 p10 0.109 p50 0.348 p90 0.717
--   star(>150k)    competitive n=2  p10 0.266 p50 0.447 p90 0.628  (n=2 — for lille til tillid)
--   star(>150k)    single      n=14 p10 0.095 p50 0.256 p90 0.555
--
-- MØNSTER (samme retning i BÅDE auktioner og transfers, se 3136-transfers-swaps-band.sql):
-- jo dyrere rytteren er, jo lavere er pris/market_value-medianen. Budget-ryttere handler tæt
-- på deres market_value; star-ryttere handler til en langt større relativ rabat.

-- (c) SÆLGER-LIKVIDITET (before_balance ved salgsafvikling, via finance_transactions)
with won as (
  select a.id, a.seller_team_id, r.market_value, a.current_price,
    (select count(distinct ab.team_id) from auction_bids ab where ab.auction_id=a.id) as bidders
  from auctions a join riders r on r.id=a.rider_id
  where a.status='completed' and a.seller_team_id is not null and a.current_bidder_id is not null
    and a.seller_team_id <> a.current_bidder_id and r.market_value>0
),
joined as (
  -- OBS: sælgerens penge-ind-række er type='transfer_in' (ikke 'transfer_out' — det er køberens
  -- række). before_balance her = sælgerens saldo FØR salgsprovenuet lander.
  select w.*, ft.before_balance,
    (current_price::numeric/market_value) as ratio,
    case when bidders>=2 then 'competitive' else 'single' end as comp_bucket
  from won w
  join finance_transactions ft on ft.related_entity_type='auction' and ft.related_entity_id=w.id
    and ft.team_id=w.seller_team_id and ft.type='transfer_in'
),
tagged as (
  select *, case when before_balance < 50000 then '1_distress(<50k)'
                 when before_balance < 250000 then '2_normal(50-250k)'
                 else '3_flush(>250k)' end as liquidity_tier
  from joined
)
select liquidity_tier, count(*) n,
  round(percentile_cont(0.10) within group (order by ratio)::numeric,3) p10,
  round(percentile_cont(0.50) within group (order by ratio)::numeric,3) p50,
  round(percentile_cont(0.90) within group (order by ratio)::numeric,3) p90,
  count(*) filter (where comp_bucket='competitive') as n_competitive
from tagged group by liquidity_tier order by liquidity_tier;

-- Resultat (2026-08-03), 100% dækning (82/82 har finance_transactions-linje):
--   distress(<50k)   n=16 p10 0.079 p50 0.317 p90 0.709 (2 competitive)
--   normal(50-250k)  n=28 p10 0.118 p50 0.549 p90 1.084 (8 competitive)
--   flush(>250k)     n=38 p10 0.136 p50 0.369 p90 0.930 (4 competitive)
--
-- IKKE monotont: "normal"-likviditet sælger til HØJERE median-ratio end både distress OG
-- flush. Distress-sælgere presses til lavere pris (forventet — nødsalg). Men "flush"-sælgere
-- sælger OGSÅ under normal-niveau — matcher ejerens LEGO-Vestas-observation (3/8-kommentar
-- på #3136): velhavende sælgere underpriser rutinemæssigt egne auktioner uden at være i nød.
-- Likviditet alene er IKKE en ren forklaringsakse for lave ratioer — støtter beslutningen om
-- IKKE at bygge en likviditets-betinget bånd-udvidelse (for kompleks til den signal-styrke
-- dataen viser).
