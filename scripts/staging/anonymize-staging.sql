-- anonymize-staging.sql - KUN load-test-staging (#5904). Fjerner prod-afledt persondata og alle
-- DB-gemte eksterne kanaler fra schema public paa staging-branchen (en prod-kopi fra 23/8).
--
-- Koeres med psql mod $env:STAGING_DB_URL EFTER Set-StagingEnv + Assert-LoadtestStagingTarget
-- (kommandoen staar i docs/runbooks/STAGING_LOADTEST_PREP.md, afsnit 4). Kraever ejer-go.
-- Idempotent.
--
-- 1) Eksterne kanaler: discord_settings (DB-gemte webhook-URL'er), alle outbox-tabeller.
-- 2) Brugerindhold, kommunikation, betaling og trafik-logs trunkeres.
-- 3) Alle backup-tabeller (prod-data-kopier, nogle med e-mails) trunkeres - schemaet bevares.
-- 4) public.users og menneske-holdenes navne/managernavne erstattes med aliaser.
-- 5) Miljoe-markoer i app_config (cz_environment = loadtest-staging) som fail-closed anker.
--
-- BEVIDST IKKE HER: schema auth (auth.users m.m.). Udskiftning af auth-brugerne med
-- syntetiske test-brugere er et separat, ejer-godkendt trin - se runbooken
-- docs/runbooks/STAGING_LOADTEST_PREP.md, afsnit "Udestaaende".
\set ON_ERROR_STOP on
begin;

-- 1+2) kanaler, brugerindhold, kommunikation, betaling, trafik
truncate table
  public.discord_settings, public.discord_webhook_outbox, public.race_notify_outbox, public.discord_dm_outbox,
  public.discord_race_digest_log, public.training_condition_timeout_outbox,
  public.email_log, public.email_events, public.email_sweep_runs,
  public.dm_messages, public.dm_reads, public.dm_reports, public.dm_blocks, public.dm_conversation_hides, public.dm_conversations,
  public.forum_reactions, public.forum_replies, public.forum_poll_votes, public.forum_poll_options, public.forum_reports,
  public.forum_thread_reads, public.forum_thread_views, public.forum_category_mutes, public.forum_posts,
  public.player_feedback, public.nps_responses, public.survey_responses, public.survey_completions,
  public.signup_attribution, public.launch_waitlist, public.founder_supporter_waitlist, public.beta_requests,
  public.subscriptions, public.identity_events, public.traffic_events, public.rider_profile_views,
  public.notifications, public.activity_feed, public.admin_log, public.player_events, public.roadmap_votes,
  public.known_issue_reports, public.fairplay_flags, public.fairplay_whitelisted_pairs, public.growth_metric_snapshots
  restart identity;

-- 3) backup-tabeller (data-kopier fra prod)
do $$ declare r record; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '(backup|_snapshot_2026)'
  loop execute format('truncate table public.%I', r.relname); end loop;
end $$;

-- 4) public.users + menneske-hold
update public.users u set
  email = 'loadtest-' || lpad(x.rn::text, 4, '0') || '@loadtest.invalid',
  username = 'loadtest_' || lpad(x.rn::text, 4, '0'),
  discord_id = null, discord_handle = null, discord_dm_enabled = false, discord_dm_prefs = null,
  email_prefs = null, consent_preferences = null, discord_dm_failure_count = 0
from (select id, row_number() over (order by created_at, id) as rn from public.users) x
where u.id = x.id;

update public.teams t set
  name = 'Loadtest Team ' || lpad(x.rn::text, 4, '0'),
  manager_name = 'Loadtest Manager ' || lpad(x.rn::text, 4, '0')
from (select id, row_number() over (order by created_at, id) as rn from public.teams where not is_ai) x
where t.id = x.id;

-- 5) miljoe-markoer
insert into public.app_config (key, value)
values ('cz_environment', '"loadtest-staging"'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- verifikation (ruller transaktionen tilbage hvis noget er tilbage)
do $$ declare n int; begin
  select count(*) into n from public.users where email not like '%@loadtest.invalid' or discord_id is not null;
  if n > 0 then raise exception 'users ikke anonymiseret: %', n; end if;
  select count(*) into n from public.discord_settings; if n > 0 then raise exception 'discord_settings ikke tom'; end if;
end $$;
commit;
