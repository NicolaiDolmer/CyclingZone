// Read-only production catalog, 2026-11-02. Deliberately bounded, not a full schema.
// Dependency tables use measured structural definitions without reference rows.
export const HARNESS_DRIFT_INDEXES = [
  {
    "tablename": "finance_transactions",
    "indexname": "uniq_division_bonus_per_team_season",
    "indexdef": "CREATE UNIQUE INDEX uniq_division_bonus_per_team_season ON public.finance_transactions USING btree (team_id, season_id) WHERE ((type = 'bonus'::text) AND (reason_code = 'season_end_division_bonus'::text) AND (season_id IS NOT NULL))"
  },
  {
    "tablename": "finance_transactions",
    "indexname": "uniq_finance_idempotency_key",
    "indexdef": "CREATE UNIQUE INDEX uniq_finance_idempotency_key ON public.finance_transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL)"
  }
];

export const HARNESS_DRIFT_COLUMNS = [
  {
    "table_name": "finance_transactions",
    "column_name": "actor_type",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "actor_id",
    "data_type": "uuid",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "source_path",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "reason_code",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "before_balance",
    "data_type": "bigint",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "after_balance",
    "data_type": "bigint",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "related_entity_type",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "related_entity_id",
    "data_type": "uuid",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "idempotency_key",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "finance_transactions",
    "column_name": "metadata",
    "data_type": "jsonb",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "riders",
    "column_name": "acquired_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": "now()"
  },
  {
    "table_name": "riders",
    "column_name": "owner_is_ai",
    "data_type": "boolean",
    "is_nullable": "NO",
    "column_default": "false"
  },
  {
    "table_name": "riders",
    "column_name": "peak_suggestions_dismissed_season_id",
    "data_type": "uuid",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "teams",
    "column_name": "consecutive_low_satisfaction_expirations",
    "data_type": "integer",
    "is_nullable": "NO",
    "column_default": "0"
  },
  {
    "table_name": "teams",
    "column_name": "team_dna_chosen_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "teams",
    "column_name": "is_test_account",
    "data_type": "boolean",
    "is_nullable": "NO",
    "column_default": "false"
  },
  {
    "table_name": "teams",
    "column_name": "transfer_frozen",
    "data_type": "boolean",
    "is_nullable": "NO",
    "column_default": "false"
  },
  {
    "table_name": "teams",
    "column_name": "debt_breach_streak",
    "data_type": "integer",
    "is_nullable": "NO",
    "column_default": "0"
  },
  {
    "table_name": "teams",
    "column_name": "starter_squad_allocated_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "teams",
    "column_name": "academy_intake_seeded_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "teams",
    "column_name": "starter_depth_topped_up_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "teams",
    "column_name": "emergency_loan_streak",
    "data_type": "integer",
    "is_nullable": "NO",
    "column_default": "0"
  },
  {
    "table_name": "teams",
    "column_name": "pending_removal_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "teams",
    "column_name": "onboarding_progress_dismissed_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "users",
    "column_name": "discord_id",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "users",
    "column_name": "xp",
    "data_type": "integer",
    "is_nullable": "YES",
    "column_default": "0"
  },
  {
    "table_name": "users",
    "column_name": "level",
    "data_type": "integer",
    "is_nullable": "YES",
    "column_default": "1"
  },
  {
    "table_name": "users",
    "column_name": "discord_dm_enabled",
    "data_type": "boolean",
    "is_nullable": "NO",
    "column_default": "true"
  },
  {
    "table_name": "users",
    "column_name": "consent_preferences",
    "data_type": "jsonb",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "users",
    "column_name": "language",
    "data_type": "text",
    "is_nullable": "NO",
    "column_default": "'en'::text"
  },
  {
    "table_name": "users",
    "column_name": "is_beta_tester",
    "data_type": "boolean",
    "is_nullable": "NO",
    "column_default": "false"
  },
  {
    "table_name": "users",
    "column_name": "nps_last_prompted_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "users",
    "column_name": "discord_dm_prefs",
    "data_type": "jsonb",
    "is_nullable": "NO",
    "column_default": "'{}'::jsonb"
  }
];

