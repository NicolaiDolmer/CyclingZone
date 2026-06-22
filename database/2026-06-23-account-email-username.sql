-- Konto-indstillinger: skift e-mailadresse + brugernavn — Refs #1746.
--
-- Brugeren skal kunne skifte e-mail og brugernavn fra ProfilePage.
--
-- BRUGERNAVN: public.users.username har allerede en UNIQUE NOT NULL-constraint
-- (schema.sql:27 / supabase_setup.sql:18) + "Users can update own profile"-RLS
-- (auth.uid() = id, live siden tidlig schema). Selve skiftet sker via backend
-- (PUT /api/me/username) med case-insensitivt unikheds-tjek. Denne migration
-- tilføjer ET case-insensitivt unique-index (lower(username)) som DB-backstop:
-- den eksisterende UNIQUE er case-SENSITIV, så "Alice"/"alice" kunne ellers
-- begge slippe gennem app-tjekket i en samtidig race (samme klasse som #1264
-- for holdnavne). Ingen ny kolonne.
--
-- E-MAIL: auth.users.email er source-of-truth. Skiftet kører gennem Supabase
-- Auth (supabase.auth.updateUser({ email })) med Supabase's indbyggede
-- bekraeftelses-flow (dobbelt-confirm). NÅR den nye adresse er bekraeftet,
-- opdaterer Supabase auth.users.email — men der findes INGEN trigger der
-- propagerer det til public.users.email (handle_new_user dækker kun INSERT).
-- Denne migration tilføjer den manglende AFTER UPDATE OF email-trigger, så
-- public.users.email følger med uden manuel sync. Spejler mønsteret fra
-- 2026-05-17-users-language-i18n.sql (sync_user_language_to_auth_meta).
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS, så
-- auto-migrate kan re-køre uden side-effekter.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS sync_auth_email_to_users ON auth.users;
--   DROP FUNCTION IF EXISTS public.sync_auth_email_to_users();
--   DROP INDEX IF EXISTS public.users_username_lower_unique_idx;

-- ── 1. Sync auth.users.email → public.users.email ────────────────
-- Fires kun ved UPDATE af email (ikke INSERT — handle_new_user dækker
-- signup-vejen). SECURITY DEFINER kræves for at læse auth-schemaet og
-- skrive til public.users uafhængigt af kalderens RLS. Defensiv: rører kun
-- email-feltet, og kun når det faktisk er ændret.
CREATE OR REPLACE FUNCTION public.sync_auth_email_to_users()
RETURNS trigger AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE public.users
      SET email = NEW.email
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_auth_email_to_users ON auth.users;
CREATE TRIGGER sync_auth_email_to_users
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_auth_email_to_users();

-- ── 2. One-shot backfill: repair eventuel drift ──────────────────
-- Sync nuværende auth.users.email til public.users.email for rækker hvor de
-- er kommet ud af sync (fx hvis en email tidligere blev ændret direkte i
-- Supabase Auth-konsollen før denne trigger fandtes). Idempotent: rammer
-- 0 rækker når alt allerede er i sync.
UPDATE public.users pu
  SET email = au.email
  FROM auth.users au
  WHERE pu.id = au.id
    AND au.email IS NOT NULL
    AND pu.email IS DISTINCT FROM au.email;

-- ── 3. Case-insensitiv username-unikhed (backstop mod TOCTOU-race) ───
-- public.users.username har en case-SENSITIV UNIQUE (users_username_key), men
-- PUT /api/me/username (+ signup) tjekker case-INSENSITIVT (ilike). To samtidige
-- requests for "Alice" og "alice" kan derfor begge passere app-tjekket og begge
-- committe, fordi den case-sensitive constraint ikke ser dem som ens. Dette
-- lower()-unique-index lukker race'et på DB-niveau — samme mønster som #1264
-- (teams_name_lower_unique_idx). Route-handleren mapper allerede 23505 → "optaget".
-- Verificeret 2026-06-23 (read-only): 0 case-kollisioner i prod, så indekset kan
-- oprettes uden forudgående oprydning. Idempotent via IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique_idx
  ON public.users (lower(username));
