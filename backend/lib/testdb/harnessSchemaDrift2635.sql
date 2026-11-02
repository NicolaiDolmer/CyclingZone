-- Harness-only #2635 overlay. Never apply to production.
-- Catalog verified read-only 2026-11-02; bounded original-issue scope.
-- loans and team_dna are intentionally not stubbed; their dependent columns remain absent.
DROP TABLE IF EXISTS public.loan_agreements;
ALTER TABLE public.riders DROP COLUMN IF EXISTS full_name;

ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS actor_type text;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS source_path text;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS reason_code text;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS before_balance bigint;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS after_balance bigint;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS related_entity_type text;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS related_entity_id uuid;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS acquired_at timestamp with time zone DEFAULT now();
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS owner_is_ai boolean NOT NULL DEFAULT false;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS peak_suggestions_dismissed_season_id uuid;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS consecutive_low_satisfaction_expirations integer NOT NULL DEFAULT 0;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS team_dna_chosen_at timestamp with time zone;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS transfer_frozen boolean NOT NULL DEFAULT false;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS debt_breach_streak integer NOT NULL DEFAULT 0;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS starter_squad_allocated_at timestamp with time zone;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS academy_intake_seeded_at timestamp with time zone;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS starter_depth_topped_up_at timestamp with time zone;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS emergency_loan_streak integer NOT NULL DEFAULT 0;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS pending_removal_at timestamp with time zone;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS onboarding_progress_dismissed_at timestamp with time zone;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS xp integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS level integer DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_dm_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS consent_preferences jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en'::text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_beta_tester boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS nps_last_prompted_at timestamp with time zone;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_dm_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.finance_transactions'::regclass AND conname = 'finance_transactions_actor_type_check') THEN
    ALTER TABLE public.finance_transactions ADD CONSTRAINT finance_transactions_actor_type_check CHECK (((actor_type IS NULL) OR (actor_type = ANY (ARRAY['cron'::text, 'api'::text, 'admin'::text, 'system'::text, 'migration'::text]))));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.finance_transactions'::regclass AND conname = 'finance_transactions_related_entity_type_check') THEN
    ALTER TABLE public.finance_transactions ADD CONSTRAINT finance_transactions_related_entity_type_check CHECK (((related_entity_type IS NULL) OR (related_entity_type = ANY (ARRAY['auction'::text, 'loan'::text, 'transfer'::text, 'swap'::text, 'race'::text, 'season'::text, 'manual'::text]))));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.riders'::regclass AND conname = 'riders_peak_suggestions_dismissed_season_id_fkey') THEN
    ALTER TABLE public.riders ADD CONSTRAINT riders_peak_suggestions_dismissed_season_id_fkey FOREIGN KEY (peak_suggestions_dismissed_season_id) REFERENCES seasons(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_language_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_language_check CHECK ((language = ANY (ARRAY['en'::text, 'da'::text, 'fr'::text, 'es'::text, 'nl'::text])));
  END IF;
END $$;
