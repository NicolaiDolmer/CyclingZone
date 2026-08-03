-- #3136 — transfers (direkte forhandling) + swaps, samme ratio-metrik som auktioner, til
-- (b) auktion-vs-transfer-segmentering + input til det globale kombinerede bånd.

-- TRANSFERS (accepterede transfer_offers), pris = counter_amount ?? offer_amount
with t as (
  select tof.id, coalesce(tof.counter_amount, tof.offer_amount) as price, r.market_value
  from transfer_offers tof join riders r on r.id = tof.rider_id
  where tof.status='accepted' and r.market_value > 0
),
tagged as (
  select *, (price::numeric/market_value) as ratio,
    case when market_value <= 30000 then '1_budget(<=30k)'
         when market_value <= 150000 then '2_mid(30-150k)'
         else '3_star(>150k)' end as value_tier
  from t
)
select value_tier, count(*) n,
  round(percentile_cont(0.10) within group (order by ratio)::numeric,3) p10,
  round(percentile_cont(0.50) within group (order by ratio)::numeric,3) p50,
  round(percentile_cont(0.90) within group (order by ratio)::numeric,3) p90
from tagged group by value_tier
union all
select 'ALL', count(*),
  round(percentile_cont(0.10) within group (order by ratio)::numeric,3),
  round(percentile_cont(0.50) within group (order by ratio)::numeric,3),
  round(percentile_cont(0.90) within group (order by ratio)::numeric,3)
from tagged
order by 1;

-- Resultat (2026-08-03, n=36, alle 36 falder inden for sidste 90 dage, ingen AI/bank/test-hold):
--   budget(<=30k) n=15 p10 0.272 p50 0.614 p90 3.188
--   mid(30-150k)  n=15 p10 0.136 p50 0.490 p90 1.344
--   star(>150k)   n=6  p10 0.097 p50 0.235 p90 1.240
--   ALL           n=36 p10 0.139 p50 0.488 p90 1.585  (matcher PR#3227s dry-run 1:1 — god
--                                                       krydstjek på metodologi)
-- SAMME mønster som auktioner: star-ryttere handler til markant lavere ratio end budget.

-- SWAPS (accepterede swap_offers) — per-ben-model, samme som getSwapPriceBandViolation:
--   proposing-ben: (offered.market_value + cash) / requested.market_value
--   receiving-ben: (requested.market_value - cash) / offered.market_value
-- n=6 swaps (12 ben) er for lille til robuste percentiler (samme advarsel som PR#3227).
with s as (
  select so.id, so.cash_adjustment, so.counter_cash,
    ro.market_value as offered_mv, rr.market_value as requested_mv
  from swap_offers so
  join riders ro on ro.id = so.offered_rider_id
  join riders rr on rr.id = so.requested_rider_id
  where so.status='accepted' and ro.market_value>0 and rr.market_value>0
),
legs as (
  select id, ((offered_mv + coalesce(counter_cash,cash_adjustment,0))::numeric / requested_mv) as ratio from s
  union all
  select id, ((requested_mv - coalesce(counter_cash,cash_adjustment,0))::numeric / offered_mv) as ratio from s
)
select count(*) n,
  round(percentile_cont(0.10) within group (order by ratio)::numeric,3) p10,
  round(percentile_cont(0.50) within group (order by ratio)::numeric,3) p50,
  round(percentile_cont(0.90) within group (order by ratio)::numeric,3) p90,
  round(min(ratio)::numeric,3) mn, round(max(ratio)::numeric,3) mx
from legs;

-- Resultat INKL. alle 6 swaps (12 ben): n=12, p10 0.220, p50 1.001, p90 4.926, min 0.008, max 153.843
--
-- *** FUND: max-outlier-benet (153.8x / min-benet 0.008x) er swap 9e426877-04c0-4990-ab80-
-- dbe75e00b13f (2026-07-01): EvoPro (jcarey983@gmail.com) gav en 5.013-værdi rytter + 1.000
-- kontant for Barra CCs 772.214-værdi rytter. Barra CC (jcarey071@gmail.com, division 3,
-- is_frozen=TRUE) er det KENDTE, allerede frosne #2221-svindel-par. Dette er IKKE en ny sag —
-- det ER (en del af) den allerede kendte og allerede-håndterede #2221-sag. Ekskluderet fra
-- kalibreringsgrundlaget nedenfor, fordi vi ellers kalibrerer båndet ud fra selve den handel
-- båndet er bygget til at fange.
with s as (
  select so.id, so.cash_adjustment, so.counter_cash,
    ro.market_value as offered_mv, rr.market_value as requested_mv
  from swap_offers so
  join riders ro on ro.id = so.offered_rider_id
  join riders rr on rr.id = so.requested_rider_id
  where so.status='accepted' and ro.market_value>0 and rr.market_value>0
    and so.id <> '9e426877-04c0-4990-ab80-dbe75e00b13f'  -- kendt #2221 jcarey-par
),
legs as (
  select id, ((offered_mv + coalesce(counter_cash,cash_adjustment,0))::numeric / requested_mv) as ratio from s
  union all
  select id, ((requested_mv - coalesce(counter_cash,cash_adjustment,0))::numeric / offered_mv) as ratio from s
)
select count(*) n,
  round(percentile_cont(0.10) within group (order by ratio)::numeric,3) p10,
  round(percentile_cont(0.50) within group (order by ratio)::numeric,3) p50,
  round(percentile_cont(0.90) within group (order by ratio)::numeric,3) p90,
  round(min(ratio)::numeric,3) mn, round(max(ratio)::numeric,3) mx
from legs;
-- Resultat EKSKL. kendt fraud (n=10 ben, 5 swaps): p10 0.459, p50 1.001, p90 2.166,
-- min 0.190, max 5.271 — meget tættere på 1,0x (fair swap) uden outlieren, som forventet.
