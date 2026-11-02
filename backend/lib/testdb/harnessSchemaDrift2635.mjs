// Read-only production catalog, 2026-11-02. Deliberately bounded, not a full schema.
// Missing dependency tables (loans, team_dna) are NOT replaced with permissive stubs.
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