export const HARNESS_DRIFT_CONSTRAINTS = [
  {
    "table_name": "finance_transactions",
    "conname": "finance_transactions_actor_type_check",
    "contype": "c",
    "definition": "CHECK (((actor_type IS NULL) OR (actor_type = ANY (ARRAY['cron'::text, 'api'::text, 'admin'::text, 'system'::text, 'migration'::text]))))"
  },
  {
    "table_name": "finance_transactions",
    "conname": "finance_transactions_related_entity_type_check",
    "contype": "c",
    "definition": "CHECK (((related_entity_type IS NULL) OR (related_entity_type = ANY (ARRAY['auction'::text, 'loan'::text, 'transfer'::text, 'swap'::text, 'race'::text, 'season'::text, 'manual'::text]))))"
  },
  {
    "table_name": "riders",
    "conname": "riders_peak_suggestions_dismissed_season_id_fkey",
    "contype": "f",
    "definition": "FOREIGN KEY (peak_suggestions_dismissed_season_id) REFERENCES seasons(id) ON DELETE SET NULL"
  },
  {
    "table_name": "users",
    "conname": "users_language_check",
    "contype": "c",
    "definition": "CHECK ((language = ANY (ARRAY['en'::text, 'da'::text, 'fr'::text, 'es'::text, 'nl'::text])))"
  }
];

