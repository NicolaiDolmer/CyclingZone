-- #2842 · gør spillerfeedback læsbar og besvarlig (indbakke + svar-sløjfe).
--
-- Problem: #2602 byggede skrive-stien (POST /api/feedback → player_feedback),
-- men ingen læse-flade. Migrationens egen kommentar udskød læse-adgang til et
-- "fremtidigt admin-værktøj" der aldrig blev bygget. Nettoresultatet: en
-- spiller der skriver får hverken kvittering eller svar, og ejeren opdager det
-- ikke. Første rigtige indsendelse (23/7 12:07 CEST) lå ulæst i tre dage.
--
-- Løsning (#2842):
--   * Del 1 (læse): admin-indbakke bag requireAdmin + service-role-routes.
--     Kræver ingen skema-ændring i sig selv, men keyset-pagineringen kræver
--     et sammensat (created_at DESC, id DESC)-indeks — se nedenfor.
--   * Del 2 (besvare): svaret persisteres PÅ rækken (reply_message /
--     replied_at / replied_by) og leveres til spilleren som en in-app-
--     notifikation af typen 'admin_notice' (findes allerede i
--     notifications_type_check — ingen constraint-ændring nødvendig).
--
-- Kanal-valg (ejer-anbefaling i #2842, fulgt her): in-app-notifikation.
-- Genbruger notifyUser(), kræver ingen ny infrastruktur, og lander der hvor
-- spilleren i forvejen læser beskeder. E-mail kan lægges ovenpå senere uden
-- at ændre dette skema (reply_message er kanal-agnostisk).
--
-- Adgangskontrol: player_feedback har RLS ENABLED og NUL policies siden
-- #2602 → default-deny for både anon og authenticated. Denne migration
-- ændrer IKKE på det, men gør det eksplicit med REVOKE ALL, så en fremtidig
-- bred GRANT (fx "GRANT SELECT ON ALL TABLES") ikke stille åbner en tabel
-- der kan indeholde personoplysninger. Læsning sker udelukkende via backend
-- service-role bag requireAdmin.
--
-- ⚠️ Denne fil COMMITTES med PR'en. Migrationen applies som et SEPARAT
--    post-merge-skridt (idempotent + post-verify), aldrig som led i selve
--    implementeringen. Rammer: #2642.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
-- constraint-ændringer i DO-blokke med pg_constraint-tjek. Re-run = no-op.
--
-- Rollback:
--   ALTER TABLE player_feedback
--     DROP COLUMN IF EXISTS reply_message,
--     DROP COLUMN IF EXISTS replied_at,
--     DROP COLUMN IF EXISTS replied_by,
--     DROP COLUMN IF EXISTS status_changed_at,
--     DROP COLUMN IF EXISTS seq;
--   DROP INDEX IF EXISTS player_feedback_seq_idx;
--   DROP INDEX IF EXISTS player_feedback_status_seq_idx;
--   ALTER TABLE player_feedback DROP CONSTRAINT IF EXISTS player_feedback_status_check;

-- ── Del 2: svar-kolonner ────────────────────────────────────────────────────
ALTER TABLE player_feedback
  ADD COLUMN IF NOT EXISTS reply_message TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- Svarets længde spejler indsendelsens (4000) så backend-valideringen og
-- databasen ikke kan komme i utakt. NULL = intet svar sendt endnu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'player_feedback'::regclass
      AND conname = 'player_feedback_reply_message_check'
  ) THEN
    ALTER TABLE player_feedback
      ADD CONSTRAINT player_feedback_reply_message_check
      CHECK (reply_message IS NULL OR (length(btrim(reply_message)) > 0 AND length(reply_message) <= 4000));
  END IF;
END $$;

-- ── Triage: lås status til de tre tilstande UI'et kan producere ─────────────
-- status havde DEFAULT 'new' men ingen CHECK. Nu hvor en UI skriver den, skal
-- den være et lukket sæt. Eksisterende rækker er alle 'new' (verificeret mod
-- prod 26/7), så tilføjelsen kan ikke fejle på legacy-data — men vi normaliserer
-- alligevel først, så migrationen er sikker på en base der har drevet.
UPDATE player_feedback
   SET status = 'new'
 WHERE status IS NULL OR status NOT IN ('new', 'in_progress', 'closed');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'player_feedback'::regclass
      AND conname = 'player_feedback_status_check'
  ) THEN
    ALTER TABLE player_feedback
      ADD CONSTRAINT player_feedback_status_check
      CHECK (status IN ('new', 'in_progress', 'closed'));
  END IF;
