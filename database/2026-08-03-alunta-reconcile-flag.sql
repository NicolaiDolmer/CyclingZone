-- database/2026-08-03-alunta-reconcile-flag.sql
-- #2736: feature-flag for den daglige Alunta subscription-reconcile-cron.
-- Reconcilen synker status + current_period_end fra Aluntas GET /subscriptions
-- ind i public.subscriptions (webhookens invoice.paid-event findes ikke hos
-- Alunta, så current_period_end opdateres ellers muligvis aldrig ved fornyelse).
--
-- DEFAULT = DEAKTIVERET (false): reconcile-koden er UVERIFICERET mod Aluntas
-- ægte GET /subscriptions-svarform (ingen levende test_mode-adgang i denne
-- session). Ejeren SKAL køre
--   node scripts/reconcileAluntaSubscriptions.js
-- (dry-run, ingen writes) og bekræfte at feltudtrækket i
-- backend/lib/aluntaSubscriptionReconcile.js matcher det ægte svar, FØR
-- flaget flippes til on. Se PR-beskrivelsen for fuld aktiverings-tjekliste.
--
-- Flip til live: UPDATE public.app_config SET value='true'::jsonb WHERE key='alunta_reconcile_enabled';
-- Slå fra igen:   UPDATE public.app_config SET value='false'::jsonb WHERE key='alunta_reconcile_enabled';
--
-- Idempotent (ON CONFLICT DO NOTHING) — sikker at køre flere gange.

INSERT INTO public.app_config (key, value, description)
VALUES ('alunta_reconcile_enabled', 'false'::jsonb,
  'Feature-flag for den daglige Alunta subscription-reconcile-cron (#2736). false = cronen no-op''er (manuelt script kører uafhængigt af flaget til verifikation). true/"on" = daglig sync af status+current_period_end fra Alunta GET /subscriptions. Fail-safe OFF indtil ejeren har verificeret feltudtræk mod ægte Alunta-svar via node scripts/reconcileAluntaSubscriptions.js.')
ON CONFLICT (key) DO NOTHING;
