-- #3136 — (1) kombineret "ærlig pris"-reference på tværs af konkurrenceudsatte auktioner +
-- transfers + rensede swap-ben, og (2) falsk-positiv-rater for kandidat-bånd mod de sidste
-- 90 dages FAKTISKE handler (= hele historikken for denne unge økonomi, se nedenfor).

-- (1) KOMBINERET REFERENCE (n=60: 14 konkurrenceudsatte auktioner + 36 transfers + 10 rensede
-- swap-ben, kendt #2221-fraud-swap ekskluderet)
with comp_auctions as (
  select (a.current_price::numeric / r.market_value) as ratio
  from auctions a join riders r on r.id=a.rider_id
  where a.status='completed' and a.seller_team_id is not null and a.current_bidder_id is not null
    and a.seller_team_id <> a.current_bidder_id and r.market_value>0
    and (select count(distinct ab.team_id) from auction_bids ab where ab.auction_id=a.id) >= 2
),
transfers as (
  select (coalesce(tof.counter_amount,tof.offer_amount)::numeric / r.market_value) as ratio
  from transfer_offers tof join riders r on r.id=tof.rider_id
  where tof.status='accepted' and r.market_value>0
),
swap_legs as (
  with s as (
    select so.cash_adjustment, so.counter_cash, ro.market_value as offered_mv, rr.market_value as requested_mv
    from swap_offers so join riders ro on ro.id=so.offered_rider_id join riders rr on rr.id=so.requested_rider_id
    where so.status='accepted' and ro.market_value>0 and rr.market_value>0
      and so.id <> '9e426877-04c0-4990-ab80-dbe75e00b13f'
  )
  select ((offered_mv + coalesce(counter_cash,cash_adjustment,0))::numeric/requested_mv) as ratio from s
  union all
  select ((requested_mv - coalesce(counter_cash,cash_adjustment,0))::numeric/offered_mv) as ratio from s
),
allratios as (
  select ratio from comp_auctions
  union all select ratio from transfers
  union all select ratio from swap_legs
)
select count(*) n,
  round(percentile_cont(0.05) within group (order by ratio)::numeric,3) p05,
  round(percentile_cont(0.10) within group (order by ratio)::numeric,3) p10,
  round(percentile_cont(0.50) within group (order by ratio)::numeric,3) p50,
  round(percentile_cont(0.90) within group (order by ratio)::numeric,3) p90,
  round(percentile_cont(0.95) within group (order by ratio)::numeric,3) p95
from allratios;
-- Resultat: n=60, p05 0.111, p10 0.150, p50 0.562, p90 1.763, p95 2.167

-- (2) FALSK-POSITIV-RATER: kandidat-bånd anvendt på faktiske handler (transfers n=36,
-- auktions-STARTPRIS n=82 — det er DEN pris PR#3227 rent faktisk håndhæver ved auktions-
-- oprettelse, ikke slutklaringsprisen — samt swaps n=6 med per-swap OR-logik som i
-- getSwapPriceBandViolation: en swap afvises hvis MINDST ét ben bryder båndet).
--
--                                          transfer(n=36)  auction_start(n=82)  swap(n=6)
-- A anbefalet          (0.15 / 1.8)         19.4%           19.5%                50.0%
-- B anbefalet-permissiv(0.10 / 2.2)         11.1%            9.8%                33.3%
-- C ugescan-baseline   (0.6  / 2.3)         63.9%           69.5%                66.7%
-- D #2226 oprindelig   (0.5  / 3.0)         58.3%           57.3%                50.0%
-- E PR#3227 kandidat A (0.25 / 3.0)         27.8%           36.6%                33.3%
--
-- (Swap-baserede FP-rater er baseret på n=6 og bør IKKE tillægges stor vægt — samme
-- begrænsning som PR#3227 selv påpeger.)