END $$;

-- ── Ydelse: keyset-paginering (ingen OFFSET) ────────────────────────────────
-- `seq` er indbakkens cursor. Hvorfor en ekstra kolonne i stedet for at pagere
-- på created_at: en keyset-cursor skal være en TOTAL orden, ellers kan to
-- rækker med samme timestamp havne på hver sin side af en sidegrænse og enten
-- forsvinde eller gå igen. created_at alene er ikke unik pr. definition, og et
-- sammensat (created_at, id)-cursor kræver et row-value-prædikat (PostgREST
-- `.or(...)`) som er markant mere skrøbeligt at bygge og teste end en enkelt
-- monotont voksende bigint. OFFSET er udelukket: den scanner og smider væk,
-- så prisen vokser med sidetallet.
--
-- BIGSERIAL fylder eksisterende rækker ud ved ADD COLUMN (tabel-rewrite).
-- Tildelingen sker i fysisk rækkefølge, ikke created_at-rækkefølge — på en
-- tabel der aldrig er blevet opdateret er de to identiske, og med 1 række i
-- prod pr. 26/7 er det uanset trivielt.
ALTER TABLE player_feedback
  ADD COLUMN IF NOT EXISTS seq BIGSERIAL;

CREATE UNIQUE INDEX IF NOT EXISTS player_feedback_seq_idx
  ON player_feedback (seq DESC);

-- Indbakkens default-visning filtrerer på status → sammensat indeks så både
-- filter og cursor betjenes af ét index-scan.
CREATE INDEX IF NOT EXISTS player_feedback_status_seq_idx
  ON player_feedback (status, seq DESC);

-- ── Adgangskontrol: eksplicit default-deny ──────────────────────────────────
-- RLS er allerede ENABLED uden policies (#2602). REVOKE er et andet lag: uden
-- det ville en bred fremtidig GRANT kunne give anon/authenticated table-level
-- privilegier, som RLS så alene skulle holde tilbage. Feedback kan indeholde
-- personoplysninger (fritekst fra spillere) og skal være admin-only.
REVOKE ALL ON TABLE player_feedback FROM anon;
REVOKE ALL ON TABLE player_feedback FROM authenticated;

COMMENT ON TABLE player_feedback IS
  '#2602/#2842: in-game feedback/bug/idea-indsendelser fra spillere. Skrives via backend service-role (POST /api/feedback) og laeses/besvares KUN via admin-indbakken (GET/PATCH/POST /api/admin/feedback*, requireAdmin). Ingen RLS-policies + REVOKE ALL for anon/authenticated: kan indeholde personoplysninger.';

COMMENT ON COLUMN player_feedback.reply_message IS
  '#2842: ejerens svar, leveret til spilleren som in-app-notifikation (type admin_notice). NULL = ikke besvaret.';
COMMENT ON COLUMN player_feedback.status IS
  '#2842: new -> in_progress -> closed. Saettes fra admin-indbakken; et afsendt svar saetter closed.';
COMMENT ON COLUMN player_feedback.seq IS
  '#2842: monotont voksende keyset-cursor for admin-indbakken. Total orden, saa paginering aldrig taber eller gentager en raekke. Ingen OFFSET.';
