-- #3136 — empirisk prisbånd fra KONKURRENCEUDSATTE auktioner (2+ uafhængige budgivere).
-- READ-ONLY. Kør mod prod via execute_sql (project_id ghwvkxzhsbbltzfnuhhz) eller psql.
--
-- VIGTIGT — datahygiejne: 10 af 92 "completed" peer-to-peer-auktioner er SELV-HANDLER
-- (seller_team_id = current_bidder_id): udløbne auktioner uden eksterne bud, hvor systemet
-- logger sælgeren som "vinder" for at lukke rækken. Ingen penge skifter reelt hænder mellem
-- to parter — disse 10 er EKSKLUDERET nedenfor (reel population: 82, ikke 92).
--
-- Outer-join-fælden (jf. #2776/#2221-læring): systemauktioner har seller_team_id NULL.
-- Forrige worker faldt i denne fælde (join droppede dem). Her filtrerer vi EKSPLICIT
-- seller_team_id IS NOT NULL for kun at se peer-to-peer (ikke bank/AI-salg), ikke fordi vi
-- outer-joiner forkert.

with won as (
  select a.id, a.rider_id, a.seller_team_id, a.current_bidder_id as buyer_team_id,
         a.starting_price, a.current_price, a.created_at, a.actual_end,
         r.market_value,
         (select count(distinct ab.team_id) from auction_bids ab where ab.auction_id = a.id) as distinct_bidders
  from auctions a
  join riders r on r.id = a.rider_id
  where a.status = 'completed'
    and a.seller_team_id is not null           -- peer-to-peer, ikke bank/AI-salg
    and a.current_bidder_id is not null        -- nogen vandt (reel handel)
    and a.seller_team_id <> a.current_bidder_id -- IKKE selv-handel (se ovenfor)
    and r.market_value > 0
),
tagged as (
  select *,
    (current_price::numeric / market_value) as clear_ratio,
    (starting_price::numeric / market_value) as start_ratio,
    (case when distinct_bidders >= 2 then 'competitive' else 'single_bidder' end) as comp_bucket,
    (actual_end >= now() - interval '90 days') as last90
  from won
)
select comp_bucket, last90,
  count(*) n,
  round(avg(clear_ratio),3) mean_clear,
  round(percentile_cont(0.05) within group (order by clear_ratio)::numeric,3) p05_clear,
  round(percentile_cont(0.10) within group (order by clear_ratio)::numeric,3) p10_clear,
  round(percentile_cont(0.50) within group (order by clear_ratio)::numeric,3) p50_clear,
  round(percentile_cont(0.90) within group (order by clear_ratio)::numeric,3) p90_clear,
  round(percentile_cont(0.95) within group (order by clear_ratio)::numeric,3) p95_clear
from tagged
group by comp_bucket, last90
order by comp_bucket, last90;

-- Resultat (kørt 2026-08-03): ALLE 82 reelle p2p-auktioner falder inden for de sidste 90 dage
-- (spillet har kun eksisteret ~87 dage siden open beta 2026-05-08) — "hele historikken" og
-- "sidste 90 dage" er derfor SAMME datasæt for auktioner.
--   competitive (n=14): mean 0.587, p05 0.111, p10 0.139, p50 0.441, p90 1.124, p95 1.367
--   single_bidder (n=68): mean 0.476, p05 0.095, p10 0.108, p50 0.426, p90 0.931, p95 1.099
