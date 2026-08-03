-- #3135 (fair-play epic #3131, lag 3 — detektion: identitets-korrelation som
-- primærsignal). THE deliverable query for #3135's acceptkriterium 1+2.
--
-- Ejer-beslutning 30/7 (#3131, bindende): "Delt identitetssignal ALENE må
-- aldrig udløse et flag. Reglen er forbundet identitet ∧ ensidig
-- værdioverførsel." Denne fil implementerer PRÆCIS den regel — ikke
-- pris-afvigelse, ikke kontoantal.
--
-- Signaler korreleret (jf. issue-teksten, USER-AGENT INDGÅR ALDRIG):
--   1. IP-eksakt        — stærkest, men CGNAT/delte VPN'er giver falske
--                          positiver (verificeret empirisk 2026-08-03: en
--                          dansk mobiloperatørs adresseområde 152.233.12-13.x
--                          delte fem HELT urelaterede konti over 3 dage).
--                          Modforanstaltning: "fan-out"-filter — en ip/ip_prefix
--                          tæller kun som signal hvis højst 2 forskellige
--                          brugere NOGENSINDE har brugt den (dvs. "privat" til
--                          netop dette par). Reducerer risikoen, eliminerer den
--                          IKKE — se advarsel i bunden af filen.
--   2. IP-prefix        — /24 IPv4 (afledt allerede i identity_events af
--                          #3132's trigger), /64 IPv6. Samme fan-out-filter.
--   3. first_seen_at    — signup_attribution.first_seen_at (browser-
--                          localStorage-stempel). PRIMÆR KILDE: signup_attribution
--                          (findes for 88 af 189 brugere, tilbage til april).
--                          identity_events.first_seen_at er kun et supplement
--                          (6 rækker pr. 2026-08-03 — tabellen har kun eksisteret
--                          siden #3132 gik live 2026-07-31). Dette var signalet
--                          der løste #2776.
--   4. Signup-tidsnærhed — to konti oprettet inden for 15 minutter af hinanden.
--   5. Email/brugernavn  — KUN svagt sekundært signal: lokal-del/brugernavn med
--                          tal-suffiks strippet, normaliseret til samme streng
--                          (min. 4 tegn for at undgå støj). Dette var signalet
--                          der (alene) fangede #2221 (jcarey071 vs jcarey983).
--
-- Populationen er ALTID kun rigtige spillerhold (is_ai=false, is_bank=false) —
-- jf. memory [[feedback_match_ui_filter_for_capacity_logic]]: samme filter som
-- UI'ets "rigtige hold".
--
-- Værdistrøm: for hver transaktion mellem to hold beregnes hvor meget værdi der
-- flyttede til modtageren udover det modtageren betalte (rytterens nuværende
-- base_value minus prisen for transfers/auktioner; for byttehandler:
-- (modtaget rytters værdi - afgivet rytters værdi) - cash_adjustment). Summeret
-- pr. par og NETTET pr. retning, så to modsatrettede handler der cirka opvejer
-- hinanden IKKE tælles som "ensidig" — det er selve pointen med at måle NETTO.
--
-- KENDT BEGRÆNSNING: base_value er NUVÆRENDE værdi, ikke værdien på handels-
-- tidspunktet (ingen historisk value-snapshot findes i skemaet). For handler i
-- de sidste 90 dage er drivet typisk lille; for ældre sager (fx #2221, 5 uger
-- gammel pr. denne kørsel) kan nuværende base_value afvige fra den historiske
-- markedsværdi pga. sæson-progression. Se docs/audits/2026-08-03-identity-
-- correlation-3135.md for hvordan #2221/#2776 er verificeret trods dette.
--
-- Outer joins på sælgersiden overalt (transfer_listings, auctions.seller_team_id)
-- — lektionen fra #2776/#3137: bank/AI-sælgere har ofte NULL seller_team_id, og
-- et inner join smider de rækker væk. Selv-handler (samme hold begge sider —
-- forekommer for auto_squad_purchase-bogføring ved holdoprettelse) udelukkes
-- eksplicit (`IS DISTINCT FROM`), ellers forurener de par-grupperingen.
--
-- Whitelist: JOIN mod public.fairplay_whitelisted_pairs (database/2026-08-03-
-- fairplay-pair-whitelist.sql — IKKE APPLICERET endnu af #3135-workeren) er
-- inkluderet nedenfor som en LEFT JOIN + WHERE-udelukkelse. Findes tabellen
-- ikke i det miljø forespørgslen køres i, fjern blot det ene filter (markeret
-- "WHITELIST" nedenfor) — resten af forespørgslen er upåvirket.
--
-- Kør: read-only SELECT. Ingen mutation. Parametre er hårdkodede konstanter
-- nedenfor (90 dage, 15 minutter, fan-out<=2, min. værdi-magnitude 100.000) —
-- juster med omtanke, og se docs/audits/2026-08-03-identity-correlation-3135.md
-- for hvordan de blev kalibreret mod de 5 kendte par fra 30/7-scanningen.
-- Værdi-magnitude-tærsklen (100.000) er lånt fra #2226 regel 2's oprindelige
-- konvention og er BEVIDST ikke finkalibreret her — det er #3136's ansvar.

with human_users as (
  select u.id as user_id, u.email, u.username, u.created_at, t.id as team_id, t.name as team_name
  from public.users u
  join public.teams t on t.user_id = u.id
  where t.is_ai = false and t.is_bank = false
),
ip_fanout as (
  select ip, count(distinct user_id) as fanout
  from public.identity_events
  where ip is not null
  group by ip
),
prefix_fanout as (
  select ip_prefix, count(distinct user_id) as fanout
  from public.identity_events
  where ip_prefix is not null
  group by ip_prefix
),
user_fsa as (
  -- signal 3: signup_attribution er PRIMÆR kilde (historisk, tilbage til #679).
  -- identity_events.first_seen_at (kun fra #3132, 2026-07-31+) er fallback for
  -- brugere uden en signup_attribution-række.
  select hu.user_id,
    coalesce(sa.first_seen_at::text, ie.first_seen_at) as first_seen_at
  from human_users hu
  left join public.signup_attribution sa on sa.user_id = hu.user_id
  left join lateral (
    select first_seen_at from public.identity_events
    where user_id = hu.user_id and event_type = 'signup' and first_seen_at is not null
    order by created_at asc limit 1
  ) ie on true
),
user_norm as (
  -- signal 5: lower-case, tal-suffiks strippet. length>=4 filtrerer trivielle/
  -- korte fælles-navne fra (støjreduktion, jf. #2226 regel 3's for-snævre variant
  -- i den anden retning — vi vil hellere have et par ekstra falske positiver her
  -- end at gentage #2226's fejl af at være for snæver).
  select user_id,
    nullif(regexp_replace(lower(split_part(email,'@',1)), '[0-9]+$', ''), '') as email_norm,
    nullif(regexp_replace(lower(username), '[0-9]+$', ''), '') as username_norm
  from human_users
),
pairs as (
  select
    a.user_id as user_a, a.team_id as team_a, a.team_name as team_a_name,
    b.user_id as user_b, b.team_id as team_b, b.team_name as team_b_name,
    -- signal 1 (fan-out-filtreret — "privat" IP, højst set af dette par)
    exists (
      select 1 from public.identity_events ia
      join public.identity_events ib on ib.ip = ia.ip
      join ip_fanout f on f.ip = ia.ip
      where ia.user_id = a.user_id and ib.user_id = b.user_id and f.fanout <= 2
    ) as ip_exact_low_fanout,
    -- rå eksakt-IP-match UDEN fan-out-filter, kun til synlighed/manuel review
    exists (
      select 1 from public.identity_events ia
      join public.identity_events ib on ib.ip = ia.ip
      where ia.user_id = a.user_id and ib.user_id = b.user_id
    ) as ip_exact_any_fanout,
    -- signal 2 (fan-out-filtreret)
    exists (
      select 1 from public.identity_events ia
      join public.identity_events ib on ib.ip_prefix = ia.ip_prefix
      join prefix_fanout f on f.ip_prefix = ia.ip_prefix
      where ia.user_id = a.user_id and ib.user_id = b.user_id and f.fanout <= 2
    ) as ip_prefix_low_fanout,
    -- coalesce(...,false) overalt: undgår at 3-værdi SQL-NULL-logik (fx den ene
    -- side har first_seen_at, den anden ikke) stille propagerer NULL op i
    -- identity_connected i stedet for et eksplicit FALSE.
    coalesce(fa.first_seen_at is not null and fa.first_seen_at = fb.first_seen_at, false) as first_seen_at_match,
    coalesce(abs(extract(epoch from (a.created_at - b.created_at))) <= 900, false) as signup_proximity_match,
    coalesce(na.email_norm is not null and length(na.email_norm) >= 4 and na.email_norm = nb.email_norm, false) as email_weak_match,
    coalesce(na.username_norm is not null and length(na.username_norm) >= 4 and na.username_norm = nb.username_norm, false) as username_weak_match
  from human_users a
  join human_users b on a.user_id < b.user_id
  left join user_fsa fa on fa.user_id = a.user_id
  left join user_fsa fb on fb.user_id = b.user_id
  left join user_norm na on na.user_id = a.user_id
  left join user_norm nb on nb.user_id = b.user_id
),
connected_pairs as (
  select *,
    (ip_exact_low_fanout or ip_prefix_low_fanout or first_seen_at_match
     or signup_proximity_match or email_weak_match or username_weak_match) as identity_connected
  from pairs
  where ip_exact_low_fanout or ip_exact_any_fanout or ip_prefix_low_fanout
     or first_seen_at_match or signup_proximity_match or email_weak_match or username_weak_match
),
tx as (
  -- transfers: flow mod køber = rytterens værdi minus prisen betalt
  select tof.created_at, tl.seller_team_id as from_team, tof.buyer_team_id as to_team,
    (coalesce(r.base_value,1000) - tof.offer_amount) as flow_to_recipient
  from public.transfer_offers tof
  join public.transfer_listings tl on tl.id = tof.listing_id
  left join public.riders r on r.id = tl.rider_id
  where tof.status = 'accepted'
    and tof.created_at >= now() - interval '90 days'
    and tl.seller_team_id is distinct from tof.buyer_team_id
  union all
  -- auktioner: flow mod vinderbud = rytterens værdi minus slutprisen
  select a.actual_end, a.seller_team_id, a.current_bidder_id,
    (coalesce(r.base_value,1000) - a.current_price)
  from public.auctions a
  left join public.riders r on r.id = a.rider_id
  where a.status = 'completed'
    and a.actual_end >= now() - interval '90 days'
    and a.seller_team_id is not null and a.current_bidder_id is not null
    and a.seller_team_id is distinct from a.current_bidder_id
  union all
  -- byttehandler: flow mod proposing_team = (modtaget værdi - afgivet værdi) - cash_adjustment
  -- (cash_adjustment positiv = proposing betaler receiving, jf. schema.sql kommentar)
  select s.created_at, s.receiving_team_id, s.proposing_team_id,
    ((coalesce(rr.base_value,1000) - coalesce(ro.base_value,1000)) - s.cash_adjustment)
  from public.swap_offers s
  left join public.riders ro on ro.id = s.offered_rider_id
  left join public.riders rr on rr.id = s.requested_rider_id
  where s.status = 'accepted'
    and s.created_at >= now() - interval '90 days'
    and s.receiving_team_id is distinct from s.proposing_team_id
),
pair_flow as (
  select
    least(from_team, to_team) as team_x, greatest(from_team, to_team) as team_y,
    sum(case when to_team = greatest(from_team,to_team) then flow_to_recipient else -flow_to_recipient end) as net_flow_toward_y,
    count(*) as n_tx
  from tx
  group by 1, 2
)
select
  cp.team_a_name, cp.team_b_name,
  cp.ip_exact_low_fanout, cp.ip_exact_any_fanout, cp.ip_prefix_low_fanout,
  cp.first_seen_at_match, cp.signup_proximity_match, cp.email_weak_match, cp.username_weak_match,
  cp.identity_connected,
  coalesce(pf.n_tx, 0) as n_transactions_90d,
  coalesce(
    case when least(cp.team_a, cp.team_b) = pf.team_x then pf.net_flow_toward_y else -pf.net_flow_toward_y end,
  0) as net_value_flow_toward_team_b,
  -- FLAG-REGLEN: forbundet identitet ∧ ensidig værdioverførsel > 100.000 (#2226
  -- regel 2's konvention, foreløbig — #3136 ejer endelig kalibrering).
  (cp.identity_connected
   and coalesce(pf.n_tx, 0) > 0
   and abs(coalesce(pf.net_flow_toward_y, 0)) > 100000) as flagged
from connected_pairs cp
left join pair_flow pf
  on pf.team_x = least(cp.team_a, cp.team_b) and pf.team_y = greatest(cp.team_a, cp.team_b)
-- WHITELIST: udelukker kendte lovlige par. Fjern denne left join + where-klausul
-- hvis database/2026-08-03-fairplay-pair-whitelist.sql endnu ikke er applieret.
left join public.fairplay_whitelisted_pairs wp
  on wp.team_id_lo = least(cp.team_a, cp.team_b) and wp.team_id_hi = greatest(cp.team_a, cp.team_b)
where wp.id is null
order by flagged desc, n_transactions_90d desc, abs(coalesce(
    case when least(cp.team_a, cp.team_b) = pf.team_x then pf.net_flow_toward_y else -pf.net_flow_toward_y end, 0
  )) desc,
  cp.team_a_name;

-- ADVARSEL OM FAN-OUT-HEURISTIKKEN (verificeret 2026-08-03):
-- Fan-out<=2 reducerer CGNAT-støj men eliminerer den ikke. Eksempel fundet i
-- denne kørsel: IP 152.233.12.242 havde fanout=2 (kun to hold nogensinde), men
-- ligger i samme /24-område (152.233.12-13.x) som en IP med fanout=5 blandt helt
-- urelaterede spillere — sandsynligvis én mobiloperatørs CGNAT-pulje. Et par med
-- fanout=2 på en enkelt IP i en lille (189-bruger) population kan STADIG være et
-- tilfældigt CGNAT-sammenfald, ikke en husstand. Fremtidig forbedring (ikke
-- bygget her): kræv at samme eksakte IP går igen på TVÆRS AF FLERE ADSKILTE DAGE
-- for begge brugere (vedvarende parring), ikke blot ét overlap — eller vedligehold
-- en liste over kendte CGNAT-/mobiloperatør-ranges. Se docs/audits/2026-08-03-
-- identity-correlation-3135.md, afsnit "Kendte begrænsninger".
