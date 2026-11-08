-- Harness-only #2635 overlay. Never apply to production.
-- Catalog verified read-only 2026-11-02; bounded original-issue scope.
-- Dependency tables contain structural contracts only, never reference rows.
-- Existing-column drift and unrelated indexes remain outside this bounded overlay.
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

CREATE UNIQUE INDEX IF NOT EXISTS uniq_division_bonus_per_team_season ON public.finance_transactions USING btree (team_id, season_id) WHERE ((type = 'bonus'::text) AND (reason_code = 'season_end_division_bonus'::text) AND (season_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_finance_idempotency_key ON public.finance_transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

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

CREATE TABLE IF NOT EXISTS public.loans (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  team_id uuid NOT NULL,
  loan_type text NOT NULL,
  principal integer NOT NULL,
  origination_fee integer NOT NULL,
  interest_rate numeric(5,4) NOT NULL,
  seasons_total integer NOT NULL,
  seasons_remaining integer NOT NULL,
  amount_remaining integer NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  season_id uuid,
  accrued_interest bigint DEFAULT 0 NOT NULL,
  last_interest_season_id uuid
);

CREATE TABLE IF NOT EXISTS public.team_dna (
  key text NOT NULL,
  label text NOT NULL,
  emoji text NOT NULL,
  short_description text NOT NULL,
  long_description text NOT NULL,
  policy_axes jsonb NOT NULL,
  national_affinity text[] DEFAULT '{}'::text[] NOT NULL,
  specialization_affinity text[] DEFAULT '{}'::text[] NOT NULL,
  member_alignment_bonus jsonb DEFAULT '{}'::jsonb NOT NULL,
  goal_weighting jsonb DEFAULT '{}'::jsonb NOT NULL,
  tradition_goal jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS related_loan_id uuid;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS team_dna_key text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_pkey') THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.team_dna'::regclass AND conname = 'team_dna_pkey') THEN
    ALTER TABLE public.team_dna ADD CONSTRAINT team_dna_pkey PRIMARY KEY (key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.finance_transactions'::regclass AND conname = 'finance_transactions_related_loan_id_fkey') THEN
    ALTER TABLE public.finance_transactions ADD CONSTRAINT finance_transactions_related_loan_id_fkey FOREIGN KEY (related_loan_id) REFERENCES loans(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_last_interest_season_id_fkey') THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_last_interest_season_id_fkey FOREIGN KEY (last_interest_season_id) REFERENCES seasons(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_loan_type_check') THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_loan_type_check CHECK ((loan_type = ANY (ARRAY['short'::text, 'long'::text, 'emergency'::text, 'reset'::text])));
  END IF;
END $$;



DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_season_id_fkey') THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_status_check') THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paid_off'::text])));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_team_id_fkey') THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
  END IF;
END $$;



DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.teams'::regclass AND conname = 'teams_team_dna_key_fkey') THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_team_dna_key_fkey FOREIGN KEY (team_dna_key) REFERENCES team_dna(key) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_loan_interest_per_loan_season ON public.finance_transactions USING btree (related_loan_id, season_id) WHERE ((type = 'loan_interest'::text) AND (related_loan_id IS NOT NULL) AND (season_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_emergency_loan_per_team_season ON public.loans USING btree (team_id, season_id) WHERE ((loan_type = 'emergency'::text) AND (season_id IS NOT NULL));
