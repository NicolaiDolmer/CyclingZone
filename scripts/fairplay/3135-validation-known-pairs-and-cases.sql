-- #3135 — validerings-harness. Kører identitets- + værdistrøms-logikken fra
-- 3135-identity-pair-correlation.sql, men hårdkodet mod:
--   (a) de 5 kendte lovlige par fra 30/7-scanningen (#3131) — skal IKKE flagges
--   (b) EvoPro <-> Barra CC (#2221) — SKAL flagges
-- #2776 kan IKKE genkøres her: kontoen `kps@latitude.dk` og holdet "Racing bike"
-- blev slettet som del af sanktionen (se #2776's egen "gennemført"-sektion).
-- Værdistrømmen for #2776 er i stedet gen-verificeret mod backup-tabellerne
-- backup_fairplay_20260722_* (stadig i prod pr. 2026-08-03) — se forespørgsel
-- nederst i filen + docs/audits/2026-08-03-identity-correlation-3135.md.
--
-- Team-id'er er hentet 2026-08-03 (prod). Genfind dem om nødvendigt via:
--   select t.id, t.name, u.email, u.username from public.teams t
--   join public.users u on u.id = t.user_id where t.name ilike '%...%';
--
-- Read-only SELECT. Ingen mutation.

with pairs(pair_label, expect_flag, team_a, team_b) as (
  values
    ('24/7 Aspire-Light <-> Metro-L3 (kendt lovligt par, 30/7)', false,
      'e5a97dd5-c9b2-431d-8a03-7cb2d074468b'::uuid, 'ae1257e5-4ed2-45fb-93b8-743cbe9270d8'::uuid),
    ('Wheelbarrels <-> Nickstar Rockets (kendt lovligt par, 30/7)', false,
      'c1bd6094-e755-4545-b2c5-00da48de724f'::uuid, '5917bfa7-a877-4e3f-806b-8e390ff41948'::uuid),
    ('Morse Codes <-> Velocity One (kendt lovligt par, 30/7)', false,
      '0a4ed517-213f-410a-bb4c-203b2ed8bd50'::uuid, '46ab68a8-9490-43c6-830a-36c88c709c42'::uuid),
    ('TR Cycling <-> LEGO-Vestas (kendt lovligt par, 30/7)', false,
      '7527c89c-809e-44e0-92b9-5e6bce83e345'::uuid, '82d343f7-832b-4e67-959e-91e93b95b0c1'::uuid),
    ('Bad At Names <-> ejerens testkonti (kendt lovligt, @cyclingzone.dev)', false,
      '814b9df1-e2b9-4a3c-9ac1-ac33d7439bc4'::uuid, '7d968e90-ab56-4eb3-832d-2d9d0515a954'::uuid),
    ('EvoPro <-> Barra CC (#2221 — SKAL flagges)', true,
      'bc0a0b86-07e5-47cb-8cd2-fc6ae038b0df'::uuid, '6cd69a8a-3cb1-4459-87c9-1dcd34a64d02'::uuid)
),
ip_fanout as (
  select ip, count(distinct user_id) as fanout from public.identity_events where ip is not null group by ip
),
prefix_fanout as (
  select ip_prefix, count(distinct user_id) as fanout from public.identity_events where ip_prefix is not null group by ip_prefix
),
pair_users as (
  select p.pair_label, p.expect_flag, p.team_a, p.team_b,
    ta.id as user_a, tb.id as user_b,
    ta.email as email_a, tb.email as email_b,
    ta.username as username_a, tb.username as username_b,
    ta.created_at as created_a, tb.created_at as created_b
  from pairs p
  join public.teams t_a on t_a.id = p.team_a
  join public.teams t_b on t_b.id = p.team_b
  join public.users ta on ta.id = t_a.user_id
  join public.users tb on tb.id = t_b.user_id
),
signals as (
  select pu.*,
    coalesce(exists (
      select 1 from public.identity_events ia join public.identity_events ib on ib.ip = ia.ip
      join ip_fanout f on f.ip = ia.ip
      where ia.user_id = pu.user_a and ib.user_id = pu.user_b and f.fanout <= 2
    ), false) as ip_exact_low_fanout,
    coalesce(exists (
      select 1 from public.identity_events ia join public.identity_events ib on ib.ip_prefix = ia.ip_prefix
      join prefix_fanout f on f.ip_prefix = ia.ip_prefix
      where ia.user_id = pu.user_a and ib.user_id = pu.user_b and f.fanout <= 2
    ), false) as ip_prefix_low_fanout,
    coalesce((
      select sa1.first_seen_at::text from public.signup_attribution sa1 where sa1.user_id = pu.user_a
    ) = (
      select sa2.first_seen_at::text from public.signup_attribution sa2 where sa2.user_id = pu.user_b
    ), false) as first_seen_at_match,
    coalesce(abs(extract(epoch from (pu.created_a - pu.created_b))) <= 900, false) as signup_proximity_match,
    coalesce(
      nullif(regexp_replace(lower(split_part(pu.email_a,'@',1)), '[0-9]+$', ''), '') is not null
      and length(nullif(regexp_replace(lower(split_part(pu.email_a,'@',1)), '[0-9]+$', ''), '')) >= 4
      and regexp_replace(lower(split_part(pu.email_a,'@',1)), '[0-9]+$', '') = regexp_replace(lower(split_part(pu.email_b,'@',1)), '[0-9]+$', ''),
    false) as email_weak_match
  from pair_users pu
),
tx as (
  select pu.pair_label, pu.team_a, pu.team_b,
    case when tof.buyer_team_id = pu.team_a then pu.team_a else pu.team_b end as flow_toward_team,
    (coalesce(r.base_value,1000) - tof.offer_amount) as flow_amount
  from pair_users pu
  join public.transfer_offers tof on true
  join public.transfer_listings tl on tl.id = tof.listing_id
  left join public.riders r on r.id = tl.rider_id
  where tof.status = 'accepted'
    and ((tl.seller_team_id = pu.team_a and tof.buyer_team_id = pu.team_b)
      or (tl.seller_team_id = pu.team_b and tof.buyer_team_id = pu.team_a))
  union all
  select pu.pair_label, pu.team_a, pu.team_b,
    case when a.current_bidder_id = pu.team_a then pu.team_a else pu.team_b end,
    (coalesce(r.base_value,1000) - a.current_price)
  from pair_users pu
  join public.auctions a on true
  left join public.riders r on r.id = a.rider_id
  where a.status = 'completed'
    and ((a.seller_team_id = pu.team_a and a.current_bidder_id = pu.team_b)
      or (a.seller_team_id = pu.team_b and a.current_bidder_id = pu.team_a))
  union all
  select pu.pair_label, pu.team_a, pu.team_b,
    case when s.proposing_team_id = pu.team_a then pu.team_a else pu.team_b end,
    ((coalesce(rr.base_value,1000) - coalesce(ro.base_value,1000)) - s.cash_adjustment)
  from pair_users pu
  join public.swap_offers s on true
  left join public.riders ro on ro.id = s.offered_rider_id
  left join public.riders rr on rr.id = s.requested_rider_id
  where s.status = 'accepted'
    and ((s.proposing_team_id = pu.team_a and s.receiving_team_id = pu.team_b)
      or (s.proposing_team_id = pu.team_b and s.receiving_team_id = pu.team_a))
),
pair_flow as (
  select pair_label, count(*) as n_tx,
    sum(case when flow_toward_team = team_a then flow_amount else -flow_amount end) as net_flow_toward_team_a
  from tx group by pair_label, team_a
)
select
  s.pair_label, s.expect_flag,
  s.ip_exact_low_fanout, s.ip_prefix_low_fanout, s.first_seen_at_match, s.signup_proximity_match, s.email_weak_match,
  (s.ip_exact_low_fanout or s.ip_prefix_low_fanout or s.first_seen_at_match or s.signup_proximity_match or s.email_weak_match) as identity_connected,
  coalesce(pf.n_tx, 0) as n_transactions_all_time,
  coalesce(pf.net_flow_toward_team_a, 0) as net_flow_toward_team_a,
  (
    (s.ip_exact_low_fanout or s.ip_prefix_low_fanout or s.first_seen_at_match or s.signup_proximity_match or s.email_weak_match)
    and coalesce(pf.n_tx, 0) > 0
    and abs(coalesce(pf.net_flow_toward_team_a, 0)) > 100000
  ) as actually_flagged,
  (
    (
      (s.ip_exact_low_fanout or s.ip_prefix_low_fanout or s.first_seen_at_match or s.signup_proximity_match or s.email_weak_match)
      and coalesce(pf.n_tx, 0) > 0
      and abs(coalesce(pf.net_flow_toward_team_a, 0)) > 100000
    ) = s.expect_flag
  ) as matches_expectation
from signals s
left join pair_flow pf on pf.pair_label = s.pair_label
order by s.pair_label;

-- #2776 re-verifikation (backup-tabeller, ikke live users/teams — kontoen er
-- slettet). Kør separat efter ovenstående:
--
-- select bu.email, bu.username, bu.created_at as user_created_at,
--        bt.name as team_name
-- from backup_fairplay_20260722_users bu
-- join backup_fairplay_20260722_teams bt on bt.user_id = bu.id
-- where bu.email = 'kps@latitude.dk';
--
-- select bto.id, bto.offer_amount, bto.status, bto.created_at,
--        st.name as seller_team_name, bt.name as buyer_team_name,
--        r.firstname, r.lastname, r.base_value
-- from backup_fairplay_20260722_transfer_offers bto
-- left join backup_fairplay_20260722_teams st on st.id = bto.seller_team_id
-- left join backup_fairplay_20260722_teams bt on bt.id = bto.buyer_team_id
-- left join public.riders r on r.id = bto.rider_id
-- where st.name in ('Racing bike','Minisize Biking') or bt.name in ('Racing bike','Minisize Biking')
-- order by bto.created_at;
--
-- Forventet resultat (verificeret 2026-08-03): 2 transfers, Racing bike ->
-- Minisize Biking, 1 kr. stykket, rytternes nuværende base_value 2.419.441 og
-- 303.964 (historisk, på hændelsestidspunktet: 1.787.739 og 179.322 pr. #2776's
-- egen rapport — værdi-drift siden pga. sæson-progression, jf. kendte
-- begrænsninger). Ensidig værdistrøm ~2,4-2,7 mio., langt over 100.000-tærsklen.
--
-- Identitetssignalet der løste #2776 (first_seen_at-arv, 61 sek. forskel, tre
-- uger tidligere) er DOKUMENTERET i issuet men ikke gen-udtrækkeligt i dag:
-- signup_attribution-rækken blev cascade-slettet med brugeren og indgår ikke i
-- backup-tabellerne (kun users/teams/transfer_offers/riders/race_entries/
-- orphan_entries blev sikkerhedskopieret 22/7). Det er PRÆCIS dette signal
-- (identity_events.first_seen_at, primær kilde signup_attribution.first_seen_at)
-- som #3135-scriptet nu korrelerer på for ALLE fremtidige sager — #2776 er selve
-- grunden til at signal 3 findes i designet.
