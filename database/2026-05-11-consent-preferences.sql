-- Consent management framework — per-user samtykke for analyse, marketing, e-mail.
-- Pre-login valg gemmes i localStorage. Ved login migreres valget hertil.
-- NULL betyder: brugeren har endnu ikke set banneret post-login (typisk fordi de
-- accepterede valg pre-login og localStorage holdt det indtil nu).
--
-- RLS: "Users can update own profile"-policy (live siden tidlig schema) dækker
-- allerede consent_preferences-writes via auth.uid() = id. Ingen ny policy nødvendig.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS consent_preferences JSONB DEFAULT NULL;

COMMENT ON COLUMN users.consent_preferences IS
  'Samtykke pr. kategori. Schema: { version: 1, necessary: true, analytics: bool, marketing: bool, email_marketing: bool, updated_at: ISO8601 }. NULL = endnu ikke sat post-login.';