// Structural dependency catalog only; no reference rows or calibration.
export const HARNESS_DEPENDENCY_COLUMNS = [
  {
    "udt_name": "uuid",
    "data_type": "uuid",
    "table_name": "finance_transactions",
    "column_name": "related_loan_id",
    "is_nullable": "YES",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "uuid",
    "data_type": "uuid",
    "table_name": "loans",
    "column_name": "id",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": "uuid_generate_v4()",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "uuid",
    "data_type": "uuid",
    "table_name": "loans",
    "column_name": "team_id",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "loans",
    "column_name": "loan_type",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "int4",
    "data_type": "integer",
    "table_name": "loans",
    "column_name": "principal",
    "is_nullable": "NO",
    "numeric_scale": 0,
    "column_default": null,
    "numeric_precision": 32,
    "character_maximum_length": null
  },
  {
    "udt_name": "int4",
    "data_type": "integer",
    "table_name": "loans",
    "column_name": "origination_fee",
    "is_nullable": "NO",
    "numeric_scale": 0,
    "column_default": null,
    "numeric_precision": 32,
    "character_maximum_length": null
  },
  {
    "udt_name": "numeric",
    "data_type": "numeric",
    "table_name": "loans",
    "column_name": "interest_rate",
    "is_nullable": "NO",
    "numeric_scale": 4,
    "column_default": null,
    "numeric_precision": 5,
    "character_maximum_length": null
  },
  {
    "udt_name": "int4",
    "data_type": "integer",
    "table_name": "loans",
    "column_name": "seasons_total",
    "is_nullable": "NO",
    "numeric_scale": 0,
    "column_default": null,
    "numeric_precision": 32,
    "character_maximum_length": null
  },
  {
    "udt_name": "int4",
    "data_type": "integer",
    "table_name": "loans",
    "column_name": "seasons_remaining",
    "is_nullable": "NO",
    "numeric_scale": 0,
    "column_default": null,
    "numeric_precision": 32,
    "character_maximum_length": null
  },
  {
    "udt_name": "int4",
    "data_type": "integer",
    "table_name": "loans",
    "column_name": "amount_remaining",
    "is_nullable": "NO",
    "numeric_scale": 0,
    "column_default": null,
    "numeric_precision": 32,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "loans",
    "column_name": "status",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": "'active'::text",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "timestamptz",
    "data_type": "timestamp with time zone",
    "table_name": "loans",
    "column_name": "created_at",
    "is_nullable": "YES",
    "numeric_scale": null,
    "column_default": "now()",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "timestamptz",
    "data_type": "timestamp with time zone",
    "table_name": "loans",
    "column_name": "updated_at",
    "is_nullable": "YES",
    "numeric_scale": null,
    "column_default": "now()",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "uuid",
    "data_type": "uuid",
    "table_name": "loans",
    "column_name": "season_id",
    "is_nullable": "YES",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "int8",
    "data_type": "bigint",
    "table_name": "loans",
    "column_name": "accrued_interest",
    "is_nullable": "NO",
    "numeric_scale": 0,
    "column_default": "0",
    "numeric_precision": 64,
    "character_maximum_length": null
  },
  {
    "udt_name": "uuid",
    "data_type": "uuid",
    "table_name": "loans",
    "column_name": "last_interest_season_id",
    "is_nullable": "YES",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "team_dna",
    "column_name": "key",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "team_dna",
    "column_name": "label",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "team_dna",
    "column_name": "emoji",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "team_dna",
    "column_name": "short_description",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "team_dna",
    "column_name": "long_description",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "jsonb",
    "data_type": "jsonb",
    "table_name": "team_dna",
    "column_name": "policy_axes",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "_text",
    "data_type": "ARRAY",
    "table_name": "team_dna",
    "column_name": "national_affinity",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": "'{}'::text[]",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "_text",
    "data_type": "ARRAY",
    "table_name": "team_dna",
    "column_name": "specialization_affinity",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": "'{}'::text[]",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "jsonb",
    "data_type": "jsonb",
    "table_name": "team_dna",
    "column_name": "member_alignment_bonus",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": "'{}'::jsonb",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "jsonb",
    "data_type": "jsonb",
    "table_name": "team_dna",
    "column_name": "goal_weighting",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": "'{}'::jsonb",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "jsonb",
    "data_type": "jsonb",
    "table_name": "team_dna",
    "column_name": "tradition_goal",
    "is_nullable": "YES",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "timestamptz",
    "data_type": "timestamp with time zone",
    "table_name": "team_dna",
    "column_name": "created_at",
    "is_nullable": "NO",
    "numeric_scale": null,
    "column_default": "now()",
    "numeric_precision": null,
    "character_maximum_length": null
  },
  {
    "udt_name": "text",
    "data_type": "text",
    "table_name": "teams",
    "column_name": "team_dna_key",
    "is_nullable": "YES",
    "numeric_scale": null,
    "column_default": null,
    "numeric_precision": null,
    "character_maximum_length": null
  }
];
HARNESS_DRIFT_CONSTRAINTS.push(...[
  {
    "conname": "finance_transactions_related_loan_id_fkey",
    "contype": "f",
    "definition": "FOREIGN KEY (related_loan_id) REFERENCES loans(id)",
    "table_name": "finance_transactions"
  },
  {
    "conname": "loans_last_interest_season_id_fkey",
    "contype": "f",
    "definition": "FOREIGN KEY (last_interest_season_id) REFERENCES seasons(id)",
    "table_name": "loans"
  },
  {
    "conname": "loans_loan_type_check",
    "contype": "c",
    "definition": "CHECK ((loan_type = ANY (ARRAY['short'::text, 'long'::text, 'emergency'::text, 'reset'::text])))",
    "table_name": "loans"
  },
  {
    "conname": "loans_pkey",
    "contype": "p",
    "definition": "PRIMARY KEY (id)",
    "table_name": "loans"
  },
  {
    "conname": "loans_season_id_fkey",
    "contype": "f",
    "definition": "FOREIGN KEY (season_id) REFERENCES seasons(id)",
    "table_name": "loans"
  },
  {
    "conname": "loans_status_check",
    "contype": "c",
    "definition": "CHECK ((status = ANY (ARRAY['active'::text, 'paid_off'::text])))",
    "table_name": "loans"
  },
  {
    "conname": "loans_team_id_fkey",
    "contype": "f",
    "definition": "FOREIGN KEY (team_id) REFERENCES teams(id)",
    "table_name": "loans"
  },
  {
    "conname": "team_dna_pkey",
    "contype": "p",
    "definition": "PRIMARY KEY (key)",
    "table_name": "team_dna"
  },
  {
    "conname": "teams_team_dna_key_fkey",
    "contype": "f",
    "definition": "FOREIGN KEY (team_dna_key) REFERENCES team_dna(key) ON DELETE SET NULL",
    "table_name": "teams"
  }
]);
HARNESS_DRIFT_INDEXES.push(...[
  {
    "indexdef": "CREATE UNIQUE INDEX uniq_loan_interest_per_loan_season ON public.finance_transactions USING btree (related_loan_id, season_id) WHERE ((type = 'loan_interest'::text) AND (related_loan_id IS NOT NULL) AND (season_id IS NOT NULL))",
    "indexname": "uniq_loan_interest_per_loan_season",
    "tablename": "finance_transactions"
  },
  {
    "indexdef": "CREATE UNIQUE INDEX loans_pkey ON public.loans USING btree (id)",
    "indexname": "loans_pkey",
    "tablename": "loans"
  },
  {
    "indexdef": "CREATE UNIQUE INDEX uniq_emergency_loan_per_team_season ON public.loans USING btree (team_id, season_id) WHERE ((loan_type = 'emergency'::text) AND (season_id IS NOT NULL))",
    "indexname": "uniq_emergency_loan_per_team_season",
    "tablename": "loans"
  },
  {
    "indexdef": "CREATE UNIQUE INDEX team_dna_pkey ON public.team_dna USING btree (key)",
    "indexname": "team_dna_pkey",
    "tablename": "team_dna"
  }
]);
